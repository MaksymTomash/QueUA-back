import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DepartmentsModule } from './departments/departments.module';
import { ServicesModule } from './services/services.module';
import { VerificationsModule } from './verifications/verifications.module';
import { WindowsModule } from './windows/windows.module';
import { TicketsModule } from './tickets/tickets.module';
import { AuditsModule } from './audits/audits.module';
import { QueueCountersModule } from './queue-counters/queue-counters.module';
import { RatingsModule } from './ratings/ratings.module';
import { ReportsModule } from './reports/reports.module';
import { QueueModule } from './queue/queue.module';
import { DepartmentServicesModule } from './department-services/department-services.module';
import { StaffAssignmentsModule } from './staff-assignments/staff-assignments.module';
import { DisciplineEventsModule } from './discipline-events/discipline-events.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, jwtConfig],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.get('database')!,
    }),
    AuthModule,
    UsersModule,
    DepartmentsModule,
    ServicesModule,
    VerificationsModule,
    WindowsModule,
    TicketsModule,
    AuditsModule,
    QueueCountersModule,
    RatingsModule,
    ReportsModule,
    QueueModule,
    DepartmentServicesModule,
    StaffAssignmentsModule,
    DisciplineEventsModule,
  ],
})
export class AppModule {}
