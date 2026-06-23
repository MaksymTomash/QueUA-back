import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DisciplineEvent, DisciplineEventType } from './discipline-event.entity';

@Injectable()
export class DisciplineEventsService {
  constructor(
    @InjectRepository(DisciplineEvent)
    private readonly repo: Repository<DisciplineEvent>,
  ) {}

  log(data: {
    user_id: string;
    event_type: DisciplineEventType;
    impact: number;
    ticket_id?: string;
    rating_id?: string;
  }) {
    const event = this.repo.create({
      user_id: data.user_id,
      event_type: data.event_type,
      impact: data.impact,
      ticket_id: data.ticket_id ?? null,
      rating_id: data.rating_id ?? null,
    });
    return this.repo.save(event);
  }

  async sumAttendanceImpact(userId: string): Promise<number> {
    const result = await this.repo
      .createQueryBuilder('e')
      .select('SUM(e.impact)', 'total')
      .where('e.user_id = :userId', { userId })
      .andWhere('e.event_type IN (:...types)', { types: ['completed_ticket', 'missed_ticket'] })
      .getRawOne<{ total: string }>();
    return parseFloat(result?.total ?? '0') || 0;
  }

  findByUser(userId: string, page = 1, pageSize = 20) {
    return this.repo.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }
}
