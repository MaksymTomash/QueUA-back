import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueueService } from './service.entity';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(QueueService)
    private readonly repo: Repository<QueueService>,
  ) {}

  findAll(is_active?: boolean) {
    if (is_active !== undefined) return this.repo.findBy({ is_active });
    return this.repo.find();
  }

  async findOne(id: string) {
    const svc = await this.repo.findOneBy({ id });
    if (!svc) throw new NotFoundException('Послугу не знайдено');
    return svc;
  }

  async create(dto: CreateServiceDto) {
    const svc = this.repo.create(dto);
    return this.repo.save(svc);
  }

  async update(id: string, dto: UpdateServiceDto) {
    await this.findOne(id);
    await this.repo.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.repo.delete(id);
  }
}
