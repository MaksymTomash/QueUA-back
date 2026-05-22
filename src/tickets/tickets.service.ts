import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { Ticket } from './ticket.entity';
import { Window } from '../windows/window.entity';
import { QueueService } from '../services/service.entity';
import { Department } from '../departments/department.entity';
import { User } from '../users/user.entity';
import { AuditsService } from '../audits/audits.service';
import { QueueCountersService } from '../queue-counters/queue-counters.service';
import { BookTicketDto } from './dto/book-ticket.dto';
import { ManualTicketDto } from './dto/manual-ticket.dto';
import { CompleteTicketDto } from './dto/complete-ticket.dto';
import { QueryTicketsDto } from './dto/query-tickets.dto';
import { QueueGateway } from '../queue/queue.gateway';
import { DepartmentServicesService } from '../department-services/department-services.service';
import { DisciplineEventsService } from '../discipline-events/discipline-events.service';
import { QueueCounter } from '../queue-counters/queue-counter.entity';

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
    private readonly queueCounters: QueueCountersService,
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

    const capacity = await this.calcSlotCapacity(departmentId, serviceId, svc);
    if (capacity === 0) return [];

    const slots: { time: string; capacity: number; booked: number; available: number }[] = [];

    for (let h = hours.openHour; h < hours.closeHour; h++) {
      const time = `${String(h).padStart(2, '0')}:00`;
      const booked = await this.repo.count({
        where: { department_id: departmentId, service_id: serviceId, scheduled_date: date, time_slot: time },
      });
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

    if (svc.min_discipline_score > 0) {
      const user = await this.userRepo.findOneBy({ id: clientId });
      if (user && user.discipline_score < svc.min_discipline_score) {
        throw new ForbiddenException(
          `Для цієї послуги потрібен рейтинг дисципліни ≥ ${svc.min_discipline_score}. Ваш: ${user.discipline_score}`,
        );
      }
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

    const hours = this.parseWorkingHours(dept, scheduledDate);
    if (!hours) throw new BadRequestException(`${dept.name} не працює у цей день`);

    // Визначаємо слот
    const timeSlot = this.resolveTimeSlot(dto.time_slot, scheduledDate, today, hours, dept.name);

    // Для сьогодні — перевіряємо відкриті вікна
    if (scheduledDate === today) {
      const hasOpenWindow = await this.windowRepo
        .createQueryBuilder('w')
        .where('w.department_id = :dep', { dep: dto.department_id })
        .andWhere('w.service_id = :svc', { svc: dto.service_id })
        .andWhere('w.status != :closed', { closed: 'closed' })
        .getExists();

      if (!hasOpenWindow) throw new NotFoundException('Немає активних вікон для цієї послуги сьогодні');
    }

    // Розраховуємо номер слоту
    const capacity = await this.calcSlotCapacity(dto.department_id, dto.service_id, svc);
    const slotHour = parseInt(timeSlot.split(':')[0]);
    const slotIndex = slotHour - hours.openHour;
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
        where: {
          department_id: dto.department_id,
          service_id: dto.service_id,
          scheduled_date: scheduledDate,
          time_slot: timeSlot,
        },
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

    const today = new Date().toISOString().split('T')[0];
    const ticketNumber = await this.queueCounters.getAndIncrement(
      window.department_id,
      dto.service_id,
    );

    const ticket = this.repo.create({
      window_id: dto.window_id,
      client_id: '',
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

    // Беремо найменший номер талону на СЬОГОДНІ з загальної черги
    const ticket = await this.repo.findOne({
      where: {
        department_id: window.department_id,
        service_id: window.service_id,
        status: 'waiting',
        window_id: IsNull(),
        scheduled_date: today,
      },
      order: { ticket_number: 'ASC' },
    });

    if (!ticket) throw new NotFoundException('Черга порожня');

    ticket.window_id = windowId;
    ticket.staff_id = staffId;
    ticket.status = 'called';
    ticket.called_at = new Date();

    window.current_number = ticket.ticket_number;
    await this.windowRepo.save(window);

    await this.auditsService.record({ ticket_id: ticket.id, staff_id: staffId, action: 'called' });
    const saved = await this.repo.save(ticket);
    this.queueGateway.emitTicketCalled(saved.department_id, saved);
    return saved;
  }

  // ─── Читання ──────────────────────────────────────────────────────────────

  async getActive(clientId: string) {
    const ticket = await this.repo
      .createQueryBuilder('t')
      .where('t.client_id = :clientId', { clientId })
      .andWhere('t.status IN (:...statuses)', { statuses: ['waiting', 'called', 'serving'] })
      .getOne();

    if (!ticket) return null;

    const position =
      ticket.status === 'waiting'
        ? await this.countAheadInSlot(ticket)
        : 0;

    return { ...ticket, position };
  }

  async getMy(clientId: string, page: number, pageSize: number) {
    return this.repo.find({
      where: { client_id: clientId },
      order: { issued_at: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  async findOne(id: string, requesterId: string, requesterRole: string) {
    const ticket = await this.repo.findOneBy({ id });
    if (!ticket) throw new NotFoundException('Талон не знайдено');

    if (requesterRole === 'citizen' && ticket.client_id !== requesterId)
      throw new ForbiddenException('Доступ заборонено');

    const position =
      ticket.status === 'waiting' ? await this.countAheadInSlot(ticket) : 0;

    return { ...ticket, position };
  }

  async findAll(query: QueryTicketsDto) {
    const { department_id, window_id, date, status, page = 1, page_size = 20 } = query;
    const qb = this.repo.createQueryBuilder('t').orderBy('t.ticket_number', 'ASC');

    if (department_id) qb.andWhere('t.department_id = :department_id', { department_id });
    if (window_id) qb.andWhere('t.window_id = :window_id', { window_id });
    if (status) qb.andWhere('t.status = :status', { status });
    if (date) qb.andWhere('t.scheduled_date = :date', { date });

    return qb.skip((page - 1) * page_size).take(page_size).getMany();
  }

  async getWindowQueue(windowId: string) {
    const window = await this.windowRepo.findOneBy({ id: windowId });
    if (!window) throw new NotFoundException('Вікно не знайдено');

    const today = new Date().toISOString().split('T')[0];
    return this.repo.find({
      where: {
        department_id: window.department_id,
        service_id: window.service_id,
        status: 'waiting',
        scheduled_date: today,
      },
      order: { ticket_number: 'ASC' },
    });
  }

  async countWaitingForWindow(window: Window): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    return this.repo.count({
      where: {
        department_id: window.department_id,
        service_id: window.service_id,
        status: 'waiting',
        scheduled_date: today,
      },
    });
  }

  // ─── Дії citizen ──────────────────────────────────────────────────────────

  async cancel(ticketId: string, clientId: string) {
    const ticket = await this.repo.findOneBy({ id: ticketId });
    if (!ticket) throw new NotFoundException('Талон не знайдено');
    if (ticket.client_id !== clientId) throw new ForbiddenException('Доступ заборонено');
    if (['completed', 'missed', 'cancelled'].includes(ticket.status))
      throw new UnprocessableEntityException('Талон вже не можна скасувати');

    ticket.status = 'cancelled';
    ticket.cancelled_at = new Date();

    await this.auditsService.record({ ticket_id: ticket.id, staff_id: clientId, action: 'cancelled' });
    const saved = await this.repo.save(ticket);
    this.queueGateway.emitTicketUpdated(saved.department_id, saved);
    return saved;
  }

  // ─── Дії staff ────────────────────────────────────────────────────────────

  async start(ticketId: string, staffId: string) {
    const ticket = await this.requireStatus(ticketId, 'called');
    ticket.status = 'serving';
    ticket.serving_started_at = new Date();
    ticket.staff_id = staffId;

    await this.auditsService.record({ ticket_id: ticket.id, staff_id: staffId, action: 'serving_started' });
    const saved = await this.repo.save(ticket);
    this.queueGateway.emitTicketUpdated(saved.department_id, saved);
    return saved;
  }

  async complete(ticketId: string, staffId: string, dto: CompleteTicketDto) {
    const ticket = await this.requireStatus(ticketId, 'serving');
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

    if (saved.client_id) {
      this.disciplineEvents.log({
        user_id: saved.client_id,
        event_type: 'completed_ticket',
        impact: 2,
        ticket_id: saved.id,
      });
    }

    return saved;
  }

  async miss(ticketId: string, staffId: string) {
    const ticket = await this.repo.findOneBy({ id: ticketId });
    if (!ticket) throw new NotFoundException('Талон не знайдено');
    if (!['waiting', 'called'].includes(ticket.status))
      throw new UnprocessableEntityException('Неможливо відмітити як відсутній');

    ticket.status = 'missed';
    ticket.is_missed_by_client = true;

    await this.auditsService.record({ ticket_id: ticket.id, staff_id: staffId, action: 'missed' });
    const saved = await this.repo.save(ticket);
    this.queueGateway.emitTicketUpdated(saved.department_id, saved);

    if (saved.client_id) {
      this.disciplineEvents.log({
        user_id: saved.client_id,
        event_type: 'missed_ticket',
        impact: -5,
        ticket_id: saved.id,
      });
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
  ): string {
    if (requested) {
      const slotHour = parseInt(requested.split(':')[0]);
      if (isNaN(slotHour) || slotHour < hours.openHour || slotHour >= hours.closeHour) {
        throw new BadRequestException(
          `Слот ${requested} поза робочими годинами (${hours.openHour}:00–${hours.closeHour}:00)`,
        );
      }
      return `${String(slotHour).padStart(2, '0')}:00`;
    }

    if (scheduledDate === today) {
      const currentHour = new Date().getHours();
      if (currentHour < hours.openHour) throw new BadRequestException(`${deptName} ще не відкрито`);
      if (currentHour >= hours.closeHour) throw new BadRequestException(`${deptName} вже зачинено`);
      return `${String(currentHour).padStart(2, '0')}:00`;
    }

    // Майбутня дата без вказаного слоту — перший слот дня
    return `${String(hours.openHour).padStart(2, '0')}:00`;
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

  // Пропускна здатність слоту = кількість відкритих вікон × (60 / тривалість послуги)
  private async calcSlotCapacity(
    departmentId: string,
    serviceId: string,
    svc: QueueService,
  ): Promise<number> {
    const windowCount = await this.windowRepo.count({
      where: { department_id: departmentId, service_id: serviceId, status: Not('closed') },
    });
    return Math.max(1, windowCount * Math.floor(60 / svc.estimated_duration_minutes));
  }

  // Скільки талонів з меншим номером чекають у тому ж слоті
  private async countAheadInSlot(ticket: Ticket): Promise<number> {
    return this.repo
      .createQueryBuilder('t')
      .where('t.department_id = :dep', { dep: ticket.department_id })
      .andWhere('t.service_id = :svc', { svc: ticket.service_id })
      .andWhere('t.status = :status', { status: 'waiting' })
      .andWhere('t.ticket_number < :num', { num: ticket.ticket_number })
      .andWhere('t.scheduled_date = :date', { date: ticket.scheduled_date })
      .getCount();
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
}
