import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TicketAudit, AuditAction } from './audit.entity';

interface CreateAuditParams {
  ticket_id: string;
  staff_id: string;
  action: AuditAction;
  notes?: string;
  service_result?: string;
  duration_seconds?: number;
}

@Injectable()
export class AuditsService {
  constructor(
    @InjectRepository(TicketAudit)
    private readonly repo: Repository<TicketAudit>,
  ) {}

  record(params: CreateAuditParams) {
    const audit = this.repo.create({
      ticket_id: params.ticket_id,
      staff_id: params.staff_id,
      action: params.action,
      notes: params.notes ?? null,
      service_result: params.service_result ?? null,
      duration_seconds: params.duration_seconds ?? null,
    });
    return this.repo.save(audit);
  }

  findAll(filters: {
    ticket_id?: string;
    staff_id?: string;
    department_id?: string;
    date_from?: string;
    date_to?: string;
  }) {
    const qb = this.repo
      .createQueryBuilder('a')
      .orderBy('a.created_at', 'DESC');

    if (filters.ticket_id)
      qb.andWhere('a.ticket_id = :ticket_id', { ticket_id: filters.ticket_id });
    if (filters.staff_id)
      qb.andWhere('a.staff_id = :staff_id', { staff_id: filters.staff_id });
    if (filters.date_from)
      qb.andWhere('a.created_at >= :from', { from: filters.date_from });
    if (filters.date_to)
      qb.andWhere('a.created_at <= :to', { to: filters.date_to });

    return qb.getMany();
  }
}
