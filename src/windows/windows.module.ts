import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WindowsController } from './windows.controller';
import { WindowsService } from './windows.service';
import { Window } from './window.entity';
import { TicketsModule } from '../tickets/tickets.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Window]),
    forwardRef(() => TicketsModule),
    QueueModule,
  ],
  controllers: [WindowsController],
  providers: [WindowsService],
  exports: [WindowsService],
})
export class WindowsModule {}
