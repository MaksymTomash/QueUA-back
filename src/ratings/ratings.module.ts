import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RatingsController } from './ratings.controller';
import { RatingsService } from './ratings.service';
import { Rating } from './rating.entity';
import { Ticket } from '../tickets/ticket.entity';
import { User } from '../users/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Rating, Ticket, User])],
  controllers: [RatingsController],
  providers: [RatingsService],
})
export class RatingsModule {}
