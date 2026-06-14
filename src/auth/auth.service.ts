import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import { User } from '../users/user.entity';
import { RefreshToken } from './refresh-token.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.userRepo.findOneBy({ email: dto.email });
    if (exists) throw new ConflictException('Email вже зареєстровано');

    const password_hash = await bcrypt.hash(dto.password, 12);
    const user = this.userRepo.create({
      email: dto.email,
      password_hash,
      first_name: dto.first_name,
      last_name: dto.last_name,
      middle_name: dto.middle_name ?? null,
      phone: dto.phone ?? null,
    });
    await this.userRepo.save(user);

    return this.issueTokens(user);
  }

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOneBy({ email: dto.email });
    if (!user) throw new UnauthorizedException('Невірний email або пароль');

    const valid = await bcrypt.compare(dto.password, user.password_hash);
    if (!valid) throw new UnauthorizedException('Невірний email або пароль');

    return this.issueTokens(user);
  }

  async refresh(rawToken: string) {
    let payload: { sub: string };
    try {
      payload = this.jwtService.verify(rawToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Недійсний refresh token');
    }

    const stored = await this.refreshTokenRepo.findOneBy({ user_id: payload.sub });

    if (!stored || stored.expires_at < new Date()) {
      throw new UnauthorizedException('Refresh token не знайдено або закінчився');
    }

    const valid = await bcrypt.compare(rawToken, stored.token_hash);
    if (!valid) throw new UnauthorizedException('Недійсний refresh token');

    const user = await this.userRepo.findOneBy({ id: payload.sub });
    if (!user) throw new UnauthorizedException('Користувача не знайдено');

    await this.refreshTokenRepo.remove(stored);

    return this.issueTokens(user);
  }

  async googleLogin(idToken: string) {
    let firebaseUser: admin.auth.DecodedIdToken;
    try {
      firebaseUser = await admin.auth().verifyIdToken(idToken);
    } catch {
      throw new UnauthorizedException('Недійсний Firebase ID Token');
    }

    const { email, name, picture } = firebaseUser;
    if (!email) throw new UnauthorizedException('Google акаунт не має email');

    let user = await this.userRepo.findOneBy({ email });

    if (!user) {
      // Перший вхід — створюємо акаунт автоматично
      const nameParts = (name ?? '').split(' ');
      user = this.userRepo.create({
        email,
        password_hash: '',          // Google-юзери не мають пароля
        first_name: nameParts[0] ?? email.split('@')[0],
        last_name: nameParts[1] ?? '',
        avatar_url: picture ?? null,
      });
      await this.userRepo.save(user);
    } else if (picture && !user.avatar_url) {
      // Оновлюємо аватар якщо ще не встановлений
      await this.userRepo.update(user.id, { avatar_url: picture });
      user.avatar_url = picture;
    }

    return this.issueTokens(user);
  }

  async logout(userId: string) {
    await this.refreshTokenRepo.delete({ user_id: userId });
  }

  private async issueTokens(user: User) {
    const payload = { sub: user.id, email: user.email, role: user.role };

    const access_token = this.jwtService.sign(
      { ...payload, jti: randomUUID() },
      { secret: this.config.get<string>('jwt.accessSecret'), expiresIn: 3600 },
    );

    const refresh_token = this.jwtService.sign(
      { sub: user.id },
      {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: 60 * 60 * 24 * 30,
      },
    );

    const token_hash = await bcrypt.hash(refresh_token, 10);
    const expires_at = new Date();
    expires_at.setDate(expires_at.getDate() + 30);

    await this.refreshTokenRepo.delete({ user_id: user.id });

    const tokenEntity = this.refreshTokenRepo.create({
      token_hash,
      expires_at,
      user_id: user.id,
    });
    await this.refreshTokenRepo.save(tokenEntity);

    return {
      access_token,
      refresh_token,
      expires_in: 3600,
      user: this.mapUser(user),
    };
  }

  private mapUser(user: User) {
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
