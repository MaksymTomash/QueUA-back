import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { Department } from './department.entity';
import { DepartmentServicesModule } from '../department-services/department-services.module';

@Module({
  imports: [TypeOrmModule.forFeature([Department]), DepartmentServicesModule],
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
