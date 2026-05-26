import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Window } from './window.entity';
import { TicketsService } from '../tickets/tickets.service';
import { CreateWindowDto } from './dto/create-window.dto';
import { QueryWindowsDto } from './dto/query-windows.dto';
import { QueueGateway } from '../queue/queue.gateway';
import { StaffAssignmentsService } from '../staff-assignments/staff-assignments.service';

@Injectable()
export class WindowsService {
  constructor(
    @InjectRepository(Window)
    private readonly repo: Repository<Window>,
    @Inject(forwardRef(() => TicketsService))
    private readonly ticketsService: TicketsService,
    private readonly queueGateway: QueueGateway,
    private readonly staffAssignments: StaffAssignmentsService,
  ) {}

  async findAll(query: QueryWindowsDto) {
    const qb = this.repo.createQueryBuilder('w');
    if (query.department_id)
      qb.andWhere('w.department_id = :dep', { dep: query.department_id });
    if (query.date)
      qb.andWhere('w.date = :date', { date: query.date });
    if (query.service_id)
      qb.andWhere('w.service_id = :svc', { svc: query.service_id });

    const windows = await qb.getMany();
    return Promise.all(windows.map((w) => this.withWaitingCount(w)));
  }

  async findOne(id: string) {
    const win = await this.repo.findOneBy({ id });
    if (!win) throw new NotFoundException('Вікно не знайдено');
    return this.withWaitingCount(win);
  }

  async create(dto: CreateWindowDto) {
    const today = new Date().toISOString().split('T')[0];
    const win = this.repo.create({
      ...dto,
      date: dto.date ?? today,
      status: 'open',
      current_number: 0,
    });
    const saved = await this.repo.save(win);
    return this.withWaitingCount(saved);
  }

  async join(windowId: string, staffId: string) {
    const win = await this.repo.findOneBy({ id: windowId });
    if (!win) throw new NotFoundException('Вікно не знайдено');
    if (win.staff_id && win.staff_id !== staffId)
      throw new BadRequestException('Вікно вже зайняте іншим спеціалістом');

    const assigned = await this.staffAssignments.isAssigned(win.department_id, staffId, win.service_id);
    if (!assigned)
      throw new ForbiddenException('Ви не призначені до цієї послуги у цьому відділенні');

    win.staff_id = staffId;
    win.status = 'open';
    const saved = await this.repo.save(win);
    const result = await this.withWaitingCount(saved);
    this.queueGateway.emitWindowUpdated(saved.department_id, result);
    return result;
  }

  async leave(windowId: string, staffId: string) {
    const win = await this.repo.findOneBy({ id: windowId });
    if (!win) throw new NotFoundException('Вікно не знайдено');
    if (win.staff_id !== staffId) throw new ForbiddenException('Ви не сидите за цим вікном');
    win.staff_id = null;
    win.status = 'open';
    win.current_number = 0;
    const saved = await this.repo.save(win);
    const result = await this.withWaitingCount(saved);
    this.queueGateway.emitWindowUpdated(saved.department_id, result);
    return result;
  }

  async pause(windowId: string, staffId: string) {
    const win = await this.repo.findOneBy({ id: windowId });
    if (!win) throw new NotFoundException('Вікно не знайдено');
    if (win.staff_id !== staffId) throw new ForbiddenException('Ви не сидите за цим вікном');
    win.status = 'paused';
    const saved = await this.repo.save(win);
    const result = await this.withWaitingCount(saved);
    this.queueGateway.emitWindowUpdated(saved.department_id, result);
    return result;
  }

  async resume(windowId: string, staffId: string) {
    const win = await this.repo.findOneBy({ id: windowId });
    if (!win) throw new NotFoundException('Вікно не знайдено');
    if (win.staff_id !== staffId) throw new ForbiddenException('Ви не сидите за цим вікном');
    win.status = 'open';
    const saved = await this.repo.save(win);
    const result = await this.withWaitingCount(saved);
    this.queueGateway.emitWindowUpdated(saved.department_id, result);
    return result;
  }

  // waiting_count — динамічно з таблиці tickets (спільна черга для service+department)
  private async withWaitingCount(win: Window) {
    const waiting_count = await this.ticketsService.countWaitingForWindow(win);
    return { ...win, waiting_count };
  }
}
