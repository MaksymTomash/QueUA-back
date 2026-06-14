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

  // Додаємо virtual-поле document_photo_url щоб фронтенд знав що фото є
  private withPhotoUrl(v: Verification) {
    return {
      ...v,
      // Шлях відносно API-кореня (без /v1) — фронтенд будує повний URL через API_URL токен
      document_photo_url: v.document_photo_mime ? `verifications/${v.id}/photo` : null,
    };
  }

  async findMine(userId: string) {
    const v = await this.repo.findOneBy({ user_id: userId });
    if (!v) throw new NotFoundException('Верифікацію не знайдено');
    return this.withPhotoUrl(v);
  }

  async create(
    userId: string,
    dto: CreateVerificationDto,
    file?: Express.Multer.File,
  ) {
    const existing = await this.repo.findOneBy({ user_id: userId, status: 'pending' });
    if (existing) throw new BadRequestException('Верифікація вже подана і очікує розгляду');

    const v = this.repo.create({ ...dto, user_id: userId });
    if (file) {
      v.document_photo = file.buffer;
      v.document_photo_mime = file.mimetype;
    }
    const saved = await this.repo.save(v);
    return this.withPhotoUrl(saved);
  }

  async getPhoto(id: string): Promise<{ data: Buffer; mime: string }> {
    const v = await this.repo
      .createQueryBuilder('v')
      .select(['v.id', 'v.document_photo', 'v.document_photo_mime'])
      .where('v.id = :id', { id })
      .getOne();
    if (!v?.document_photo) throw new NotFoundException('Фото не знайдено');
    return { data: v.document_photo, mime: v.document_photo_mime! };
  }

  async findAll(status?: string) {
    const items = status
      ? await this.repo.findBy({ status: status as any })
      : await this.repo.find();
    return items.map((v) => this.withPhotoUrl(v));
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
      const userUpdate: Partial<User> = { is_verified: true };
      if (dto.passport_number) userUpdate.passport_number = dto.passport_number;
      else if (v.document_number) userUpdate.passport_number = v.document_number;
      if (dto.tax_id) userUpdate.tax_id = dto.tax_id;
      await this.userRepo.update(v.user_id, userUpdate);
    }

    return this.withPhotoUrl(await this.repo.save(v));
  }
}
