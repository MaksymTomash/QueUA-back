import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WindowsController } from './windows.controller';
import { WindowsService } from './windows.service';
import { Window } from './window.entity';
import { TicketsModule } from '../tickets/tickets.module';
import { QueueModule } from '../queue/queue.module';
import { StaffAssignmentsModule } from '../staff-assignments/staff-assignments.module';
import { DepartmentsModule } from '../departments/departments.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Window]),
    forwardRef(() => TicketsModule),
    QueueModule,
    StaffAssignmentsModule,
    DepartmentsModule,
  ],
  controllers: [WindowsController],
  providers: [WindowsService],
  exports: [WindowsService],
})
export class WindowsModule {}
