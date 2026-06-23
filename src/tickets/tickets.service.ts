import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { Ticket } from './ticket.entity';
import { Window } from '../windows/window.entity';
import { QueueService } from '../services/service.entity';
import { Department } from '../departments/department.entity';
import { User } from '../users/user.entity';
import { AuditsService } from '../audits/audits.service';
import { BookTicketDto } from './dto/book-ticket.dto';
import { ManualTicketDto } from './dto/manual-ticket.dto';
import { IdentifyClientDto } from './dto/identify-client.dto';
import { CompleteTicketDto } from './dto/complete-ticket.dto';
import { QueryTicketsDto } from './dto/query-tickets.dto';
import { QueueGateway } from '../queue/queue.gateway';
import { DepartmentServicesService } from '../department-services/department-services.service';
import { DisciplineEventsService } from '../discipline-events/discipline-events.service';
import { QueueCounter } from '../queue-counters/queue-counter.entity';

// Запис наперед можливий не більш ніж на стільки днів від сьогодні
const MAX_ADVANCE_BOOKING_DAYS = 7;

@Injectable()
export class TicketsService {
  constructor(
    @InjectRepository(Ticket)
    private readonly repo: Repository<Ticket>,
    @InjectRepository(Window)
    private readonly windowRepo: Repository<Window>,
    @InjectRepository(QueueService)
    private readonly serviceRepo: Repository<QueueService>,
    @InjectRepository(Department)
    private readonly deptRepo: Repository<Department>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly auditsService: AuditsService,
    private readonly queueGateway: QueueGateway,
    private readonly deptServicesService: DepartmentServicesService,
    private readonly disciplineEvents: DisciplineEventsService,
    private readonly dataSource: DataSource,
  ) {}

  // ─── Слоти (публічний перегляд) ──────────────────────────────────────────

  async getSlots(departmentId: string, serviceId: string, date: string) {
    const dept = await this.deptRepo.findOneBy({ id: departmentId });
    if (!dept) throw new NotFoundException('Відділення не знайдено');

    const svc = await this.serviceRepo.findOneBy({ id: serviceId });
    if (!svc) throw new NotFoundException('Послугу не знайдено');

    const hours = this.parseWorkingHours(dept, date);
    if (!hours) return [];

    const capacity = await this.calcSlotCapacity(departmentId, serviceId);
    if (capacity === 0) return [];

    // Слоти для попереднього запису доступні лише до початку фази живої черги
    const liveQueueFromHour = this.parseLiveQueueHour(dept);
    const bookingCloseHour =
      liveQueueFromHour !== null ? Math.min(liveQueueFromHour, hours.closeHour) : hours.closeHour;

    const slots: { time: string; capacity: number; booked: number; available: number }[] = [];

    for (const time of this.slotTimes(hours.openHour, bookingCloseHour, svc.estimated_duration_minutes)) {
      const booked = await this.countActiveInSlot(departmentId, serviceId, date, time);
      slots.push({ time, capacity, booked, available: Math.max(0, capacity - booked) });
    }

    return slots;
  }

  // ─── Бронювання (citizen) ─────────────────────────────────────────────────

