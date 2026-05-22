import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { Ticket } from './ticket.entity';
import { Window } from '../windows/window.entity';
import { QueueService } from '../services/service.entity';
import { Department } from '../departments/department.entity';
import { AuditsModule } from '../audits/audits.module';
import { QueueCountersModule } from '../queue-counters/queue-counters.module';
import { WindowsModule } from '../windows/windows.module';
import { QueueModule } from '../queue/queue.module';
import { DepartmentServicesModule } from '../department-services/department-services.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, Window, QueueService, Department]),
    AuditsModule,
    QueueCountersModule,
    forwardRef(() => WindowsModule),
    QueueModule,
    DepartmentServicesModule,
  ],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
