import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DisciplineEvent } from './discipline-event.entity';
import { DisciplineEventsService } from './discipline-events.service';

@Module({
  imports: [TypeOrmModule.forFeature([DisciplineEvent])],
  providers: [DisciplineEventsService],
  exports: [DisciplineEventsService],
})
export class DisciplineEventsModule {}
