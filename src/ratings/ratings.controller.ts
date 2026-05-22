import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RatingsService } from './ratings.service';
import { ClientRatingDto } from './dto/client-rating.dto';
import { StaffRatingDto } from './dto/staff-rating.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Ratings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ratings')
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  @ApiOperation({ summary: 'Citizen оцінює спеціаліста' })
  @Roles('citizen')
  @Post('client')
  @HttpCode(HttpStatus.CREATED)
  rateByClient(@CurrentUser('sub') citizenId: string, @Body() dto: ClientRatingDto) {
    return this.ratingsService.rateByClient(citizenId, dto);
  }

  @ApiOperation({ summary: 'Staff оцінює громадянина' })
  @Roles('staff', 'admin')
  @Post('staff')
  @HttpCode(HttpStatus.CREATED)
  rateByStaff(@CurrentUser('sub') staffId: string, @Body() dto: StaffRatingDto) {
    return this.ratingsService.rateByStaff(staffId, dto);
  }

  @ApiOperation({ summary: 'Агрегована статистика спеціаліста' })
  @Roles('staff', 'admin')
  @Get('performance/:staffId')
  getPerformance(@Param('staffId') staffId: string, @CurrentUser('sub') requesterId: string, @CurrentUser('role') role: string) {
    // staff може дивитись тільки свою статистику
    if (role === 'staff' && staffId !== requesterId) {
      staffId = requesterId;
    }
    return this.ratingsService.getPerformance(staffId);
  }
}
