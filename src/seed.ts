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
import { Ticket } from './tickets/ticket.entity';
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
  entities: [User, Department, QueueService, Window, RefreshToken, Ticket, TicketAudit, QueueCounter, Rating, Verification, DeptService, StaffAssignment, DisciplineEvent],
  synchronize: true,
  logging: false,
});

async function seed() {
  await ds.initialize();
  console.log('Connected to DB');

  // ─── Очищення ────────────────────────────────────────────────────────────────
  await ds.query(`TRUNCATE TABLE
    discipline_events, ticket_audits, ratings, tickets, queue_counters,
    verifications, refresh_tokens, windows, staff_assignments, department_services, users, services, departments
    RESTART IDENTITY CASCADE`);
  console.log('Cleaned tables');

  const today = new Date().toISOString().split('T')[0];

  // ─── Послуги ─────────────────────────────────────────────────────────────────
  const serviceRepo = ds.getRepository(QueueService);
  const [svcPassport, svcForeign, svcResidence, svcSocial, svcFop, svcLand] =
    await serviceRepo.save([
      {
        name: 'Оформлення паспорта громадянина України',
        description: 'Видача, обмін паспорта (ID-картки) громадянина України',
        requires_verification: true,
        estimated_duration_minutes: 20,
        ticket_prefix: 'ПС',
        is_active: true,
      },
      {
        name: 'Оформлення закордонного паспорта',
        description: 'Видача та продовження закордонного паспорта',
        requires_verification: true,
        estimated_duration_minutes: 15,
        ticket_prefix: 'ЗП',
        is_active: true,
      },
      {
        name: 'Реєстрація місця проживання',
        description: 'Реєстрація / зняття з реєстрації за місцем проживання або перебування',
        requires_verification: false,
        estimated_duration_minutes: 10,
        ticket_prefix: 'РЕ',
        is_active: true,
      },
      {
        name: 'Соціальна допомога та субсидії',
        description: 'Призначення субсидії на ЖКП, допомога малозабезпеченим сім\'ям, виплати при народженні',
        requires_verification: false,
        estimated_duration_minutes: 30,
        ticket_prefix: 'СО',
        is_active: true,
      },
      {
        name: 'Реєстрація та зміни ФОП',
        description: 'Реєстрація фізичної особи-підприємця, внесення змін, припинення діяльності',
        requires_verification: false,
        estimated_duration_minutes: 25,
        ticket_prefix: 'ФО',
        is_active: true,
      },
      {
        name: 'Земельний кадастр та право власності',
        description: 'Виписки з кадастру, реєстрація права власності на земельну ділянку',
        requires_verification: false,
        estimated_duration_minutes: 25,
        ticket_prefix: 'ЗЕ',
        is_active: true,
      },
    ]);
  console.log('Services created:', 6);

  // ─── Відділення ──────────────────────────────────────────────────────────────
  const deptRepo = ds.getRepository(Department);
  const [deptShev, deptPech] = await deptRepo.save([
    {
      name: 'ЦНАП Шевченківського району',
      address: 'вул. Хрещатик, 36',
      city: 'Київ',
      phone: '+38 044 202-40-00',
      latitude: 50.4501,
      longitude: 30.5234,
      working_hours: {
        mon: '08:00–19:00',
        tue: '08:00–19:00',
        wed: '08:00–19:00',
        thu: '08:00–19:00',
        fri: '08:00–18:00',
        sat: '09:00–14:00',
        sun: 'вихідний',
      },
      is_active: true,
    },
    {
      name: 'ЦНАП Печерського району',
      address: 'вул. Інститутська, 4',
      city: 'Київ',
      phone: '+38 044 253-60-60',
      latitude: 50.4399,
      longitude: 30.5332,
      working_hours: {
        mon: '09:00–18:00',
        tue: '09:00–18:00',
        wed: '09:00–18:00',
        thu: '09:00–18:00',
        fri: '09:00–17:00',
        sat: 'вихідний',
        sun: 'вихідний',
      },
      is_active: true,
    },
  ]);
  console.log('Departments created:', 2);

  // ─── Користувачі ─────────────────────────────────────────────────────────────
  const userRepo = ds.getRepository(User);

  const adminHash   = await bcrypt.hash('Admin1234!', 12);
  const staffHash   = await bcrypt.hash('Staff1234!', 12);
  const citizenHash = await bcrypt.hash('User1234!', 12);

  const [admin, ivanova, petrenko, kovalenko, melnyk, bondar, citizen1, citizen2] =
    await userRepo.save([
      {
        email: 'admin@queua.ua',
        password_hash: adminHash,
        first_name: 'Адміністратор',
        last_name: 'Системи',
        middle_name: null,
        phone: '+38 050 000-00-00',
        role: 'admin' as const,
        is_verified: true,
        discipline_score: 0,
        attendance_rate: 0,
        current_streak: 0,
      },
      {
        email: 'ivanova.m@queua.ua',
        password_hash: staffHash,
        first_name: 'Марина',
        last_name: 'Іванова',
        middle_name: 'Сергіївна',
        phone: '+38 067 111-22-33',
        role: 'staff' as const,
        is_verified: true,
        discipline_score: 0,
        attendance_rate: 0,
        current_streak: 0,
      },
      {
        email: 'petrenko.o@queua.ua',
        password_hash: staffHash,
        first_name: 'Олег',
        last_name: 'Петренко',
        middle_name: 'Васильович',
        phone: '+38 067 222-33-44',
        role: 'staff' as const,
        is_verified: true,
        discipline_score: 0,
        attendance_rate: 0,
        current_streak: 0,
      },
      {
        email: 'kovalenko.t@queua.ua',
        password_hash: staffHash,
        first_name: 'Тетяна',
        last_name: 'Коваленко',
        middle_name: 'Іванівна',
        phone: '+38 067 333-44-55',
        role: 'staff' as const,
        is_verified: true,
        discipline_score: 0,
        attendance_rate: 0,
        current_streak: 0,
      },
      {
        email: 'melnyk.a@queua.ua',
        password_hash: staffHash,
        first_name: 'Андрій',
        last_name: 'Мельник',
        middle_name: 'Петрович',
        phone: '+38 067 444-55-66',
        role: 'staff' as const,
        is_verified: true,
        discipline_score: 0,
        attendance_rate: 0,
        current_streak: 0,
      },
      {
        email: 'bondar.n@queua.ua',
        password_hash: staffHash,
        first_name: 'Наталія',
        last_name: 'Бондар',
        middle_name: 'Олексіївна',
        phone: '+38 067 555-66-77',
        role: 'staff' as const,
        is_verified: true,
        discipline_score: 0,
        attendance_rate: 0,
        current_streak: 0,
      },
      {
        email: 'shevchenko.v@gmail.com',
        password_hash: citizenHash,
        first_name: 'Василь',
        last_name: 'Шевченко',
        middle_name: 'Миколайович',
        phone: '+38 050 111-22-33',
        role: 'citizen' as const,
        is_verified: true,
        discipline_score: 85,
        attendance_rate: 0.92,
        current_streak: 5,
      },
      {
        email: 'kravchenko.o@gmail.com',
        password_hash: citizenHash,
        first_name: 'Олена',
        last_name: 'Кравченко',
        middle_name: 'Дмитрівна',
        phone: '+38 050 222-33-44',
        role: 'citizen' as const,
        is_verified: false,
        discipline_score: 60,
        attendance_rate: 0.75,
        current_streak: 2,
      },
    ]);
  console.log('Users created:', 8);

  // ─── Вікна ───────────────────────────────────────────────────────────────────
  const windowRepo = ds.getRepository(Window);
  await windowRepo.save([
    // Шевченківський ЦНАП — паспортні послуги
    { label: 'Вікно №1', department_id: deptShev.id, service_id: svcPassport.id, staff_id: ivanova.id,  status: 'open',   current_number: 0, date: today },
    { label: 'Вікно №2', department_id: deptShev.id, service_id: svcPassport.id, staff_id: null,        status: 'closed', current_number: 0, date: today },
    // Шевченківський ЦНАП — закордонний паспорт
    { label: 'Вікно №3', department_id: deptShev.id, service_id: svcForeign.id,  staff_id: petrenko.id, status: 'open',   current_number: 0, date: today },
    { label: 'Вікно №4', department_id: deptShev.id, service_id: svcForeign.id,  staff_id: null,        status: 'closed', current_number: 0, date: today },
    // Шевченківський ЦНАП — реєстрація місця проживання
    { label: 'Вікно №5', department_id: deptShev.id, service_id: svcResidence.id, staff_id: null,       status: 'closed', current_number: 0, date: today },

    // Печерський ЦНАП — соціальна допомога
    { label: 'Вікно №1', department_id: deptPech.id, service_id: svcSocial.id,   staff_id: kovalenko.id, status: 'open',  current_number: 0, date: today },
    { label: 'Вікно №2', department_id: deptPech.id, service_id: svcSocial.id,   staff_id: null,         status: 'closed', current_number: 0, date: today },
    // Печерський ЦНАП — реєстрація ФОП
    { label: 'Вікно №3', department_id: deptPech.id, service_id: svcFop.id,      staff_id: melnyk.id,    status: 'open',  current_number: 0, date: today },
    // Печерський ЦНАП — земельний кадастр
    { label: 'Вікно №4', department_id: deptPech.id, service_id: svcLand.id,     staff_id: bondar.id,    status: 'open',  current_number: 0, date: today },
    { label: 'Вікно №5', department_id: deptPech.id, service_id: svcLand.id,     staff_id: null,         status: 'closed', current_number: 0, date: today },
  ]);
  console.log('Windows created:', 10);

  // ─── Послуги відділень ───────────────────────────────────────────────────────
  const deptSvcRepo = ds.getRepository(DeptService);
  await deptSvcRepo.save([
    // Шевченківський: паспорт, закордонний, реєстрація місця проживання
    { department_id: deptShev.id, service_id: svcPassport.id,  is_active: true },
    { department_id: deptShev.id, service_id: svcForeign.id,   is_active: true },
    { department_id: deptShev.id, service_id: svcResidence.id, is_active: true },
    // Печерський: соціальна допомога, реєстрація ФОП, земельний кадастр, реєстрація місця проживання
    { department_id: deptPech.id, service_id: svcSocial.id,    is_active: true },
    { department_id: deptPech.id, service_id: svcFop.id,       is_active: true },
    { department_id: deptPech.id, service_id: svcLand.id,      is_active: true },
    { department_id: deptPech.id, service_id: svcResidence.id, is_active: true },
  ]);
  console.log('Department services linked:', 7);

  // ─── Призначення персоналу ────────────────────────────────────────────────────
  const staffAssignRepo = ds.getRepository(StaffAssignment);
  await staffAssignRepo.save([
    // Шевченківський: Іванова — паспорт, Петренко — закордонний
    { department_id: deptShev.id, service_id: svcPassport.id,  staff_id: ivanova.id },
    { department_id: deptShev.id, service_id: svcForeign.id,   staff_id: petrenko.id },
    // Печерський: Коваленко — соціальна, Мельник — ФОП, Бондар — кадастр
    { department_id: deptPech.id, service_id: svcSocial.id,    staff_id: kovalenko.id },
    { department_id: deptPech.id, service_id: svcFop.id,       staff_id: melnyk.id },
    { department_id: deptPech.id, service_id: svcLand.id,      staff_id: bondar.id },
  ]);
  console.log('Staff assignments created:', 5);

  // ─── Підсумок ─────────────────────────────────────────────────────────────────
  console.log('\n=== Seed completed ===');
  console.log('\nАккаунти для входу:');
  console.log('  admin@queua.ua         / Admin1234!   (адмін)');
  console.log('  ivanova.m@queua.ua     / Staff1234!   (спец. паспортний відділ, ЦНАП Шевченківський)');
  console.log('  petrenko.o@queua.ua    / Staff1234!   (спец. закордонні паспорти, ЦНАП Шевченківський)');
  console.log('  kovalenko.t@queua.ua   / Staff1234!   (спец. соціальна допомога, ЦНАП Печерський)');
  console.log('  melnyk.a@queua.ua      / Staff1234!   (спец. реєстрація ФОП, ЦНАП Печерський)');
  console.log('  bondar.n@queua.ua      / Staff1234!   (спец. земельний кадастр, ЦНАП Печерський)');
  console.log('  shevchenko.v@gmail.com / User1234!    (громадянин, верифікований)');
  console.log('  kravchenko.o@gmail.com / User1234!    (громадянин, не верифікований)');

  await ds.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
