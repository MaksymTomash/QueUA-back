import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { QueueCounter } from './queue-counter.entity';

@Injectable()
export class QueueCountersService {
  constructor(
    @InjectRepository(QueueCounter)
    private readonly repo: Repository<QueueCounter>,
    private readonly dataSource: DataSource,
  ) {}

  // Атомарний increment — повертає номер який треба видати
  async getAndIncrement(departmentId: string, serviceId: string): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      let counter = await manager.findOne(QueueCounter, {
        where: { department_id: departmentId, service_id: serviceId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!counter) {
        counter = manager.create(QueueCounter, {
          department_id: departmentId,
          service_id: serviceId,
          next_number: 1,
        });
      }

      const issued = counter.next_number;
      counter.next_number += 1;
      await manager.save(QueueCounter, counter);
      return issued;
    });
  }

  // Скидає лічильник (наприклад на початок нового дня)
  async reset(departmentId: string, serviceId: string) {
    await this.repo.update(
      { department_id: departmentId, service_id: serviceId },
      { next_number: 1 },
    );
  }
}
