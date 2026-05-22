import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Verification } from './verification.entity';
import { User } from '../users/user.entity';
import { CreateVerificationDto } from './dto/create-verification.dto';
import { ReviewVerificationDto } from './dto/review-verification.dto';

@Injectable()
export class VerificationsService {
  constructor(
    @InjectRepository(Verification)
    private readonly repo: Repository<Verification>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async findMine(userId: string) {
    const v = await this.repo.findOneBy({ user_id: userId });
    if (!v) throw new NotFoundException('Верифікацію не знайдено');
    return v;
  }

  async create(userId: string, dto: CreateVerificationDto) {
    const existing = await this.repo.findOneBy({ user_id: userId, status: 'pending' });
    if (existing) throw new BadRequestException('Верифікація вже подана і очікує розгляду');

    const v = this.repo.create({ ...dto, user_id: userId });
    return this.repo.save(v);
  }

  async findAll(status?: string) {
    if (status) return this.repo.findBy({ status: status as any });
    return this.repo.find();
  }

  async review(id: string, staffId: string, dto: ReviewVerificationDto) {
    const v = await this.repo.findOneBy({ id });
    if (!v) throw new NotFoundException('Верифікацію не знайдено');
    if (v.status !== 'pending')
      throw new BadRequestException('Верифікація вже розглянута');

    v.status = dto.status;
    v.verified_by = staffId;
    v.verified_at = new Date();
    if (dto.rejection_reason) v.rejection_reason = dto.rejection_reason;

    if (dto.status === 'approved') {
      await this.userRepo.update(v.user_id, { is_verified: true });
    }

    return this.repo.save(v);
  }
}
