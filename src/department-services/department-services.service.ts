import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DepartmentService } from './department-service.entity';
import { AddDepartmentServiceDto } from './dto/add-department-service.dto';

@Injectable()
export class DepartmentServicesService {
  constructor(
    @InjectRepository(DepartmentService)
    private readonly repo: Repository<DepartmentService>,
  ) {}

  async findByDepartment(departmentId: string) {
    return this.repo
      .createQueryBuilder('ds')
      .leftJoinAndSelect('ds.service', 'service')
      .where('ds.department_id = :departmentId', { departmentId })
      .andWhere('ds.is_active = true')
      .getMany();
  }

  async add(departmentId: string, dto: AddDepartmentServiceDto) {
    const existing = await this.repo.findOneBy({
      department_id: departmentId,
      service_id: dto.service_id,
    });

    if (existing) {
      if (existing.is_active) throw new ConflictException('Послуга вже додана до відділення');
      existing.is_active = true;
      return this.repo.save(existing);
    }

    const entry = this.repo.create({ department_id: departmentId, service_id: dto.service_id });
    return this.repo.save(entry);
  }

  async remove(departmentId: string, serviceId: string) {
    const entry = await this.repo.findOneBy({ department_id: departmentId, service_id: serviceId });
    if (!entry) throw new NotFoundException('Послугу не знайдено у відділенні');
    entry.is_active = false;
    await this.repo.save(entry);
  }

  async isActiveInDepartment(departmentId: string, serviceId: string): Promise<boolean> {
    return this.repo.existsBy({ department_id: departmentId, service_id: serviceId, is_active: true });
  }
}
