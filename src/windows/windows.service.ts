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
import { UpdateWindowDto } from './dto/update-window.dto';
import { QueryWindowsDto } from './dto/query-windows.dto';
import { QueueGateway } from '../queue/queue.gateway';
import { StaffAssignmentsService } from '../staff-assignments/staff-assignments.service';
import { DepartmentsService } from '../departments/departments.service';

type RequestUser = { sub: string; role: string };

@Injectable()
export class WindowsService {
  constructor(
    @InjectRepository(Window)
    private readonly repo: Repository<Window>,
    @Inject(forwardRef(() => TicketsService))
    private readonly ticketsService: TicketsService,
    private readonly queueGateway: QueueGateway,
    private readonly staffAssignments: StaffAssignmentsService,
    private readonly departmentsService: DepartmentsService,
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

  async create(dto: CreateWindowDto, user: RequestUser) {
    await this.departmentsService.assertCanManage(dto.department_id, user);
    const today = new Date().toISOString().split('T')[0];
    const win = this.repo.create({
      ...dto,
      date: dto.date ?? today,
      // вікно відкривається лише після join() співробітника
      status: 'closed',
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
    win.status = 'closed';
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

  async update(windowId: string, dto: UpdateWindowDto, user: RequestUser) {
    const win = await this.repo.findOneBy({ id: windowId });
    if (!win) throw new NotFoundException('Вікно не знайдено');
    await this.departmentsService.assertCanManage(win.department_id, user);

    if (dto.staff_id !== undefined && dto.staff_id !== null) {
      const assigned = await this.staffAssignments.isAssigned(win.department_id, dto.staff_id);
      if (!assigned) throw new BadRequestException('Цей співробітник не призначений у відділення');
    }

    if (dto.label !== undefined) win.label = dto.label;
    if (dto.service_id !== undefined) win.service_id = dto.service_id;
    if (dto.staff_id !== undefined) win.staff_id = dto.staff_id;

    const saved = await this.repo.save(win);
    const result = await this.withWaitingCount(saved);
    this.queueGateway.emitWindowUpdated(saved.department_id, result);
    return result;
  }

  async remove(windowId: string, user: RequestUser): Promise<void> {
    const win = await this.repo.findOneBy({ id: windowId });
    if (!win) throw new NotFoundException('Вікно не знайдено');
    await this.departmentsService.assertCanManage(win.department_id, user);
    await this.repo.remove(win);
    this.queueGateway.emitWindowUpdated(win.department_id, { id: windowId, removed: true });
  }

  // waiting_count — динамічно з таблиці tickets (спільна черга для service+department)
  private async withWaitingCount(win: Window) {
    const waiting_count = await this.ticketsService.countWaitingForWindow(win);
    return { ...win, waiting_count };
  }
}
