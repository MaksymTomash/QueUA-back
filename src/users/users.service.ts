import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { User } from './user.entity';
import { VerificationLog } from './verification-log.entity';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { SubmitIdentityDto } from './dto/submit-identity.dto';
import { CreateVisitorDto } from './dto/create-visitor.dto';
import { StaffAssignmentsService } from '../staff-assignments/staff-assignments.service';

export interface RequestingUser {
  id: string;
  role: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(VerificationLog)
    private readonly verificationLogRepo: Repository<VerificationLog>,
    private readonly staffAssignments: StaffAssignmentsService,
  ) {}

  async findMe(userId: string) {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('Користувача не знайдено');
    return this.mapUser(user, true);
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    await this.userRepo.update(userId, dto);
    return this.findMe(userId);
  }

  async findAll(query: QueryUsersDto, viewer?: RequestingUser) {
    const { role, search, page = 1, page_size = 20 } = query;
    const qb = this.userRepo.createQueryBuilder('user');
    if (role) qb.andWhere('user.role = :role', { role });
    if (search) {
      qb.andWhere(
        '(user.first_name ILIKE :q OR user.last_name ILIKE :q OR user.email ILIKE :q ' +
          'OR user.tax_id ILIKE :q OR user.passport_number ILIKE :q)',
        { q: `%${search}%` },
      );
    }
    qb.skip((page - 1) * page_size).take(page_size);
    const users = await qb.getMany();
    return Promise.all(users.map((u) => this.toDto(u, viewer)));
  }

  async findOne(id: string, viewer?: RequestingUser) {
    const user = await this.userRepo.findOneBy({ id });
    if (!user) throw new NotFoundException('Користувача не знайдено');
    return this.toDto(user, viewer);
  }

  async updateOne(id: string, dto: UpdateUserDto, requestingUserId?: string) {
    const current = await this.userRepo.findOneBy({ id });
    if (!current) throw new NotFoundException('Користувача не знайдено');
    await this.userRepo.update(id, dto);
    if (dto.is_verified === false && current.is_verified === true) {
      await this.verificationLogRepo.save({
        user_id: id,
        event_type: 'revoked',
        tax_id: current.tax_id,
        passport_number: current.passport_number,
        document_photo_url: current.document_photo_url,
        processed_by_id: requestingUserId ?? null,
      });
    }
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.userRepo.delete(id);
  }

  async submitIdentity(userId: string, dto: SubmitIdentityDto) {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('Користувача не знайдено');
    if (user.is_verified) throw new ForbiddenException('Особу вже верифіковано — дані змінити неможливо');
    const dup = await this.userRepo.findOneBy({ tax_id: dto.tax_id });
    if (dup && dup.id !== userId) throw new ConflictException('Акаунт з таким ІПН вже існує');
    const dupPassport = await this.userRepo.findOneBy({ passport_number: dto.passport_number });
    if (dupPassport && dupPassport.id !== userId) throw new ConflictException('Акаунт з таким номером паспорта вже існує');
    await this.userRepo.update(userId, {
      tax_id: dto.tax_id,
      passport_number: dto.passport_number,
      ...(dto.document_photo_url ? { document_photo_url: dto.document_photo_url } : {}),
    });
    await this.verificationLogRepo.save({
      user_id: userId,
      event_type: 'submitted',
      tax_id: dto.tax_id,
      passport_number: dto.passport_number,
      document_photo_url: dto.document_photo_url ?? null,
    });
    return this.findMe(userId);
  }

  async approveVerification(staffId: string, userId: string) {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('Користувача не знайдено');
    if (!user.tax_id) throw new ConflictException('Користувач ще не подав документи');
    await this.userRepo.update(userId, { is_verified: true });
    await this.verificationLogRepo.save({
      user_id: userId,
      event_type: 'approved',
      tax_id: user.tax_id,
      passport_number: user.passport_number,
      document_photo_url: user.document_photo_url,
      processed_by_id: staffId,
    });
    return this.findOne(userId, { id: staffId, role: 'staff' });
  }

  async rejectVerification(userId: string, staffId?: string) {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('Користувача не знайдено');
    await this.verificationLogRepo.save({
      user_id: userId,
      event_type: 'rejected',
      tax_id: user.tax_id,
      passport_number: user.passport_number,
      document_photo_url: user.document_photo_url,
      processed_by_id: staffId ?? null,
    });
    await this.userRepo.update(userId, { tax_id: null, passport_number: null, document_photo_url: null, is_verified: false });
  }

  async findPendingVerification(viewer: RequestingUser) {
    const users = await this.userRepo
      .createQueryBuilder('user')
      .where('user.tax_id IS NOT NULL')
      .andWhere('user.is_verified = false')
      .orderBy('user.updated_at', 'ASC')
      .getMany();
    return Promise.all(users.map((u) => this.toDto(u, viewer)));
  }

  async createVisitor(dto: CreateVisitorDto) {
    if (dto.tax_id) {
      const existing = await this.userRepo.findOneBy({ tax_id: dto.tax_id });
      if (existing) throw new ConflictException('Акаунт з таким ІПН вже існує');
    }
    const user = this.userRepo.create({
      first_name: dto.first_name,
      last_name: dto.last_name,
      middle_name: dto.middle_name ?? null,
      tax_id: dto.tax_id ?? null,
      passport_number: dto.passport_number ?? null,
      email: `visitor_${randomUUID()}@queua.internal`,
      password_hash: '!visitor_no_login',
      role: 'citizen',
      is_verified: !!(dto.tax_id && dto.passport_number),
    });
    const saved = await this.userRepo.save(user);
    return this.mapUser(saved, true);
  }

  async getVerificationHistory(userId: string) {
    const logs = await this.verificationLogRepo
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.processed_by', 'processedBy')
      .where('log.user_id = :userId', { userId })
      .orderBy('log.created_at', 'DESC')
      .getMany();
    return logs.map((l) => this.mapLog(l));
  }

  async getAllVerificationHistory(page = 1, pageSize = 30, search?: string) {
    const qb = this.verificationLogRepo
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.user', 'user')
      .leftJoinAndSelect('log.processed_by', 'processedBy');
    if (search) {
      qb.where(
        '(user.first_name ILIKE :q OR user.last_name ILIKE :q OR log.tax_id ILIKE :q OR log.passport_number ILIKE :q)',
        { q: `%${search}%` },
      );
    }
    const [logs, total] = await qb
      .orderBy('log.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items: logs.map((l) => this.mapLog(l, true)), total, page, page_size: pageSize };
  }

  private mapLog(log: VerificationLog, includeUser = false) {
    return {
      id: log.id,
      user_id: log.user_id,
      event_type: log.event_type,
      tax_id: log.tax_id,
      passport_number: log.passport_number,
      document_photo_url: log.document_photo_url,
      processed_by_id: log.processed_by_id,
      processed_by: log.processed_by
        ? { first_name: log.processed_by.first_name, last_name: log.processed_by.last_name }
        : null,
      ...(includeUser && log.user
        ? { user: { first_name: log.user.first_name, last_name: log.user.last_name, email: log.user.email } }
        : {}),
      created_at: log.created_at,
    };
  }

  private async toDto(user: User, viewer?: RequestingUser) {
    return this.mapUser(user, await this.canViewDocuments(user, viewer));
  }

  // Документи (ІПН, паспорт) бачить сам власник, адмін, персонал — для ідентифікації
  // відвідувачів, і керівник відділення — лише про своїх підлеглих.
  private async canViewDocuments(target: User, viewer?: RequestingUser): Promise<boolean> {
    if (!viewer) return false;
    if (viewer.id === target.id) return true;
    if (viewer.role === 'admin') return true;
    if (target.role === 'citizen') return viewer.role === 'staff';
    if (target.role === 'staff') {
      const assignments = await this.staffAssignments.findByStaff(target.id);
      return assignments.some((a) => a.department?.leader_id === viewer.id);
    }
    return false;
  }

  mapUser(user: User, includeDocuments = false) {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      first_name: user.first_name,
      last_name: user.last_name,
      middle_name: user.middle_name,
      role: user.role,
      is_verified: user.is_verified,
      discipline_score: user.discipline_score,
      attendance_rate: user.attendance_rate,
      current_streak: user.current_streak,
      avatar_url: user.avatar_url,
      created_at: user.created_at,
      updated_at: user.updated_at,
      ...(includeDocuments
        ? { tax_id: user.tax_id, passport_number: user.passport_number, document_photo_url: user.document_photo_url }
        : {}),
    };
  }
}
