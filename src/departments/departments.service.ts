import { Injectable, NotFoundException } from '@nestjs/common';
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
    const dep = this.repo.create(dto);
    return this.repo.save(dep);
  }

  async update(id: string, dto: UpdateDepartmentDto) {
    await this.findOne(id);
    await this.repo.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.repo.delete(id);
  }
}
