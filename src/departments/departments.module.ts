import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { Department } from './department.entity';
import { DepartmentServicesModule } from '../department-services/department-services.module';
import { StaffAssignmentsModule } from '../staff-assignments/staff-assignments.module';

@Module({
  imports: [TypeOrmModule.forFeature([Department]), DepartmentServicesModule, StaffAssignmentsModule],
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
