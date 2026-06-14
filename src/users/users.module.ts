import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './user.entity';
import { VerificationLog } from './verification-log.entity';
import { StaffAssignmentsModule } from '../staff-assignments/staff-assignments.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, VerificationLog]), StaffAssignmentsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
