import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DepartmentService } from './department-service.entity';
import { DepartmentServicesService } from './department-services.service';

@Module({
  imports: [TypeOrmModule.forFeature([DepartmentService])],
  providers: [DepartmentServicesService],
  exports: [DepartmentServicesService],
})
export class DepartmentServicesModule {}
