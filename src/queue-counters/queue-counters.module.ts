import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueCounter } from './queue-counter.entity';
import { QueueCountersService } from './queue-counters.service';

@Module({
  imports: [TypeOrmModule.forFeature([QueueCounter])],
  providers: [QueueCountersService],
  exports: [QueueCountersService],
})
export class QueueCountersModule {}
