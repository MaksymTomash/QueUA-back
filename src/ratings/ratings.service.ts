import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rating } from './rating.entity';
import { Ticket } from '../tickets/ticket.entity';
import { User } from '../users/user.entity';
import { Department } from '../departments/department.entity';
import { ClientRatingDto } from './dto/client-rating.dto';
import { StaffRatingDto } from './dto/staff-rating.dto';
import { DisciplineEventsService } from '../discipline-events/discipline-events.service';

@Injectable()
export class RatingsService {
  constructor(
    @InjectRepository(Rating)
    private readonly repo: Repository<Rating>,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Department)
    private readonly deptRepo: Repository<Department>,
    private readonly disciplineEvents: DisciplineEventsService,
  ) {}

  // ─── Citizen оцінює спеціаліста ──────────────────────────────────────────

  async rateByClient(citizenId: string, dto: ClientRatingDto) {
    const ticket = await this.ticketRepo.findOneBy({ id: dto.ticket_id });
    if (!ticket) throw new NotFoundException('Талон не знайдено');
    if (ticket.client_id !== citizenId) throw new ForbiddenException('Це не ваш талон');
    if (ticket.status !== 'completed') throw new BadRequestException('Оцінити можна лише завершений талон');
    if (ticket.rating_by_client_id) throw new BadRequestException('Ви вже оцінили цей талон');
    if (!ticket.staff_id) throw new BadRequestException('Спеціаліст не призначений до талону');

    const rating = this.repo.create({
      ticket_id: ticket.id,
      staff_id: ticket.staff_id,
      citizen_id: citizenId,
      type: 'client',
      score: dto.score,
      topic: dto.topic ?? null,
      comment: dto.comment ?? null,
    });
    const saved = await this.repo.save(rating);

    await this.ticketRepo.update(ticket.id, {
      rating_by_client_id: saved.id,
      client_rating: dto.score,
      client_comment: dto.comment ?? null,
      client_rating_topic: dto.topic ?? null,
    });

    await this.updateDepartmentRating(ticket.department_id);

    return saved;
  }

  // ─── Staff оцінює громадянина ─────────────────────────────────────────────

  async rateByStaff(staffId: string, dto: StaffRatingDto) {
    const ticket = await this.ticketRepo.findOneBy({ id: dto.ticket_id });
    if (!ticket) throw new NotFoundException('Талон не знайдено');
    if (ticket.staff_id !== staffId) throw new ForbiddenException('Це не ваш талон');
    if (ticket.status !== 'completed') throw new BadRequestException('Оцінити можна лише завершений талон');
    if (ticket.rating_by_staff_id) throw new BadRequestException('Ви вже оцінили цей талон');
    if (!ticket.client_id) throw new BadRequestException('Анонімний талон — оцінка недоступна');

    const rating = this.repo.create({
      ticket_id: ticket.id,
      staff_id: staffId,
      citizen_id: ticket.client_id,
      type: 'staff',
      score: dto.score,
      topic: dto.topic ?? null,
      comment: dto.comment ?? null,
    });
    const saved = await this.repo.save(rating);

    await this.ticketRepo.update(ticket.id, {
      rating_by_staff_id: saved.id,
      staff_rating: dto.score,
      staff_rating_topic: dto.topic ?? null,
      staff_rating_comment: dto.comment ?? null,
    });

    await this.updateDisciplineScore(ticket.client_id);

    this.disciplineEvents.log({
      user_id: ticket.client_id,
      event_type: 'rating_received',
      impact: Math.round(dto.score * 10),
      ticket_id: ticket.id,
      rating_id: saved.id,
    });

    return saved;
  }

  private async updateDisciplineScore(citizenId: string) {
    const lastRatings = await this.repo.find({
      where: { citizen_id: citizenId, type: 'staff' },
      order: { created_at: 'DESC' },
      take: 20,
    });
    if (!lastRatings.length) return;

    const avg = lastRatings.reduce((sum, r) => sum + r.score, 0) / lastRatings.length;
    const rating_component = Math.round(avg * 10); // avg 5 → 50, avg 3 → 30

    const attendance_delta = await this.disciplineEvents.sumAttendanceImpact(citizenId);

    const discipline_score = Math.max(0, Math.min(100, rating_component + attendance_delta));
    await this.userRepo.update(citizenId, { discipline_score });
  }

  // ─── Агрегат по спеціалісту ───────────────────────────────────────────────

  async getPerformance(staffId: string) {
    const today = new Date().toISOString().split('T')[0];
    const monthStart = today.slice(0, 7) + '-01';

    const [avgResult, ticketsResult, missedResult, todayResult, monthResult] = await Promise.all([
      this.repo
        .createQueryBuilder('r')
        .select('AVG(r.score)', 'average_score')
        .addSelect('COUNT(*)', 'ratings_count')
        .where('r.staff_id = :staffId', { staffId })
        .andWhere('r.type = :type', { type: 'client' })
        .getRawOne<{ average_score: string; ratings_count: string }>(),

      this.ticketRepo
        .createQueryBuilder('t')
        .select('COUNT(*)', 'tickets_served')
        .addSelect('AVG(EXTRACT(EPOCH FROM (t.completed_at - t.serving_started_at)) * 1000)', 'avg_ms')
        .where('t.staff_id = :staffId', { staffId })
        .andWhere('t.status = :status', { status: 'completed' })
        .andWhere('t.serving_started_at IS NOT NULL')
        .getRawOne<{ tickets_served: string; avg_ms: string }>(),

      this.ticketRepo.count({ where: { staff_id: staffId, status: 'missed' } }),

      this.ticketRepo
        .createQueryBuilder('t')
        .where('t.staff_id = :staffId', { staffId })
        .andWhere('t.scheduled_date = :today', { today })
        .andWhere('t.status IN (:...s)', { s: ['completed', 'serving', 'called'] })
        .getCount(),

      this.ticketRepo
        .createQueryBuilder('t')
        .where('t.staff_id = :staffId', { staffId })
        .andWhere('t.scheduled_date >= :monthStart', { monthStart })
        .andWhere('t.status = :status', { status: 'completed' })
        .getCount(),
    ]);

    return {
      staff_id: staffId,
      average_score: parseFloat(avgResult?.average_score ?? '0') || 0,
      ratings_count: parseInt(avgResult?.ratings_count ?? '0'),
      tickets_served: parseInt(ticketsResult?.tickets_served ?? '0'),
      average_serving_time_ms: Math.round(parseFloat(ticketsResult?.avg_ms ?? '0') || 0),
      tickets_missed: missedResult,
      tickets_today: todayResult,
      tickets_this_month: monthResult,
    };
  }

  // ─── Хелпери ─────────────────────────────────────────────────────────────

  private async updateDepartmentRating(departmentId: string) {
    const result = await this.repo
      .createQueryBuilder('r')
      .innerJoin(Ticket, 't', 'CAST(t.id AS TEXT) = r.ticket_id')
      .select('AVG(r.score)', 'avg')
      .where('t.department_id = :departmentId', { departmentId })
      .andWhere('r.type = :type', { type: 'client' })
      .getRawOne<{ avg: string }>();

    const rating = parseFloat(result?.avg ?? '0') || 0;
    await this.deptRepo.update(departmentId, { rating });
  }
}