  async book(clientId: string, dto: BookTicketDto) {
    const hasActive = await this.repo
      .createQueryBuilder('t')
      .where('t.client_id = :clientId', { clientId })
      .andWhere('t.department_id = :deptId', { deptId: dto.department_id })
      .andWhere('t.service_id = :svcId', { svcId: dto.service_id })
      .andWhere('t.status IN (:...statuses)', { statuses: ['waiting', 'called', 'serving'] })
      .getExists();

    if (hasActive) throw new BadRequestException('Ви вже стоїте в цій черзі');

    const svc = await this.serviceRepo.findOneBy({ id: dto.service_id });
    if (!svc) throw new NotFoundException('Послугу не знайдено');

    const user = await this.userRepo.findOneBy({ id: clientId });

    if (svc.min_discipline_score > 0) {
      if (user && user.discipline_score < svc.min_discipline_score) {
        throw new ForbiddenException(
          `Для цієї послуги потрібен рейтинг дисципліни ≥ ${svc.min_discipline_score}. Ваш: ${user.discipline_score}`,
        );
      }
    }

    // Клієнт з низькою явкою не може записуватись наперед — лише жива черга
    const MIN_ATTENDANCE_FOR_ADVANCE = 0.5;
    const isAdvanceBooking = !!(dto.scheduled_date || dto.time_slot);
    if (
      isAdvanceBooking &&
      user &&
      user.attendance_rate < MIN_ATTENDANCE_FOR_ADVANCE
    ) {
      throw new ForbiddenException(
        `Ваша явка ${(user.attendance_rate * 100).toFixed(0)}% нижча за мінімально допустиму (${MIN_ATTENDANCE_FOR_ADVANCE * 100}%). Попередній запис недоступний — скористайтесь живою чергою.`,
      );
    }

    const serviceInDept = await this.deptServicesService.isActiveInDepartment(
      dto.department_id,
      dto.service_id,
    );
    if (!serviceInDept) throw new NotFoundException('Ця послуга не надається у даному відділенні');

    const dept = await this.deptRepo.findOneBy({ id: dto.department_id });
    if (!dept) throw new NotFoundException('Відділення не знайдено');

    const today = new Date().toISOString().split('T')[0];
    const scheduledDate = dto.scheduled_date ?? today;

    if (scheduledDate < today) throw new BadRequestException('Не можна бронювати на минулу дату');

    const maxBookingDate = new Date();
    maxBookingDate.setDate(maxBookingDate.getDate() + MAX_ADVANCE_BOOKING_DAYS);
    if (new Date(scheduledDate) > maxBookingDate)
      throw new BadRequestException(`Запис можливий не більш ніж на ${MAX_ADVANCE_BOOKING_DAYS} днів наперед`);

    const hours = this.parseWorkingHours(dept, scheduledDate);
    if (!hours) throw new BadRequestException(`${dept.name} не працює у цей день`);

    const liveQueueFromHour = this.parseLiveQueueHour(dept);
    const isWalkInRequest = !dto.scheduled_date && !dto.time_slot;
    const currentHour = new Date().getHours();

    // ─── Жива черга: номер «тут і зараз», без слоту і без капасіті ──────────
    if (isWalkInRequest) {
      if (liveQueueFromHour === null)
        throw new BadRequestException('Це відділення приймає лише за попереднім записом');

      if (currentHour < hours.openHour) throw new BadRequestException(`${dept.name} ще не відкрито`);
      if (currentHour >= hours.closeHour) throw new BadRequestException(`${dept.name} вже зачинено`);
      if (currentHour < liveQueueFromHour)
        throw new BadRequestException(`Жива черга у ${dept.name} починається о ${dept.live_queue_from}`);

      // Кількість відкритих вікон для паралельного обслуговування
      const windowCount = await this.windowRepo.count({
        where: { department_id: dto.department_id, service_id: dto.service_id, status: Not('closed') },
      });
      const effectiveWindows = Math.max(1, windowCount);

      const ticketNumber = await this.dataSource.transaction(async (manager) => {
        // Блокуємо рядок лічильника як м'ютекс для атомарної видачі номера
        let counter = await manager.findOne(QueueCounter, {
          where: { department_id: dto.department_id, service_id: dto.service_id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!counter) {
          counter = manager.create(QueueCounter, {
            department_id: dto.department_id,
            service_id: dto.service_id,
            next_number: 1,
          });
          await manager.save(QueueCounter, counter);
        }

        // Перевірка залишкового часу: чи встигне відділення обслужити всіх + цього клієнта до закриття
        const activeNow = await manager.count(Ticket, {
          where: [
            { department_id: dto.department_id, service_id: dto.service_id, scheduled_date: today, time_slot: IsNull(), status: 'waiting' },
            { department_id: dto.department_id, service_id: dto.service_id, scheduled_date: today, time_slot: IsNull(), status: 'called' },
            { department_id: dto.department_id, service_id: dto.service_id, scheduled_date: today, time_slot: IsNull(), status: 'serving' },
          ],
        });

        const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
        const remainingMinutes = hours.closeHour * 60 - nowMinutes;
        const timeNeeded = Math.ceil((activeNow + 1) / effectiveWindows) * svc.estimated_duration_minutes;

        if (timeNeeded > remainingMinutes)
          throw new BadRequestException(
            `Відділення не встигне вас обслужити до закриття (${String(hours.closeHour).padStart(2, '0')}:00). В черзі: ${activeNow} ос.`,
          );

        const maxRow = await manager
          .createQueryBuilder(Ticket, 't')
          .select('MAX(t.ticket_number)', 'max')
          .where('t.department_id = :deptId', { deptId: dto.department_id })
          .andWhere('t.service_id = :svcId', { svcId: dto.service_id })
          .andWhere('t.scheduled_date = :date', { date: today })
          .andWhere('t.time_slot IS NULL')
          .getRawOne<{ max: number | null }>();

        return (maxRow?.max ?? 0) + 1;
      });

      const ticket = this.repo.create({
        window_id: null,
        client_id: clientId,
        service_id: dto.service_id,
        department_id: dto.department_id,
        ticket_number: ticketNumber,
        prefix: svc.ticket_prefix,
        status: 'waiting',
        scheduled_date: today,
        time_slot: null,
        estimated_start_at: null,
        estimated_end_at: null,
      });

      const saved = await this.repo.save(ticket);
      this.queueGateway.emitTicketIssued(saved.department_id, saved);
      return saved;
    }

    // ─── Попередній запис: конкретні дата + час у межах фази запису ─────────
    const bookingCloseHour = liveQueueFromHour ?? hours.closeHour;

    if (scheduledDate === today && liveQueueFromHour !== null && currentHour >= liveQueueFromHour) {
      throw new BadRequestException(
        `Запис на сьогодні вже закрито — ${dept.name} перейшло у режим живої черги (з ${dept.live_queue_from})`,
      );
    }

    const capacity = await this.calcSlotCapacity(dto.department_id, dto.service_id);
    const slotInterval = svc.estimated_duration_minutes;
    const allSlotTimes = this.slotTimes(hours.openHour, bookingCloseHour, slotInterval);

    let timeSlot = this.resolveTimeSlot(dto.time_slot, scheduledDate, today, hours, dept.name, slotInterval, bookingCloseHour);

    if (!dto.time_slot && scheduledDate === today) {
      const startIdx = Math.max(0, allSlotTimes.indexOf(timeSlot));
      let found = false;
      for (let i = startIdx; i < allSlotTimes.length; i++) {
        const slot = allSlotTimes[i];
        const taken = await this.countActiveInSlot(dto.department_id, dto.service_id, scheduledDate, slot);
        if (taken < capacity) { timeSlot = slot; found = true; break; }
      }
      if (!found) throw new BadRequestException(`На сьогодні всі слоти запису заповнені. Спробуйте завтра.`);
    }

    const slotIndex = Math.max(0, allSlotTimes.indexOf(timeSlot));
    const slotStartNumber = slotIndex * capacity + 1;

    // Атомарно видаємо номер у слоті
    const ticketNumber = await this.dataSource.transaction(async (manager) => {
      // Блокуємо рядок лічильника як м'ютекс для цієї черги
      let counter = await manager.findOne(QueueCounter, {
        where: { department_id: dto.department_id, service_id: dto.service_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!counter) {
        counter = manager.create(QueueCounter, {
          department_id: dto.department_id,
          service_id: dto.service_id,
          next_number: 1,
        });
        await manager.save(QueueCounter, counter);
      }

      const countInSlot = await manager.count(Ticket, {
        where: [
          { department_id: dto.department_id, service_id: dto.service_id, scheduled_date: scheduledDate, time_slot: timeSlot, status: 'waiting' },
          { department_id: dto.department_id, service_id: dto.service_id, scheduled_date: scheduledDate, time_slot: timeSlot, status: 'called' },
          { department_id: dto.department_id, service_id: dto.service_id, scheduled_date: scheduledDate, time_slot: timeSlot, status: 'serving' },
          { department_id: dto.department_id, service_id: dto.service_id, scheduled_date: scheduledDate, time_slot: timeSlot, status: 'completed' },
          { department_id: dto.department_id, service_id: dto.service_id, scheduled_date: scheduledDate, time_slot: timeSlot, status: 'missed' },
        ],
      });

      if (countInSlot >= capacity) {
        throw new BadRequestException(`Слот ${timeSlot} вже заповнений. Оберіть інший час.`);
      }

      return slotStartNumber + countInSlot;
    });

    const slotStart = new Date(`${scheduledDate}T${timeSlot}:00`);
    const ticket = this.repo.create({
      window_id: null,
      client_id: clientId,
      service_id: dto.service_id,
      department_id: dto.department_id,
      ticket_number: ticketNumber,
      prefix: svc.ticket_prefix,
      status: 'waiting',
      scheduled_date: scheduledDate,
      time_slot: timeSlot,
      estimated_start_at: slotStart,
      estimated_end_at: new Date(slotStart.getTime() + svc.estimated_duration_minutes * 60_000),
    });

    const saved = await this.repo.save(ticket);
    this.queueGateway.emitTicketIssued(saved.department_id, saved);
    return saved;
  }

  // ─── Ручна видача (staff) ─────────────────────────────────────────────────

  async issueManual(staffId: string, dto: ManualTicketDto) {
    const window = await this.windowRepo.findOneBy({ id: dto.window_id });
    if (!window) throw new NotFoundException('Вікно не знайдено');

    const svc = await this.serviceRepo.findOneBy({ id: dto.service_id });
    if (!svc) throw new NotFoundException('Послугу не знайдено');

    if (svc.requires_verification && !dto.client_id)
      throw new BadRequestException('Ця послуга потребує верифікації — оберіть клієнта з акаунтом');

    const today = new Date().toISOString().split('T')[0];

    // Талони, видані вручну, потрапляють у той самий пул живої черги (time_slot IS NULL),
    // тож нумеруємо їх тим самим лічильником, що й самостійно отримані живочергові номери.
    const ticketNumber = await this.dataSource.transaction(async (manager) => {
      let counter = await manager.findOne(QueueCounter, {
        where: { department_id: window.department_id, service_id: dto.service_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!counter) {
        counter = manager.create(QueueCounter, {
          department_id: window.department_id,
          service_id: dto.service_id,
          next_number: 1,
        });
        await manager.save(QueueCounter, counter);
      }

      const maxRow = await manager
        .createQueryBuilder(Ticket, 't')
        .select('MAX(t.ticket_number)', 'max')
        .where('t.department_id = :deptId', { deptId: window.department_id })
        .andWhere('t.service_id = :svcId', { svcId: dto.service_id })
        .andWhere('t.scheduled_date = :date', { date: today })
        .andWhere('t.time_slot IS NULL')
        .getRawOne<{ max: number | null }>();

      return (maxRow?.max ?? 0) + 1;
    });

    const ticket = this.repo.create({
      window_id: dto.window_id,
      client_id: dto.client_id ?? '',
      staff_id: staffId,
      service_id: dto.service_id,
      department_id: window.department_id,
      ticket_number: ticketNumber,
      prefix: svc.ticket_prefix,
      status: 'waiting',
      scheduled_date: today,
      time_slot: null,
    });

    const saved = await this.repo.save(ticket);
    this.queueGateway.emitTicketIssued(saved.department_id, saved);
    return saved;
  }

  // ─── Виклик наступного з черги ────────────────────────────────────────────

  async callNextFromWindow(windowId: string, staffId: string) {
    const window = await this.windowRepo.findOneBy({ id: windowId });
    if (!window) throw new NotFoundException('Вікно не знайдено');
    if (window.staff_id !== staffId) throw new ForbiddenException('Ви не сидите за цим вікном');
    if (window.status === 'paused') throw new BadRequestException('Вікно на паузі');

    const today = new Date().toISOString().split('T')[0];
    const dept = await this.deptRepo.findOneBy({ id: window.department_id });
    const isLivePhase = this.isLiveQueuePhase(dept);

    // SELECT FOR UPDATE — атомарно захоплює наступний талон з пулу, що відповідає поточній фазі:
    // у фазі запису обслуговуємо записаних строго за часом слоту (і лише ті, чий час уже настав),
    // у фазі живої черги — живочергових по черзі видачі номера (FIFO)
    const ticket = await this.dataSource.transaction(async (manager) => {
      const qb = manager
        .createQueryBuilder(Ticket, 't')
        .where('t.department_id = :dep', { dep: window.department_id })
        .andWhere('t.service_id = :svc', { svc: window.service_id })
        .andWhere('t.status = :status', { status: 'waiting' })
        .andWhere('t.window_id IS NULL')
        .andWhere('t.scheduled_date = :today', { today });

      if (isLivePhase) {
        qb.andWhere('t.time_slot IS NULL').orderBy('t.ticket_number', 'ASC');
      } else {
        const currentHour = new Date().getHours();
        qb.andWhere('t.time_slot IS NOT NULL')
          .andWhere("CAST(SPLIT_PART(t.time_slot, ':', 1) AS INT) <= :hour", { hour: currentHour })
          .orderBy('t.time_slot', 'ASC')
          .addOrderBy('t.ticket_number', 'ASC');
      }

      const t = await qb.setLock('pessimistic_write').getOne();

      if (!t) throw new NotFoundException('Черга порожня');

      t.window_id = windowId;
      t.staff_id = staffId;
      t.status = 'called';
      t.called_at = new Date();

      return manager.save(Ticket, t);
    });

    window.current_number = ticket.ticket_number;
    await this.windowRepo.save(window);

    await this.auditsService.record({ ticket_id: ticket.id, staff_id: staffId, action: 'called' });
    const saved = await this.repo.save(ticket);
    this.queueGateway.emitTicketCalled(saved.department_id, saved);
    return saved;
  }

  // ─── Інфо про живу чергу (публічний) ────────────────────────────────────

  async getQueueInfo(departmentId: string, serviceId: string) {
    const dept = await this.deptRepo.findOneBy({ id: departmentId });
    const svc  = await this.serviceRepo.findOneBy({ id: serviceId });
    if (!dept || !svc) return { live_queue_from: null, current_waiting: 0, estimated_wait_minutes: null, can_join: false };

    const today = new Date().toISOString().split('T')[0];
    const hours = this.parseWorkingHours(dept, today);
    const liveQueueFromHour = this.parseLiveQueueHour(dept);

    if (!hours || liveQueueFromHour === null)
      return { live_queue_from: dept.live_queue_from, current_waiting: 0, estimated_wait_minutes: null, can_join: false };

    const nowMinutes      = new Date().getHours() * 60 + new Date().getMinutes();
    const remainingMinutes = hours.closeHour * 60 - nowMinutes;
    const isLivePhase     = new Date().getHours() >= liveQueueFromHour;

    const windowCount = await this.windowRepo.count({
      where: { department_id: departmentId, service_id: serviceId, status: Not('closed') },
    });
    const effectiveWindows = Math.max(1, windowCount);

    const activeNow = await this.repo.count({
      where: [
        { department_id: departmentId, service_id: serviceId, scheduled_date: today, time_slot: IsNull(), status: 'waiting' },
        { department_id: departmentId, service_id: serviceId, scheduled_date: today, time_slot: IsNull(), status: 'called' },
        { department_id: departmentId, service_id: serviceId, scheduled_date: today, time_slot: IsNull(), status: 'serving' },
      ],
    });

    const estimated_wait_minutes = Math.ceil((activeNow + 1) / effectiveWindows) * svc.estimated_duration_minutes;
    const can_join = isLivePhase && estimated_wait_minutes <= remainingMinutes;

    return {
      live_queue_from: dept.live_queue_from,
      current_waiting: activeNow,
      estimated_wait_minutes,
      can_join,
    };
  }

  // ─── Читання ──────────────────────────────────────────────────────────────

  async getActive(clientId: string) {
    const ticket = await this.repo
      .createQueryBuilder('t')
      .where('t.client_id = :clientId', { clientId })
      .andWhere('t.status IN (:...statuses)', { statuses: ['waiting', 'called', 'serving'] })
      .orderBy('t.issued_at', 'DESC')
      .getOne();

    if (!ticket) return null;

    const [svc, dept] = await Promise.all([
      this.serviceRepo.findOneBy({ id: ticket.service_id }),
      this.deptRepo.findOneBy({ id: ticket.department_id }),
    ]);

    const position =
      ticket.status === 'waiting'
        ? await this.countAheadInSlot(ticket)
        : 0;

    const estimated_start_at =
      ticket.status === 'waiting' && !ticket.time_slot && svc
        ? new Date(Date.now() + position * svc.estimated_duration_minutes * 60000).toISOString()
        : ticket.estimated_start_at?.toISOString() ?? null;

    return {
      id: ticket.id,
      window_id: ticket.window_id,
      client_id: ticket.client_id,
      staff_id: ticket.staff_id,
      service_id: ticket.service_id,
      department_id: ticket.department_id,
      ticket_number: ticket.ticket_number,
      prefix: ticket.prefix,
      status: ticket.status,
      is_missed_by_client: ticket.is_missed_by_client,
      issued_at: ticket.issued_at,
      called_at: ticket.called_at,
      estimated_start_at,
      estimated_end_at: ticket.estimated_end_at,
      serving_started_at: ticket.serving_started_at,
      completed_at: ticket.completed_at,
      cancelled_at: ticket.cancelled_at,
      scheduled_date: ticket.scheduled_date,
      time_slot: ticket.time_slot,
      rating_by_client_id: ticket.rating_by_client_id,
      rating_by_staff_id: ticket.rating_by_staff_id,
      client_rating: ticket.client_rating,
      service_name: svc?.name ?? null,
      service_duration_minutes: svc?.estimated_duration_minutes ?? null,
      department_name: dept?.name ?? null,
      department_address: dept?.address ?? null,
      department_city: dept?.city ?? null,
      position,
    };
  }

  async getMy(clientId: string, page: number, pageSize: number) {
    const tickets = await this.repo
      .createQueryBuilder('t')
      .where('t.client_id = :clientId', { clientId })
      .orderBy('t.issued_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    // Batch-load services and departments to avoid N+1
    const svcIds = [...new Set(tickets.map((t) => t.service_id).filter(Boolean))];
    const deptIds = [...new Set(tickets.map((t) => t.department_id).filter(Boolean))];
    const [svcs, depts] = await Promise.all([
      svcIds.length ? this.serviceRepo.findBy({ id: In(svcIds) }) : Promise.resolve([]),
      deptIds.length ? this.deptRepo.findBy({ id: In(deptIds) }) : Promise.resolve([]),
    ]);
    const svcMap = new Map(svcs.map((s) => [s.id, s]));
    const deptMap = new Map(depts.map((d) => [d.id, d]));

    return Promise.all(tickets.map(async (t) => {
      const svc = svcMap.get(t.service_id) ?? null;
      const dept = deptMap.get(t.department_id) ?? null;
      let position: number | null = null;
      let estimated_start_at: string | null = t.estimated_start_at?.toISOString() ?? null;

      if (t.status === 'waiting') {
        position = await this.countAheadInSlot(t);
        if (!t.time_slot && svc) {
          estimated_start_at = new Date(
            Date.now() + position * svc.estimated_duration_minutes * 60000,
          ).toISOString();
        }
      }

      return {
        id: t.id,
        window_id: t.window_id,
        client_id: t.client_id,
        staff_id: t.staff_id,
        service_id: t.service_id,
        department_id: t.department_id,
        ticket_number: t.ticket_number,
        prefix: t.prefix,
        status: t.status,
        is_missed_by_client: t.is_missed_by_client,
        issued_at: t.issued_at,
        called_at: t.called_at,
        estimated_start_at,
        estimated_end_at: t.estimated_end_at,
        serving_started_at: t.serving_started_at,
        completed_at: t.completed_at,
        cancelled_at: t.cancelled_at,
        scheduled_date: t.scheduled_date,
        time_slot: t.time_slot,
        rating_by_client_id: t.rating_by_client_id,
        rating_by_staff_id: t.rating_by_staff_id,
        client_rating: t.client_rating,
        client_comment: t.client_comment,
        client_rating_topic: t.client_rating_topic,
        staff_rating: t.staff_rating,
        staff_rating_topic: t.staff_rating_topic,
        staff_rating_comment: t.staff_rating_comment,
        service_name: svc?.name ?? null,
        service_duration_minutes: svc?.estimated_duration_minutes ?? null,
        department_name: dept?.name ?? null,
        department_address: dept?.address ?? null,
        department_city: dept?.city ?? null,
        position,
      };
    }));
  }

  async findOne(id: string, requesterId: string, requesterRole: string) {
    const ticket = await this.repo.findOneBy({ id });
    if (!ticket) throw new NotFoundException('Талон не знайдено');

    if (requesterRole === 'citizen' && ticket.client_id !== requesterId)
      throw new ForbiddenException('Доступ заборонено');

    const [svc, dept] = await Promise.all([
      this.serviceRepo.findOneBy({ id: ticket.service_id }),
      this.deptRepo.findOneBy({ id: ticket.department_id }),
    ]);

    const position =
      ticket.status === 'waiting' ? await this.countAheadInSlot(ticket) : 0;

    let client: object | null = null;
    let staff: object | null = null;

    if (requesterRole !== 'citizen' && ticket.client_id) {
      const u = await this.userRepo.findOneBy({ id: ticket.client_id });
      if (u) client = { id: u.id, first_name: u.first_name, last_name: u.last_name, email: u.email, phone: u.phone };
    }
    if (ticket.staff_id) {
      const u = await this.userRepo.findOneBy({ id: ticket.staff_id });
      if (u) staff = { id: u.id, first_name: u.first_name, last_name: u.last_name, email: u.email };
    }

    return {
      id: ticket.id,
      window_id: ticket.window_id,
      client_id: ticket.client_id,
      staff_id: ticket.staff_id,
      service_id: ticket.service_id,
      department_id: ticket.department_id,
      ticket_number: ticket.ticket_number,
      prefix: ticket.prefix,
      status: ticket.status,
      is_missed_by_client: ticket.is_missed_by_client,
      issued_at: ticket.issued_at,
      called_at: ticket.called_at,
      estimated_start_at: ticket.estimated_start_at,
      estimated_end_at: ticket.estimated_end_at,
      serving_started_at: ticket.serving_started_at,
      completed_at: ticket.completed_at,
      cancelled_at: ticket.cancelled_at,
      scheduled_date: ticket.scheduled_date,
      time_slot: ticket.time_slot,
      rating_by_client_id: ticket.rating_by_client_id,
      rating_by_staff_id: ticket.rating_by_staff_id,
      client_rating: ticket.client_rating,
      client_comment: ticket.client_comment,
      client_rating_topic: ticket.client_rating_topic,
      staff_rating: ticket.staff_rating,
      staff_rating_topic: ticket.staff_rating_topic,
      staff_rating_comment: ticket.staff_rating_comment,
      service_name: svc?.name ?? null,
      service_duration_minutes: svc?.estimated_duration_minutes ?? null,
      department_name: dept?.name ?? null,
      department_address: dept?.address ?? null,
      department_city: dept?.city ?? null,
      position,
      client,
      staff,
    };
  }

  async findAll(query: QueryTicketsDto) {
    const { department_id, window_id, date, status, staff_id, page = 1, page_size = 20 } = query;
    const qb = this.repo.createQueryBuilder('t').orderBy('t.ticket_number', 'ASC');

    if (department_id) qb.andWhere('t.department_id = :department_id', { department_id });
    if (window_id) qb.andWhere('t.window_id = :window_id', { window_id });
    if (status) qb.andWhere('t.status = :status', { status });
    if (date) qb.andWhere('t.scheduled_date = :date', { date });
    if (staff_id) qb.andWhere('t.staff_id = :staff_id', { staff_id });

    return qb.skip((page - 1) * page_size).take(page_size).getMany();
  }

  async getWindowQueue(windowId: string) {
    const window = await this.windowRepo.findOneBy({ id: windowId });
    if (!window) throw new NotFoundException('Вікно не знайдено');

    const today = new Date().toISOString().split('T')[0];
    const dept = await this.deptRepo.findOneBy({ id: window.department_id });

    const [waiting, active] = await Promise.all([
      this.queryWaitingForWindow(window, dept, today).getMany(),
      this.repo.findOne({
        where: [
          { window_id: windowId, status: 'called' },
          { window_id: windowId, status: 'serving' },
        ],
        order: { called_at: 'DESC' },
      }),
    ]);

    return { waiting, active: active ?? null };
  }

  async countWaitingForWindow(window: Window): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const dept = await this.deptRepo.findOneBy({ id: window.department_id });
    return this.queryWaitingForWindow(window, dept, today).getCount();
  }

  // Будує запит на «талони, що очікують саме у пулі поточної фази» —
  // живочергові у фазі живої черги, записані (чий час уже настав) у фазі запису
  private queryWaitingForWindow(window: Window, dept: Department | null, today: string) {
    const isLivePhase = this.isLiveQueuePhase(dept);
    const qb = this.repo
      .createQueryBuilder('t')
      .where('t.department_id = :dep', { dep: window.department_id })
      .andWhere('t.service_id = :svc', { svc: window.service_id })
      .andWhere('t.status = :status', { status: 'waiting' })
      .andWhere('t.scheduled_date = :today', { today });

    if (isLivePhase) {
      qb.andWhere('t.time_slot IS NULL').orderBy('t.ticket_number', 'ASC');
    } else {
      const currentHour = new Date().getHours();
      qb.andWhere('t.time_slot IS NOT NULL')
        .andWhere("CAST(SPLIT_PART(t.time_slot, ':', 1) AS INT) <= :hour", { hour: currentHour })
        .orderBy('t.time_slot', 'ASC')
        .addOrderBy('t.ticket_number', 'ASC');
    }

    return qb;
  }

  // ─── Дії citizen ──────────────────────────────────────────────────────────

  async cancel(ticketId: string, clientId: string) {
    const ticket = await this.repo.findOneBy({ id: ticketId });
    if (!ticket) throw new NotFoundException('Талон не знайдено');
    if (ticket.client_id !== clientId) throw new ForbiddenException('Доступ заборонено');
    if (!['waiting', 'called'].includes(ticket.status))
      throw new UnprocessableEntityException('Талон вже не можна скасувати');

    ticket.status = 'cancelled';
    ticket.cancelled_at = new Date();

    await this.auditsService.record({ ticket_id: ticket.id, staff_id: clientId, action: 'cancelled' });
    const saved = await this.repo.save(ticket);
    this.queueGateway.emitTicketUpdated(saved.department_id, saved);
    return saved;
  }

  // ─── Дії staff ────────────────────────────────────────────────────────────

  // Привʼязати клієнта до анонімного талону — обовʼязково перед початком обслуговування:
  // або знайти/підтвердити існуючий акаунт, або створити новий за пред'явленими документами
  async identifyClient(ticketId: string, staffId: string, dto: IdentifyClientDto) {
    const ticket = await this.repo.findOneBy({ id: ticketId });
    if (!ticket) throw new NotFoundException('Талон не знайдено');
    if (ticket.staff_id !== staffId)
      throw new ForbiddenException('Цей талон не призначений вашому вікну');
    if (!['called', 'serving'].includes(ticket.status))
      throw new UnprocessableEntityException('Талон не очікує ідентифікації клієнта');
    if (ticket.client_id)
      throw new BadRequestException('Клієнта вже ідентифіковано');

    let clientId: string;

    if (dto.client_id) {
      const existing = await this.userRepo.findOneBy({ id: dto.client_id });
      if (!existing) throw new NotFoundException('Користувача не знайдено');
      if (existing.role !== 'citizen')
        throw new BadRequestException('Привʼязати можна лише акаунт відвідувача');
      clientId = existing.id;
    } else {
      if (!dto.first_name || !dto.last_name || !dto.email)
        throw new BadRequestException('Для створення акаунта вкажіть ПІБ та email');

      const exists = await this.userRepo.findOneBy({ email: dto.email });
      if (exists) throw new ConflictException('Email вже зареєстровано — знайдіть існуючий акаунт');

      const password_hash = await bcrypt.hash(randomBytes(24).toString('hex'), 12);
      const created = this.userRepo.create({
        email: dto.email,
        password_hash,
        first_name: dto.first_name,
        last_name: dto.last_name,
        middle_name: dto.middle_name ?? null,
        phone: dto.phone ?? null,
        tax_id: dto.tax_id ?? null,
        passport_number: dto.passport_number ?? null,
        // персонал ідентифікує відвідувача особисто за документами — верифікація не потрібна
        is_verified: true,
      });
      const saved = await this.userRepo.save(created);
      clientId = saved.id;
    }

    ticket.client_id = clientId;
    const saved = await this.repo.save(ticket);
    await this.auditsService.record({ ticket_id: ticket.id, staff_id: staffId, action: 'client_identified' });
    this.queueGateway.emitTicketUpdated(saved.department_id, saved);
    return saved;
  }

  async start(ticketId: string, staffId: string) {
    const ticket = await this.requireStatus(ticketId, 'called');
    if (ticket.staff_id !== staffId)
      throw new ForbiddenException('Цей талон не призначений вашому вікну');
    if (!ticket.client_id)
      throw new BadRequestException('Спочатку ідентифікуйте клієнта');
    ticket.status = 'serving';
    ticket.serving_started_at = new Date();

    await this.auditsService.record({ ticket_id: ticket.id, staff_id: staffId, action: 'serving_started' });
    const saved = await this.repo.save(ticket);
    this.queueGateway.emitTicketUpdated(saved.department_id, saved);
    return saved;
  }

  async complete(ticketId: string, staffId: string, dto: CompleteTicketDto) {
    const ticket = await this.requireStatus(ticketId, 'serving');
    if (ticket.staff_id !== staffId)
      throw new ForbiddenException('Цей талон не призначений вашому вікну');
    const now = new Date();
    ticket.status = 'completed';
    ticket.completed_at = now;

    const duration = ticket.serving_started_at
      ? Math.round((now.getTime() - ticket.serving_started_at.getTime()) / 1000)
      : null;

    await this.auditsService.record({
      ticket_id: ticket.id,
      staff_id: staffId,
      action: 'completed',
      notes: dto.notes,
      service_result: dto.service_result,
      duration_seconds: duration ?? undefined,
    });

    const saved = await this.repo.save(ticket);
    this.queueGateway.emitTicketUpdated(saved.department_id, saved);

    if (saved.window_id) await this.resetWindowDisplay(saved.window_id);

    if (saved.client_id) {
      const streak = await this.getConsecutiveStatusCount(saved.client_id, 'completed');
      const bonus = 2 + streak; // 1-а явка → +3, 2-га → +4, 3-тя → +5 ...
      this.disciplineEvents.log({
        user_id: saved.client_id,
        event_type: 'completed_ticket',
        impact: bonus,
        ticket_id: saved.id,
      });
      await this.userRepo
        .createQueryBuilder()
        .update(User)
        .set({ discipline_score: () => `LEAST("discipline_score" + ${bonus}, 100)` })
        .where('id = :id', { id: saved.client_id })
        .execute();
      await this.updateAttendanceAndStreak(saved.client_id);
    }

    return saved;
  }

  async miss(ticketId: string, staffId: string) {
    const ticket = await this.repo.findOneBy({ id: ticketId });
    if (!ticket) throw new NotFoundException('Талон не знайдено');
    if (!['waiting', 'called'].includes(ticket.status))
      throw new UnprocessableEntityException('Неможливо відмітити як відсутній');
    if (ticket.status === 'called' && ticket.staff_id !== staffId)
      throw new ForbiddenException('Цей талон не призначений вашому вікну');

    ticket.status = 'missed';
    ticket.is_missed_by_client = true;

    await this.auditsService.record({ ticket_id: ticket.id, staff_id: staffId, action: 'missed' });
    const saved = await this.repo.save(ticket);
    this.queueGateway.emitTicketUpdated(saved.department_id, saved);

    if (saved.window_id) await this.resetWindowDisplay(saved.window_id);

    if (saved.client_id) {
      const streak = await this.getConsecutiveStatusCount(saved.client_id, 'missed');
      const penalty = 5 + streak * 5; // 1-а неявка → −10, 2-га → −15, 3-тя → −20 ...
      this.disciplineEvents.log({
        user_id: saved.client_id,
        event_type: 'missed_ticket',
        impact: -penalty,
        ticket_id: saved.id,
      });
      await this.userRepo
        .createQueryBuilder()
        .update(User)
        .set({ discipline_score: () => `GREATEST("discipline_score" - ${penalty}, 0)` })
        .where('id = :id', { id: saved.client_id })
        .execute();
      await this.updateAttendanceAndStreak(saved.client_id);
    }

    return saved;
  }

  // ─── Хелпери ──────────────────────────────────────────────────────────────

  private resolveTimeSlot(
    requested: string | undefined,
    scheduledDate: string,
    today: string,
    hours: { openHour: number; closeHour: number },
    deptName: string,
    intervalMinutes: number,
    bookingCloseHour?: number,
  ): string {
    const upperBound = bookingCloseHour ?? hours.closeHour;
    const validTimes = this.slotTimes(hours.openHour, upperBound, intervalMinutes);

    if (requested) {
      if (!validTimes.includes(requested)) {
        throw new BadRequestException(
          `Слот ${requested} недоступний для цієї послуги — оберіть один із запропонованих часів ` +
          `(крок ${intervalMinutes} хв у межах ${hours.openHour}:00–${upperBound}:00)`,
        );
      }
      return requested;
    }

    if (scheduledDate === today) {
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const openMinutes = hours.openHour * 60;
      const closeMinutes = upperBound * 60;
      if (nowMinutes < openMinutes) throw new BadRequestException(`${deptName} ще не відкрито`);
      if (nowMinutes >= closeMinutes) throw new BadRequestException(`${deptName} вже не приймає записи на сьогодні`);
      const idx = Math.min(validTimes.length - 1, Math.floor((nowMinutes - openMinutes) / intervalMinutes));
      return validTimes[idx];
    }

    // Майбутня дата без вказаного слоту — перший слот дня
    return validTimes[0];
  }

  private parseWorkingHours(
    dept: Department,
    date: string,
  ): { openHour: number; closeHour: number } | null {
    const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const [year, month, day] = date.split('-').map(Number);
    const dayKey = DAY_KEYS[new Date(year, month - 1, day).getDay()];
    const hours: string = dept.working_hours?.[dayKey] ?? 'вихідний';

    if (hours === 'вихідний') return null;

    const match = hours.match(/(\d{2}):(\d{2})[–\-](\d{2}):(\d{2})/);
    if (!match) return null;

    return { openHour: parseInt(match[1]), closeHour: parseInt(match[3]) };
  }

  // Час початку фази живої черги (година), або null — якщо відділення працює лише за записом
  private parseLiveQueueHour(dept: Department | null): number | null {
    if (!dept?.live_queue_from) return null;
    const h = parseInt(dept.live_queue_from.split(':')[0], 10);
    return isNaN(h) ? null : h;
  }

  // Чи перебуває відділення зараз у фазі живої черги
  private isLiveQueuePhase(dept: Department | null): boolean {
    const liveQueueFromHour = this.parseLiveQueueHour(dept);
    if (liveQueueFromHour === null) return false;
    return new Date().getHours() >= liveQueueFromHour;
  }

  // Слоти запису йдуть із кроком, що дорівнює тривалості обслуговування —
  // кожне відкрите вікно встигає обслужити рівно одного клієнта за такий інтервал.
  private slotTimes(openHour: number, closeHour: number, intervalMinutes: number): string[] {
    const times: string[] = [];
    const totalMinutes = (closeHour - openHour) * 60;
    for (let m = 0; m < totalMinutes; m += intervalMinutes) {
      const h = openHour + Math.floor(m / 60);
      const mm = m % 60;
      times.push(`${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
    }
    return times;
  }

  // Пропускна здатність слоту = кількість відкритих вікон (кожне обслуговує одного клієнта за слот)
  private async calcSlotCapacity(departmentId: string, serviceId: string): Promise<number> {
    const windowCount = await this.windowRepo.count({
      where: { department_id: departmentId, service_id: serviceId, status: Not('closed') },
    });
    return Math.max(1, windowCount);
  }

  // Скільки талонів з меншим номером чекають у тому самому пулі (живочергові — окремо від записаних,
  // записані — лише в межах свого слоту), щоб позиція не змішувала два різні пули
  private async countAheadInSlot(ticket: Ticket): Promise<number> {
    const qb = this.repo
      .createQueryBuilder('t')
      .where('t.department_id = :dep', { dep: ticket.department_id })
      .andWhere('t.service_id = :svc', { svc: ticket.service_id })
      .andWhere('t.status = :status', { status: 'waiting' })
      .andWhere('t.ticket_number < :num', { num: ticket.ticket_number })
      .andWhere('t.scheduled_date = :date', { date: ticket.scheduled_date });

    if (ticket.time_slot === null) {
      qb.andWhere('t.time_slot IS NULL');
    } else {
      qb.andWhere('t.time_slot = :slot', { slot: ticket.time_slot });
    }

    return qb.getCount();
  }

  private async countActiveInSlot(deptId: string, svcId: string, date: string, slot: string): Promise<number> {
    return this.repo.count({
      where: [
        { department_id: deptId, service_id: svcId, scheduled_date: date, time_slot: slot, status: 'waiting' },
        { department_id: deptId, service_id: svcId, scheduled_date: date, time_slot: slot, status: 'called' },
        { department_id: deptId, service_id: svcId, scheduled_date: date, time_slot: slot, status: 'serving' },
        { department_id: deptId, service_id: svcId, scheduled_date: date, time_slot: slot, status: 'completed' },
        { department_id: deptId, service_id: svcId, scheduled_date: date, time_slot: slot, status: 'missed' },
      ],
    });
  }

  private async resetWindowDisplay(windowId: string) {
    await this.windowRepo.update(windowId, { current_number: 0 });
    const win = await this.windowRepo.findOneBy({ id: windowId });
    if (!win) return;
    const waiting_count = await this.countWaitingForWindow(win);
    this.queueGateway.emitWindowUpdated(win.department_id, { ...win, waiting_count });
  }

  private async getConsecutiveStatusCount(clientId: string, targetStatus: 'completed' | 'missed'): Promise<number> {
    const rows = await this.repo
      .createQueryBuilder('t')
      .select('t.status', 'status')
      .where('t.client_id = :clientId', { clientId })
      .andWhere('t.status IN (:...statuses)', { statuses: ['completed', 'missed'] })
      .orderBy('t.issued_at', 'DESC')
      .limit(20)
      .getRawMany<{ status: string }>();

    let count = 0;
    for (const row of rows) {
      if (row.status === targetStatus) count++;
      else break;
    }
    return Math.max(1, count);
  }

  private async requireStatus(ticketId: string, expected: string) {
    const ticket = await this.repo.findOneBy({ id: ticketId });
    if (!ticket) throw new NotFoundException('Талон не знайдено');
    if (ticket.status !== expected)
      throw new UnprocessableEntityException(
        `Очікується статус "${expected}", поточний: "${ticket.status}"`,
      );
    return ticket;
  }

  // Перераховує attendance_rate і current_streak на основі реальних даних талонів.
  // Викликається після кожного complete() / miss() з client_id.
  private async updateAttendanceAndStreak(clientId: string): Promise<void> {
    // attendance_rate = completed / (completed + missed_by_client)
    const [completed, missed] = await Promise.all([
      this.repo.count({ where: { client_id: clientId, status: 'completed' } }),
      this.repo.count({ where: { client_id: clientId, status: 'missed', is_missed_by_client: true } }),
    ]);

    const total = completed + missed;
    const attendance_rate = total === 0 ? 1 : completed / total;

    // current_streak = кількість поспіль завершених унікальних дат (останні дні з scheduled_date)
    // Беремо відмічені дати (completed або missed_by_client) у зворотному хронологічному порядку.
    // Streak росте поки є completed, і обнуляється на першому missed.
    const rows: { scheduled_date: string; has_missed: unknown }[] = await this.repo
      .createQueryBuilder('t')
      .select('t.scheduled_date', 'scheduled_date')
      .addSelect(
        `BOOL_OR(t.status = 'missed' AND t.is_missed_by_client = true)`,
        'has_missed',
      )
      .where('t.client_id = :clientId', { clientId })
      .andWhere('t.status IN (:...statuses)', { statuses: ['completed', 'missed'] })
      .groupBy('t.scheduled_date')
      .orderBy('t.scheduled_date', 'DESC')
      .getRawMany();

    let current_streak = 0;
    for (const row of rows) {
      const hasMissed = row.has_missed === true || row.has_missed === 't';
      if (hasMissed) break;
      current_streak++;
    }

    await this.userRepo.update(clientId, { attendance_rate, current_streak });
  }
}
