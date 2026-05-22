import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VerificationsController } from './verifications.controller';
import { VerificationsService } from './verifications.service';
import { Verification } from './verification.entity';
import { User } from '../users/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Verification, User])],
  controllers: [VerificationsController],
  providers: [VerificationsService],
})
export class VerificationsModule {}
