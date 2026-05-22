import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffAssignment } from './staff-assignment.entity';
import { StaffAssignmentsService } from './staff-assignments.service';

@Module({
  imports: [TypeOrmModule.forFeature([StaffAssignment])],
  providers: [StaffAssignmentsService],
  exports: [StaffAssignmentsService],
})
export class StaffAssignmentsModule {}
