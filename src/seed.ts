import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './users/user.entity';
import { Department } from './departments/department.entity';
import { QueueService } from './services/service.entity';
import { Window } from './windows/window.entity';
import { RefreshToken } from './auth/refresh-token.entity';
import { Ticket, TicketStatus } from './tickets/ticket.entity';
import { TicketAudit } from './audits/audit.entity';
import { QueueCounter } from './queue-counters/queue-counter.entity';
import { Rating } from './ratings/rating.entity';
import { Verification } from './verifications/verification.entity';
import { DepartmentService as DeptService } from './department-services/department-service.entity';
import { StaffAssignment } from './staff-assignments/staff-assignment.entity';
import { DisciplineEvent } from './discipline-events/discipline-event.entity';

const ds = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USER ?? 'queua',
  password: process.env.DB_PASSWORD ?? 'queua_secret',
  database: process.env.DB_NAME ?? 'queua_db',
  entities: [
    User, Department, QueueService, Window, RefreshToken,
    Ticket, TicketAudit, QueueCounter, Rating, Verification,
    DeptService, StaffAssignment, DisciplineEvent,
  ],
  synchronize: true,
  logging: false,
});

// ─── Хелпери ─────────────────────────────────────────────────────────────────

const rnd = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const chance = (p: number) => Math.random() < p;

// Локальні дати (без UTC-зсуву) — узгоджено з shared/utils/local-date.ts на фронтенді
function toLocalISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function addDaysLocal(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toLocalISODate(d);
}

