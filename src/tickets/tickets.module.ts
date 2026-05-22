import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { Ticket } from './ticket.entity';
import { Window } from '../windows/window.entity';
import { QueueService } from '../services/service.entity';
import { Department } from '../departments/department.entity';
import { User } from '../users/user.entity';
import { AuditsModule } from '../audits/audits.module';
import { QueueCountersModule } from '../queue-counters/queue-counters.module';
import { WindowsModule } from '../windows/windows.module';
import { QueueModule } from '../queue/queue.module';
import { DepartmentServicesModule } from '../department-services/department-services.module';
import { DisciplineEventsModule } from '../discipline-events/discipline-events.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, Window, QueueService, Department, User]),
    AuditsModule,
    QueueCountersModule,
    forwardRef(() => WindowsModule),
    QueueModule,
    DepartmentServicesModule,
    DisciplineEventsModule,
  ],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
