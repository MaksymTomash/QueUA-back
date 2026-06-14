import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Department } from './department.entity';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { QueryDepartmentsDto } from './dto/query-departments.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    @InjectRepository(Department)
    private readonly repo: Repository<Department>,
  ) {}

  // Перевіряє, що live_queue_from лежить строго всередині робочих годин кожного робочого дня —
  // інакше для якогось дня одна з фаз (запис/жива черга) виявиться порожньою.
  private validateLiveQueueFrom(
    liveQueueFrom: string | null | undefined,
    workingHours: Record<string, string> | undefined,
  ): void {
    if (!liveQueueFrom) return;
    const liveHour = parseInt(liveQueueFrom.split(':')[0], 10);

    for (const value of Object.values(workingHours ?? {})) {
      if (!value || value === 'вихідний') continue;
      const match = value.match(/(\d{2}):(\d{2})[–-](\d{2}):(\d{2})/);
      if (!match) continue;
      const openHour = parseInt(match[1], 10);
      const closeHour = parseInt(match[3], 10);
      if (liveHour <= openHour || liveHour >= closeHour) {
        throw new BadRequestException(
          'Час початку живої черги має бути строго в межах робочого часу (щоб лишилось місце і для запису, і для живої черги)',
        );
      }
    }
  }

  async findAll(query: QueryDepartmentsDto) {
    const qb = this.repo.createQueryBuilder('d');
    if (query.city) qb.andWhere('d.city = :city', { city: query.city });
    if (query.is_active !== undefined)
      qb.andWhere('d.is_active = :is_active', { is_active: query.is_active });
    return qb.getMany();
  }

  async findOne(id: string) {
    const dep = await this.repo.findOneBy({ id });
    if (!dep) throw new NotFoundException('Відділення не знайдено');
    return dep;
  }

  async create(dto: CreateDepartmentDto) {
    this.validateLiveQueueFrom(dto.live_queue_from, dto.working_hours);
    const dep = this.repo.create(dto);
    return this.repo.save(dep);
  }

  async update(id: string, dto: UpdateDepartmentDto) {
    const existing = await this.findOne(id);
    this.validateLiveQueueFrom(
      dto.live_queue_from !== undefined ? dto.live_queue_from : existing.live_queue_from,
      dto.working_hours ?? existing.working_hours,
    );
    await this.repo.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.repo.delete(id);
  }

  // Адмін керує будь-яким відділенням; керівник (staff, чий id === leader_id) — лише своїм.
  async assertCanManage(id: string, user: { sub: string; role: string }): Promise<Department> {
    const dept = await this.findOne(id);
    if (user.role === 'admin') return dept;
    if (user.role === 'staff' && dept.leader_id === user.sub) return dept;
    throw new ForbiddenException('Лише керівник або адміністратор можуть керувати цим відділенням');
  }

  async updateForUser(id: string, dto: UpdateDepartmentDto, user: { sub: string; role: string }) {
    await this.assertCanManage(id, user);
    if (user.role === 'admin') return this.update(id, dto);
    // керівник редагує лише обмежений набір "операційних" полів
    const { working_hours, live_queue_from, phone } = dto;
    return this.update(id, { working_hours, live_queue_from, phone });
  }
}
