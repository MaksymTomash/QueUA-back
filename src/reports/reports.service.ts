import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket } from '../tickets/ticket.entity';
import { User } from '../users/user.entity';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async getSummary(dateFrom?: string, dateTo?: string) {
    const ticketQb = this.ticketRepo.createQueryBuilder('t');

    if (dateFrom) ticketQb.andWhere('t.issued_at >= :dateFrom', { dateFrom });
    if (dateTo) ticketQb.andWhere('t.issued_at <= :dateTo', { dateTo });

    const [
      total_tickets,
      completed_tickets,
      missed_tickets,
      cancelled_tickets,
      waitingTimeResult,
      total_citizens,
      total_staff,
    ] = await Promise.all([
      ticketQb.clone().getCount(),

      ticketQb.clone().andWhere('t.status = :s', { s: 'completed' }).getCount(),

      ticketQb.clone().andWhere('t.status = :s', { s: 'missed' }).getCount(),

      ticketQb.clone().andWhere('t.status = :s', { s: 'cancelled' }).getCount(),

      // Середній час очікування = called_at - issued_at (в мс)
      ticketQb
        .clone()
        .select('AVG(EXTRACT(EPOCH FROM (t.called_at - t.issued_at)) * 1000)', 'avg_ms')
        .andWhere('t.called_at IS NOT NULL')
        .getRawOne<{ avg_ms: string }>(),

      this.userRepo.countBy({ role: 'citizen' }),
      this.userRepo.countBy({ role: 'staff' }),
    ]);

    return {
      total_tickets,
      completed_tickets,
      missed_tickets,
      cancelled_tickets,
      total_citizens,
      total_staff,
      average_waiting_time_ms: Math.round(parseFloat(waitingTimeResult?.avg_ms ?? '0') || 0),
      date_from: dateFrom ?? null,
      date_to: dateTo ?? null,
    };
  }
}