// Слоти запису з кроком, що дорівнює тривалості обслуговування (узгоджено з tickets.service.ts)
function slotTimes(openHour: number, closeHour: number, intervalMinutes: number): string[] {
  const times: string[] = [];
  const totalMinutes = (closeHour - openHour) * 60;
  for (let m = 0; m < totalMinutes; m += intervalMinutes) {
    const h = openHour + Math.floor(m / 60);
    const mm = m % 60;
    times.push(`${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  }
  return times;
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function workingHoursFor(dept: Department, date: string): { openHour: number; closeHour: number } | null {
  const [y, m, d] = date.split('-').map(Number);
  const dayKey = DAY_KEYS[new Date(y, m - 1, d).getDay()];
  const hours: string = dept.working_hours?.[dayKey] ?? 'вихідний';
  if (hours === 'вихідний') return null;
  const match = hours.match(/(\d{2}):(\d{2})[–-](\d{2}):(\d{2})/);
  if (!match) return null;
  return { openHour: parseInt(match[1]), closeHour: parseInt(match[3]) };
}

interface TicketSpec {
  client_id: string;
  service_id: string;
  department_id: string;
  staff_id: string | null;
  ticket_number: number;
  prefix: string;
  status: TicketStatus;
  scheduled_date: string;
  time_slot: string | null;
  estimated_start_at: Date | null;
  estimated_end_at: Date | null;
  called_at: Date | null;
  serving_started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  is_missed_by_client: boolean;
}

function generateDayTickets(
  dept: Department,
  svc: QueueService,
  date: string,
  openHour: number,
  closeHour: number,
  capacity: number,
  staffId: string,
  citizens: User[],
  fillRate: number,
): TicketSpec[] {
  const numSlots = closeHour - openHour;
  const slotCounts = new Map<number, number>();
  const usedIds = new Set<string>();
  const tickets: TicketSpec[] = [];
  const target = Math.round(numSlots * capacity * fillRate);

  let attempts = 0;
  while (tickets.length < target && attempts < target * 10) {
    attempts++;
    const slotHour = openHour + Math.floor(Math.random() * numSlots);
    const cnt = slotCounts.get(slotHour) ?? 0;
    if (cnt >= capacity) continue;

    const pool = citizens.filter(c => !usedIds.has(c.id));
    if (!pool.length) break;

    const citizen = pick(pool);
    usedIds.add(citizen.id);
    slotCounts.set(slotHour, cnt + 1);

    const ticketNumber = (slotHour - openHour) * capacity + 1 + cnt;
    const timeSlot = `${String(slotHour).padStart(2, '0')}:00`;
    const slotDate = new Date(`${date}T${timeSlot}:00`);
    const endDate = new Date(slotDate.getTime() + svc.estimated_duration_minutes * 60_000);

    const r = Math.random();
    const status: TicketStatus = r < 0.74 ? 'completed' : r < 0.87 ? 'missed' : 'cancelled';

    const calledAt = status !== 'cancelled'
      ? new Date(slotDate.getTime() + rnd(1, 12) * 60_000) : null;
    const servingStartedAt = status === 'completed' && calledAt
      ? new Date(calledAt.getTime() + rnd(30, 180) * 1_000) : null;
    const completedAt = servingStartedAt
      ? new Date(servingStartedAt.getTime() + svc.estimated_duration_minutes * (0.65 + Math.random() * 0.7) * 60_000)
      : null;
    const cancelledAt = status === 'cancelled'
      ? new Date(slotDate.getTime() - rnd(10, 180) * 60_000) : null;

    tickets.push({
      client_id: citizen.id,
      service_id: svc.id,
      department_id: dept.id,
      staff_id: status !== 'cancelled' ? staffId : null,
      ticket_number: ticketNumber,
      prefix: svc.ticket_prefix,
      status,
      scheduled_date: date,
      time_slot: timeSlot,
      estimated_start_at: slotDate,
      estimated_end_at: endDate,
      called_at: calledAt,
      serving_started_at: servingStartedAt,
      completed_at: completedAt,
      cancelled_at: cancelledAt,
      is_missed_by_client: status === 'missed',
    });
  }
  return tickets;
}

// Майбутні бронювання («попередній запис», статус завжди 'waiting', без обслуговування ще) —
// слоти йдуть із кроком тривалості послуги, капасіті слоту = к-сть відкритих вікон (як у calcSlotCapacity).
function generateFutureBookings(
  dept: Department,
  svc: QueueService,
  dates: string[],
  capacity: number,
  citizens: User[],
  fillRate: number,
  liveQueueFromHour: number | null,
): TicketSpec[] {
  const tickets: TicketSpec[] = [];
  const usedIds = new Set<string>(); // громадянин не може мати кілька активних записів на одну послугу

  for (const date of dates) {
    const wh = workingHoursFor(dept, date);
    if (!wh) continue;
    const bookingCloseHour = liveQueueFromHour !== null ? Math.min(liveQueueFromHour, wh.closeHour) : wh.closeHour;

    slotTimes(wh.openHour, bookingCloseHour, svc.estimated_duration_minutes).forEach((time, slotIndex) => {
      for (let i = 0; i < capacity; i++) {
        if (!chance(fillRate)) continue;

        const pool = citizens.filter(c => !usedIds.has(c.id));
        if (!pool.length) return;
        const citizen = pick(pool);
        usedIds.add(citizen.id);

        const slotStart = new Date(`${date}T${time}:00`);
        tickets.push({
          client_id: citizen.id,
          service_id: svc.id,
          department_id: dept.id,
          staff_id: null,
          ticket_number: slotIndex * capacity + 1 + i,
          prefix: svc.ticket_prefix,
          status: 'waiting',
          scheduled_date: date,
          time_slot: time,
          estimated_start_at: slotStart,
          estimated_end_at: new Date(slotStart.getTime() + svc.estimated_duration_minutes * 60_000),
          called_at: null,
          serving_started_at: null,
          completed_at: null,
          cancelled_at: null,
          is_missed_by_client: false,
        });
      }
    });
  }
  return tickets;
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function seed() {
  await ds.initialize();
  console.log('Connected to DB');

  await ds.query(`TRUNCATE TABLE
    discipline_events, ticket_audits, ratings, tickets, queue_counters,
    verifications, refresh_tokens, windows, staff_assignments, department_services,
    users, services, departments
    RESTART IDENTITY CASCADE`);
  console.log('Cleaned tables');

  const today = toLocalISODate(new Date());

  // ─── Послуги ─────────────────────────────────────────────────────────────────
  const serviceRepo = ds.getRepository(QueueService);
  const [svcPassport, svcForeign, svcResidence, svcSocial, svcFop, svcLand] =
    await serviceRepo.save([
      { name: 'Оформлення паспорта громадянина України', description: 'Видача, обмін паспорта (ID-картки)', requires_verification: true,  estimated_duration_minutes: 20, ticket_prefix: 'ПС', is_active: true, min_discipline_score: 0 },
      { name: 'Оформлення закордонного паспорта',        description: 'Видача та продовження закордонного паспорта',                   requires_verification: true,  estimated_duration_minutes: 15, ticket_prefix: 'ЗП', is_active: true, min_discipline_score: 0 },
      { name: 'Реєстрація місця проживання',             description: 'Реєстрація / зняття з реєстрації за місцем проживання',         requires_verification: false, estimated_duration_minutes: 10, ticket_prefix: 'РЕ', is_active: true, min_discipline_score: 0 },
      { name: 'Соціальна допомога та субсидії',          description: 'Призначення субсидії, допомога малозабезпеченим, виплати',      requires_verification: false, estimated_duration_minutes: 30, ticket_prefix: 'СО', is_active: true, min_discipline_score: 0 },
      { name: 'Реєстрація та зміни ФОП',                 description: 'Реєстрація ФОП, внесення змін, припинення діяльності',          requires_verification: false, estimated_duration_minutes: 25, ticket_prefix: 'ФО', is_active: true, min_discipline_score: 0 },
      { name: 'Земельний кадастр та право власності',    description: 'Виписки з кадастру, реєстрація права власності',                requires_verification: false, estimated_duration_minutes: 25, ticket_prefix: 'ЗЕ', is_active: true, min_discipline_score: 0 },
    ]);
  console.log('Services created: 6');

  // ─── Відділення ──────────────────────────────────────────────────────────────
  const deptRepo = ds.getRepository(Department);
  const [deptShev, deptPech] = await deptRepo.save([
    {
      name: 'ЦНАП Шевченківського району',
      address: 'вул. Хрещатик, 36', city: 'Київ', phone: '+38 044 202-40-00',
      latitude: 50.4501, longitude: 30.5234,
      working_hours: { mon: '08:00–19:00', tue: '08:00–19:00', wed: '08:00–19:00', thu: '08:00–19:00', fri: '08:00–18:00', sat: '09:00–14:00', sun: 'вихідний' },
      live_queue_from: '13:00',
      is_active: true, rating: 0,
    },
    {
      name: 'ЦНАП Печерського району',
      address: 'вул. Інститутська, 4', city: 'Київ', phone: '+38 044 253-60-60',
      latitude: 50.4399, longitude: 30.5332,
      working_hours: { mon: '09:00–18:00', tue: '09:00–18:00', wed: '09:00–18:00', thu: '09:00–18:00', fri: '09:00–17:00', sat: 'вихідний', sun: 'вихідний' },
      live_queue_from: '12:00',
      is_active: true, rating: 0,
    },
  ]);
  console.log('Departments created: 2');

  // ─── Паролі ──────────────────────────────────────────────────────────────────
  const adminHash   = await bcrypt.hash('Admin1234!', 12);
  const staffHash   = await bcrypt.hash('Staff1234!', 12);
  const citizenHash = await bcrypt.hash('User1234!', 12);

  // ─── Користувачі ─────────────────────────────────────────────────────────────
  const userRepo = ds.getRepository(User);

  const staffUsers = await userRepo.save([
    { email: 'admin@queua.ua',        password_hash: adminHash,   first_name: 'Адміністратор', last_name: 'Системи',    role: 'admin'   as const, is_verified: true,  discipline_score: 0,  attendance_rate: 0,    current_streak: 0,  phone: '+38 050 000-00-00' },
    { email: 'ivanova.m@queua.ua',    password_hash: staffHash,   first_name: 'Марина',        last_name: 'Іванова',    middle_name: 'Сергіївна',  role: 'staff' as const, is_verified: true,  discipline_score: 0,  attendance_rate: 0,    current_streak: 0,  phone: '+38 067 111-22-33' },
    { email: 'petrenko.o@queua.ua',   password_hash: staffHash,   first_name: 'Олег',          last_name: 'Петренко',   middle_name: 'Васильович', role: 'staff' as const, is_verified: true,  discipline_score: 0,  attendance_rate: 0,    current_streak: 0,  phone: '+38 067 222-33-44' },
    { email: 'kovalenko.t@queua.ua',  password_hash: staffHash,   first_name: 'Тетяна',        last_name: 'Коваленко',  middle_name: 'Іванівна',   role: 'staff' as const, is_verified: true,  discipline_score: 0,  attendance_rate: 0,    current_streak: 0,  phone: '+38 067 333-44-55' },
    { email: 'melnyk.a@queua.ua',     password_hash: staffHash,   first_name: 'Андрій',        last_name: 'Мельник',    middle_name: 'Петрович',   role: 'staff' as const, is_verified: true,  discipline_score: 0,  attendance_rate: 0,    current_streak: 0,  phone: '+38 067 444-55-66' },
    { email: 'bondar.n@queua.ua',     password_hash: staffHash,   first_name: 'Наталія',       last_name: 'Бондар',     middle_name: 'Олексіївна', role: 'staff' as const, is_verified: true,  discipline_score: 0,  attendance_rate: 0,    current_streak: 0,  phone: '+38 067 555-66-77' },
  ]);
  const [admin, ivanova, petrenko, kovalenko, melnyk, bondar] = staffUsers;

  // 15 citizens: 10 verified, 5 not
  const citizenData = [
    { email: 'shevchenko.v@gmail.com', first_name: 'Василь',    last_name: 'Шевченко',   middle_name: 'Миколайович', verified: true,  disc: 85, attend: 0.92, streak: 5  },
    { email: 'kravchenko.o@gmail.com', first_name: 'Олена',     last_name: 'Кравченко',  middle_name: 'Дмитрівна',   verified: false, disc: 60, attend: 0.74, streak: 2  },
    { email: 'boyko.m@gmail.com',      first_name: 'Микола',    last_name: 'Бойко',      middle_name: 'Олексійович', verified: true,  disc: 90, attend: 0.96, streak: 9  },
    { email: 'moroz.i@gmail.com',      first_name: 'Ірина',     last_name: 'Мороз',      middle_name: 'Василівна',   verified: true,  disc: 78, attend: 0.88, streak: 4  },
    { email: 'karpenko.d@gmail.com',   first_name: 'Дмитро',    last_name: 'Карпенко',   middle_name: 'Петрович',    verified: false, disc: 30, attend: 0.50, streak: 0  },
    { email: 'gonchar.o@gmail.com',    first_name: 'Оксана',    last_name: 'Гончар',     middle_name: 'Іванівна',    verified: true,  disc: 70, attend: 0.82, streak: 3  },
    { email: 'lysenko.a@gmail.com',    first_name: 'Андрій',    last_name: 'Лисенко',    middle_name: 'Сергійович',  verified: true,  disc: 88, attend: 0.95, streak: 7  },
    { email: 'rudenko.t@gmail.com',    first_name: 'Тетяна',    last_name: 'Руденко',    middle_name: 'Олексіївна',  verified: false, disc: 50, attend: 0.68, streak: 1  },
    { email: 'pavlenko.y@gmail.com',   first_name: 'Ярослав',   last_name: 'Павленко',   middle_name: 'Вікторович',  verified: true,  disc: 72, attend: 0.84, streak: 3  },
    { email: 'zakharenko.n@gmail.com', first_name: 'Наталія',   last_name: 'Захаренко',  middle_name: 'Андріївна',   verified: true,  disc: 82, attend: 0.91, streak: 6  },
    { email: 'tkachenko.s@gmail.com',  first_name: 'Сергій',    last_name: 'Ткаченко',   middle_name: 'Михайлович',  verified: false, disc: 38, attend: 0.55, streak: 0  },
    { email: 'savchenko.l@gmail.com',  first_name: 'Людмила',   last_name: 'Савченко',   middle_name: 'Федорівна',   verified: true,  disc: 96, attend: 0.98, streak: 14 },
    { email: 'musienko.r@gmail.com',   first_name: 'Роман',     last_name: 'Мусієнко',   middle_name: 'Ігорович',    verified: true,  disc: 64, attend: 0.79, streak: 2  },
    { email: 'petrova.v@gmail.com',    first_name: 'Вікторія',  last_name: 'Петрова',    middle_name: 'Олексіївна',  verified: false, disc: 55, attend: 0.71, streak: 1  },
    { email: 'danchenko.o@gmail.com',  first_name: 'Олексій',   last_name: 'Данченко',   middle_name: 'Юрійович',    verified: true,  disc: 76, attend: 0.86, streak: 4  },
  ];

  const citizens = await userRepo.save(
    citizenData.map(c => ({
      email: c.email,
      password_hash: citizenHash,
      first_name: c.first_name,
      last_name: c.last_name,
      middle_name: c.middle_name,
      phone: null,
      role: 'citizen' as const,
      is_verified: c.verified,
      discipline_score: c.disc,
      attendance_rate: c.attend,
      current_streak: c.streak,
    })),
  );
  console.log(`Users created: ${staffUsers.length + citizens.length}`);

  const verified = citizens.filter(c => c.is_verified);
  const all = citizens;

  // ─── Вікна ───────────────────────────────────────────────────────────────────
  const windowRepo = ds.getRepository(Window);
  const savedWindows = await windowRepo.save([
    { label: 'Вікно №1', department_id: deptShev.id, service_id: svcPassport.id,  staff_id: null, status: 'open',   current_number: 0, date: today },
    { label: 'Вікно №2', department_id: deptShev.id, service_id: svcPassport.id,  staff_id: null, status: 'closed', current_number: 0, date: today },
    { label: 'Вікно №3', department_id: deptShev.id, service_id: svcForeign.id,   staff_id: null, status: 'open',   current_number: 0, date: today },
    { label: 'Вікно №4', department_id: deptShev.id, service_id: svcForeign.id,   staff_id: null, status: 'closed', current_number: 0, date: today },
    { label: 'Вікно №5', department_id: deptShev.id, service_id: svcResidence.id, staff_id: null, status: 'open',   current_number: 0, date: today },
    { label: 'Вікно №1', department_id: deptPech.id, service_id: svcSocial.id,    staff_id: null, status: 'open',   current_number: 0, date: today },
    { label: 'Вікно №2', department_id: deptPech.id, service_id: svcSocial.id,    staff_id: null, status: 'open',   current_number: 0, date: today },
    { label: 'Вікно №3', department_id: deptPech.id, service_id: svcFop.id,       staff_id: null, status: 'open',   current_number: 0, date: today },
    { label: 'Вікно №4', department_id: deptPech.id, service_id: svcLand.id,      staff_id: null, status: 'open',   current_number: 0, date: today },
    { label: 'Вікно №5', department_id: deptPech.id, service_id: svcLand.id,      staff_id: null, status: 'closed', current_number: 0, date: today },
  ]);
  console.log('Windows created: 10');

  // Капасіті слоту = к-сть відкритих вікон (узгоджено з calcSlotCapacity у tickets.service.ts)
  const windowCountFor = (deptId: string, svcId: string): number =>
    Math.max(1, savedWindows.filter(w => w.department_id === deptId && w.service_id === svcId && w.status !== 'closed').length);

  // ─── Послуги відділень ───────────────────────────────────────────────────────
  const deptSvcRepo = ds.getRepository(DeptService);
  await deptSvcRepo.save([
    { department_id: deptShev.id, service_id: svcPassport.id,  is_active: true },
    { department_id: deptShev.id, service_id: svcForeign.id,   is_active: true },
    { department_id: deptShev.id, service_id: svcResidence.id, is_active: true },
    { department_id: deptPech.id, service_id: svcSocial.id,    is_active: true },
    { department_id: deptPech.id, service_id: svcFop.id,       is_active: true },
    { department_id: deptPech.id, service_id: svcLand.id,      is_active: true },
    { department_id: deptPech.id, service_id: svcResidence.id, is_active: true },
  ]);
  console.log('Department services linked: 7');

  // ─── Призначення персоналу ────────────────────────────────────────────────────
  const staffAssignRepo = ds.getRepository(StaffAssignment);
  await staffAssignRepo.save([
    { department_id: deptShev.id, service_id: svcPassport.id, staff_id: ivanova.id },
    { department_id: deptShev.id, service_id: svcForeign.id,  staff_id: petrenko.id },
    { department_id: deptPech.id, service_id: svcSocial.id,   staff_id: kovalenko.id },
    { department_id: deptPech.id, service_id: svcFop.id,      staff_id: melnyk.id },
    { department_id: deptPech.id, service_id: svcLand.id,     staff_id: bondar.id },
  ]);
  console.log('Staff assignments created: 5');

  // ─── Генерація історичних талонів ─────────────────────────────────────────────
  // Останні 5 робочих днів: Пн-Пт (2026-05-19..23)
  const workDays = [
    { date: '2026-05-19', shev: [8, 19], pech: [9, 18] },
    { date: '2026-05-20', shev: [8, 19], pech: [9, 18] },
    { date: '2026-05-21', shev: [8, 19], pech: [9, 18] },
    { date: '2026-05-22', shev: [8, 19], pech: [9, 18] },
    { date: '2026-05-23', shev: [8, 18], pech: [9, 17] },
  ];

  // (dept, svc, who serves, eligible citizens, capacity, deptKey)
  const combos = [
    { dept: deptShev, svc: svcPassport, staffId: ivanova.id,   citizens: verified, cap: 3, key: 'shev', fill: 0.55 },
    { dept: deptShev, svc: svcForeign,  staffId: petrenko.id,  citizens: verified, cap: 4, key: 'shev', fill: 0.45 },
    { dept: deptPech, svc: svcSocial,   staffId: kovalenko.id, citizens: all,      cap: 2, key: 'pech', fill: 0.60 },
    { dept: deptPech, svc: svcFop,      staffId: melnyk.id,    citizens: all,      cap: 2, key: 'pech', fill: 0.50 },
    { dept: deptPech, svc: svcLand,     staffId: bondar.id,    citizens: all,      cap: 2, key: 'pech', fill: 0.45 },
  ];

  const allSpecs: TicketSpec[] = [];
  for (const day of workDays) {
    for (const c of combos) {
      const [open, close] = day[c.key as 'shev' | 'pech'];
      allSpecs.push(...generateDayTickets(
        c.dept, c.svc, day.date, open, close, c.cap, c.staffId, c.citizens, c.fill,
      ));
    }
  }

  // ─── Талони на сьогодні (Сб, Шевченківський 09:00–14:00, жива черга з 13:00) ──
  // Кілька waiting-талонів щоб черга була не порожня: частина — записані на конкретний
  // час (фаза запису, до 13:00), частина — живочергові (time_slot: null, FIFO з 1)
  const todayPassportCitizens = [...verified].sort(() => Math.random() - 0.5).slice(0, 5);
  const todayForeignCitizens  = [...verified].sort(() => Math.random() - 0.5).slice(0, 3);

  // Сьогоднішні ПС: 3 за записом (слоти 09:00–11:00) + решта — жива черга
  const passportAppointments = todayPassportCitizens.slice(0, 3);
  const passportWalkins = todayPassportCitizens.slice(3);

  passportAppointments.forEach((citizen, idx) => {
    const slot = 9 + idx;
    allSpecs.push({
      client_id: citizen.id,
      service_id: svcPassport.id,
      department_id: deptShev.id,
      staff_id: null,
      ticket_number: idx + 1,
      prefix: 'ПС',
      status: 'waiting',
      scheduled_date: today,
      time_slot: `${String(slot).padStart(2, '0')}:00`,
      estimated_start_at: new Date(`${today}T${String(slot).padStart(2, '0')}:00:00`),
      estimated_end_at: new Date(`${today}T${String(slot).padStart(2, '0')}:00:00`),
      called_at: null,
      serving_started_at: null,
      completed_at: null,
      cancelled_at: null,
      is_missed_by_client: false,
    });
  });

  passportWalkins.forEach((citizen, idx) => {
    allSpecs.push({
      client_id: citizen.id,
      service_id: svcPassport.id,
      department_id: deptShev.id,
      staff_id: null,
      ticket_number: idx + 1,
      prefix: 'ПС',
      status: 'waiting',
      scheduled_date: today,
      time_slot: null,
      estimated_start_at: null,
      estimated_end_at: null,
      called_at: null,
      serving_started_at: null,
      completed_at: null,
      cancelled_at: null,
      is_missed_by_client: false,
    });
  });

  // Сьогоднішні ЗП: 2 за записом (слоти 10:00–11:00) + решта — жива черга
  const foreignAppointments = todayForeignCitizens.slice(0, 2);
  const foreignWalkins = todayForeignCitizens.slice(2);

  foreignAppointments.forEach((citizen, idx) => {
    const slot = 10 + idx;
    allSpecs.push({
      client_id: citizen.id,
      service_id: svcForeign.id,
      department_id: deptShev.id,
      staff_id: null,
      ticket_number: idx + 1,
      prefix: 'ЗП',
      status: 'waiting',
      scheduled_date: today,
      time_slot: `${String(slot).padStart(2, '0')}:00`,
      estimated_start_at: new Date(`${today}T${String(slot).padStart(2, '0')}:00:00`),
      estimated_end_at: new Date(`${today}T${String(slot).padStart(2, '0')}:00:00`),
      called_at: null,
      serving_started_at: null,
      completed_at: null,
      cancelled_at: null,
      is_missed_by_client: false,
    });
  });

  foreignWalkins.forEach((citizen, idx) => {
    allSpecs.push({
      client_id: citizen.id,
      service_id: svcForeign.id,
      department_id: deptShev.id,
      staff_id: null,
      ticket_number: idx + 1,
      prefix: 'ЗП',
      status: 'waiting',
      scheduled_date: today,
      time_slot: null,
      estimated_start_at: null,
      estimated_end_at: null,
      called_at: null,
      serving_started_at: null,
      completed_at: null,
      cancelled_at: null,
      is_missed_by_client: false,
    });
  });

  // ─── Майбутні записи (наступні 7 днів — межа MAX_ADVANCE_BOOKING_DAYS у tickets.service.ts) ──
  // Реалістичні «попередні записи» (waiting, time_slot заповнено) на кожен робочий день наперед,
  // щоб календарі (персонал/громадянин/особистий розклад) мали що показати на 2 тижні вперед:
  // дні 1-7 — заповнені бронюваннями (як і дозволяє система), дні 8-14 — навмисно порожні
  // (це теж коректний тестовий стан: запис на такі дати неможливий, тож і талонів там немає).
  const liveQueueHourFor = (dept: Department): number | null => {
    const h = dept.live_queue_from ? parseInt(dept.live_queue_from.split(':')[0], 10) : NaN;
    return isNaN(h) ? null : h;
  };

  const futureDates = Array.from({ length: 7 }, (_, i) => addDaysLocal(today, i + 1));

  const futureCombos = [
    { dept: deptShev, svc: svcPassport,  citizens: verified, fill: 0.5 },
    { dept: deptShev, svc: svcForeign,   citizens: verified, fill: 0.4 },
    { dept: deptShev, svc: svcResidence, citizens: all,      fill: 0.35 },
    { dept: deptPech, svc: svcSocial,    citizens: all,      fill: 0.55 },
    { dept: deptPech, svc: svcFop,       citizens: all,      fill: 0.4 },
    { dept: deptPech, svc: svcLand,      citizens: all,      fill: 0.35 },
  ];

  let futureCount = 0;
  for (const c of futureCombos) {
    const capacity = windowCountFor(c.dept.id, c.svc.id);
    const specs = generateFutureBookings(c.dept, c.svc, futureDates, capacity, c.citizens, c.fill, liveQueueHourFor(c.dept));
    allSpecs.push(...specs);
    futureCount += specs.length;
  }
  console.log(`Future bookings generated: ${futureCount} (across ${futureDates.length} days, ${today} → ${futureDates[futureDates.length - 1]})`);

  const ticketRepo = ds.getRepository(Ticket);
  const savedTickets = await ticketRepo.save(allSpecs.map(s => ticketRepo.create(s)));
  const completedTickets = savedTickets.filter(t => t.status === 'completed');
  console.log(`Tickets created: ${savedTickets.length} (${completedTickets.length} completed, ${savedTickets.filter(t => t.status === 'waiting').length} waiting today)`);

  // ─── Оцінки ───────────────────────────────────────────────────────────────────
  const ratingRepo = ds.getRepository(Rating);
  const ratingUpdates: Array<{ id: string; clientRatingId?: string; staffRatingId?: string; clientRating?: number; staffRating?: number }> = [];

  // Скор для клієнта: в залежності від його discipline score
  const citizenDiscMap = new Map(citizens.map(c => [c.id, citizenData.find(d => d.email === c.email)?.disc ?? 50]));

  const staffRatingScores: Array<{ citizenId: string; score: number }> = [];

  for (const ticket of completedTickets) {
    if (!ticket.staff_id || !ticket.client_id) continue;
    const update: (typeof ratingUpdates)[0] = { id: ticket.id };

    // 65% шанс оцінки від клієнта (4-5)
    if (chance(0.65)) {
      const score = rnd(3, 5);
      const r = await ratingRepo.save(ratingRepo.create({
        ticket_id: ticket.id,
        staff_id: ticket.staff_id,
        citizen_id: ticket.client_id,
        type: 'client',
        score,
        topic: pick(['швидко', 'ввічливо', 'компетентно', 'зручно', null, null]),
        comment: null,
      }));
      update.clientRatingId = r.id;
      update.clientRating = score;
    }

    // 55% шанс оцінки від спеціаліста (корелює з дисципліною)
    if (chance(0.55)) {
      const disc = citizenDiscMap.get(ticket.client_id) ?? 50;
      const score = disc >= 80 ? rnd(4, 5) : disc >= 60 ? rnd(3, 5) : disc >= 40 ? rnd(2, 4) : rnd(1, 3);
      const r = await ratingRepo.save(ratingRepo.create({
        ticket_id: ticket.id,
        staff_id: ticket.staff_id,
        citizen_id: ticket.client_id,
        type: 'staff',
        score,
        topic: pick(['пунктуальність', 'підготовленість', 'поведінка', null, null]),
        comment: null,
      }));
      update.staffRatingId = r.id;
      update.staffRating = score;
      staffRatingScores.push({ citizenId: ticket.client_id, score });
    }

    if (update.clientRatingId || update.staffRatingId) ratingUpdates.push(update);
  }

  // Оновлюємо поля талонів з рейтингами
  for (const u of ratingUpdates) {
    const patch: Partial<Ticket> = {};
    if (u.clientRatingId) { patch.rating_by_client_id = u.clientRatingId; patch.client_rating = u.clientRating; }
    if (u.staffRatingId)  { patch.rating_by_staff_id  = u.staffRatingId;  patch.staff_rating  = u.staffRating; }
    await ticketRepo.update(u.id, patch);
  }

  const totalRatings = ratingUpdates.length;
  console.log(`Ratings created: ~${totalRatings * 1.2 | 0} (client + staff)`);

  // ─── Перерахунок discipline_score ─────────────────────────────────────────────
  const scoresByCitizen = new Map<string, number[]>();
  for (const { citizenId, score } of staffRatingScores) {
    if (!scoresByCitizen.has(citizenId)) scoresByCitizen.set(citizenId, []);
    scoresByCitizen.get(citizenId)!.push(score);
  }

  for (const [citizenId, scores] of scoresByCitizen) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const discipline_score = Math.round(avg * 20);
    await userRepo.update(citizenId, { discipline_score });
  }
  console.log(`Discipline scores updated for ${scoresByCitizen.size} citizens`);

  // ─── Перерахунок рейтингу відділень ───────────────────────────────────────────
  for (const dept of [deptShev, deptPech]) {
    const result = await ds.query(
      `SELECT AVG(r.score)::float AS avg FROM ratings r
       INNER JOIN tickets t ON t.id::text = r.ticket_id
       WHERE t.department_id = $1 AND r.type = 'client'`,
      [dept.id],
    );
    const rating = parseFloat(result[0]?.avg ?? '0') || 0;
    await deptRepo.update(dept.id, { rating });
  }
  console.log('Department ratings updated');

  // ─── Підсумок ─────────────────────────────────────────────────────────────────
  console.log('\n=== Seed completed ===');
  console.log('\nАкаунти для входу:');
  console.log('  admin@queua.ua          / Admin1234!  (адмін)');
  console.log('  ivanova.m@queua.ua      / Staff1234!  (паспорти, ЦНАП Шевченківський)');
  console.log('  petrenko.o@queua.ua     / Staff1234!  (закордонні, ЦНАП Шевченківський)');
  console.log('  kovalenko.t@queua.ua    / Staff1234!  (соціальна, ЦНАП Печерський)');
  console.log('  melnyk.a@queua.ua       / Staff1234!  (ФОП, ЦНАП Печерський)');
  console.log('  bondar.n@queua.ua       / Staff1234!  (кадастр, ЦНАП Печерський)');
  console.log('  shevchenko.v@gmail.com  / User1234!   (громадянин, верифікований, disc=85)');
  console.log('  karpenko.d@gmail.com    / User1234!   (громадянин, НЕ верифікований, disc≈30 — проблемний)');
  console.log('  savchenko.l@gmail.com   / User1234!   (громадянин, верифікований, disc≈96 — відмінник)');
  console.log('  + 12 інших громадян з паролем User1234!');

  await ds.destroy();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
