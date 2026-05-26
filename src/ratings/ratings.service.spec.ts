import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RatingsService } from './ratings.service';
import { Rating } from './rating.entity';
import { Ticket } from '../tickets/ticket.entity';
import { User } from '../users/user.entity';
import { Department } from '../departments/department.entity';
import { DisciplineEventsService } from '../discipline-events/discipline-events.service';

const qbMock = () => ({
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getRawOne: jest.fn().mockResolvedValue({ avg: '0', average_score: '0', ratings_count: '0', tickets_served: '0', avg_ms: '0' }),
});

const repoMock = () => ({
  findOneBy: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  createQueryBuilder: jest.fn(() => qbMock()),
});

describe('RatingsService', () => {
  let service: RatingsService;
  let ratingRepo: ReturnType<typeof repoMock>;
  let ticketRepo: ReturnType<typeof repoMock>;
  let userRepo: ReturnType<typeof repoMock>;
  let deptRepo: ReturnType<typeof repoMock>;
  let disciplineEvents: { log: jest.Mock };

  beforeEach(async () => {
    ratingRepo = repoMock();
    ticketRepo = repoMock();
    userRepo   = repoMock();
    deptRepo   = repoMock();
    disciplineEvents = { log: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RatingsService,
        { provide: getRepositoryToken(Rating),     useValue: ratingRepo },
        { provide: getRepositoryToken(Ticket),     useValue: ticketRepo },
        { provide: getRepositoryToken(User),       useValue: userRepo },
        { provide: getRepositoryToken(Department), useValue: deptRepo },
        { provide: DisciplineEventsService,        useValue: disciplineEvents },
      ],
    }).compile();

    service = module.get<RatingsService>(RatingsService);
  });

  // ─── rateByClient ────────────────────────────────────────────────────────────

  describe('rateByClient', () => {
    const citizenId = 'citizen-1';
    const dto = { ticket_id: 'ticket-1', score: 5 as const };

    it('кидає NotFoundException якщо талон не знайдено', async () => {
      ticketRepo.findOneBy.mockResolvedValue(null);
      await expect(service.rateByClient(citizenId, dto)).rejects.toThrow(NotFoundException);
    });

    it('кидає ForbiddenException якщо талон належить іншому громадянину', async () => {
      ticketRepo.findOneBy.mockResolvedValue({ client_id: 'other', status: 'completed' });
      await expect(service.rateByClient(citizenId, dto)).rejects.toThrow(ForbiddenException);
    });

    it('кидає BadRequestException якщо талон не завершений', async () => {
      ticketRepo.findOneBy.mockResolvedValue({ client_id: citizenId, status: 'waiting' });
      await expect(service.rateByClient(citizenId, dto)).rejects.toThrow(BadRequestException);
    });

    it('кидає BadRequestException якщо вже оцінено', async () => {
      ticketRepo.findOneBy.mockResolvedValue({
        client_id: citizenId, status: 'completed',
        rating_by_client_id: 'rating-existing', staff_id: 'staff-1',
      });
      await expect(service.rateByClient(citizenId, dto)).rejects.toThrow(BadRequestException);
    });

    it('зберігає оцінку і повертає її', async () => {
      const ticket = {
        id: 'ticket-1', client_id: citizenId, status: 'completed',
        rating_by_client_id: null, staff_id: 'staff-1', department_id: 'dept-1',
      };
      const saved = { id: 'rating-1', score: 5, type: 'client' };
      ticketRepo.findOneBy.mockResolvedValue(ticket);
      ratingRepo.create.mockReturnValue(saved);
      ratingRepo.save.mockResolvedValue(saved);
      ticketRepo.update.mockResolvedValue(undefined);
      deptRepo.update.mockResolvedValue(undefined);

      const result = await service.rateByClient(citizenId, dto);

      expect(result).toEqual(saved);
      expect(ratingRepo.save).toHaveBeenCalledTimes(1);
      expect(ticketRepo.update).toHaveBeenCalledWith('ticket-1', expect.objectContaining({
        rating_by_client_id: 'rating-1',
        client_rating: 5,
      }));
    });
  });

  // ─── rateByStaff + discipline score ──────────────────────────────────────────

  describe('rateByStaff — discipline score', () => {
    const staffId = 'staff-1';
    const clientId = 'citizen-1';

    const buildTicket = () => ({
      id: 'ticket-1', staff_id: staffId, client_id: clientId,
      status: 'completed', rating_by_staff_id: null, department_id: 'dept-1',
    });

    const mockSave = (score: number) => {
      const saved = { id: 'rating-1', score };
      ratingRepo.create.mockReturnValue(saved);
      ratingRepo.save.mockResolvedValue(saved);
      ticketRepo.update.mockResolvedValue(undefined);
      userRepo.update.mockResolvedValue(undefined);
    };

    it.each([
      { score: 5, expectedScore: 100, expectedImpact:  5   },
      { score: 4, expectedScore:  80, expectedImpact:  2.5 },
      { score: 3, expectedScore:  60, expectedImpact:  0   },
      { score: 2, expectedScore:  40, expectedImpact: -2.5 },
      { score: 1, expectedScore:  20, expectedImpact: -5   },
    ])('оцінка $score → discipline_score=$expectedScore, impact=$expectedImpact', async ({ score, expectedScore, expectedImpact }) => {
      ticketRepo.findOneBy.mockResolvedValue(buildTicket());
      mockSave(score);
      ratingRepo.find.mockResolvedValue([{ score }]);

      await service.rateByStaff(staffId, { ticket_id: 'ticket-1', score: score as any });

      expect(userRepo.update).toHaveBeenCalledWith(clientId, { discipline_score: expectedScore });
      expect(disciplineEvents.log).toHaveBeenCalledWith(expect.objectContaining({ impact: expectedImpact }));
    });

    it('discipline_score рахується як середнє по останніх 20 оцінках', async () => {
      ticketRepo.findOneBy.mockResolvedValue(buildTicket());
      mockSave(5);
      // 4 оцінки з avg = 3.5 → discipline_score = round(3.5 * 20) = 70
      ratingRepo.find.mockResolvedValue([
        { score: 5 }, { score: 4 }, { score: 3 }, { score: 2 },
      ]);

      await service.rateByStaff(staffId, { ticket_id: 'ticket-1', score: 5 as any });

      expect(userRepo.update).toHaveBeenCalledWith(clientId, { discipline_score: 70 });
    });
  });

  // ─── getPerformance ───────────────────────────────────────────────────────────

  describe('getPerformance', () => {
    it('повертає нулі коли даних немає', async () => {
      const result = await service.getPerformance('staff-1');
      expect(result).toMatchObject({
        staff_id: 'staff-1',
        average_score: 0,
        ratings_count: 0,
        tickets_served: 0,
        average_serving_time_ms: 0,
      });
    });

    it('парсить числові рядки з бази', async () => {
      ratingRepo.createQueryBuilder.mockReturnValue({
        ...qbMock(),
        getRawOne: jest.fn().mockResolvedValue({ average_score: '4.75', ratings_count: '12' }),
      });
      ticketRepo.createQueryBuilder.mockReturnValue({
        ...qbMock(),
        getRawOne: jest.fn().mockResolvedValue({ tickets_served: '8', avg_ms: '45000.5' }),
      });

      const result = await service.getPerformance('staff-1');

      expect(result.average_score).toBeCloseTo(4.75);
      expect(result.ratings_count).toBe(12);
      expect(result.tickets_served).toBe(8);
      expect(result.average_serving_time_ms).toBe(45001);
    });
  });
});
