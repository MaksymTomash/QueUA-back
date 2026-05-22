import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async findMe(userId: string) {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('Користувача не знайдено');
    return this.mapUser(user);
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    await this.userRepo.update(userId, dto);
    return this.findMe(userId);
  }

  async findAll(query: QueryUsersDto) {
    const { role, page = 1, page_size = 20 } = query;
    const qb = this.userRepo.createQueryBuilder('user');
    if (role) qb.where('user.role = :role', { role });
    qb.skip((page - 1) * page_size).take(page_size);
    const users = await qb.getMany();
    return users.map(this.mapUser);
  }

  async findOne(id: string) {
    const user = await this.userRepo.findOneBy({ id });
    if (!user) throw new NotFoundException('Користувача не знайдено');
    return this.mapUser(user);
  }

  async updateOne(id: string, dto: UpdateUserDto) {
    await this.findOne(id);
    await this.userRepo.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.userRepo.delete(id);
  }

  mapUser(user: User) {
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
    };
  }
}
