import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { VerificationsService } from './verifications.service';
import { CreateVerificationDto } from './dto/create-verification.dto';
import { ReviewVerificationDto } from './dto/review-verification.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Verifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('verifications')
export class VerificationsController {
  constructor(private readonly verificationsService: VerificationsService) {}

  @ApiOperation({ summary: 'Моя верифікація (citizen)' })
  @Roles('citizen')
  @Get('me')
  findMine(@CurrentUser('sub') userId: string) {
    return this.verificationsService.findMine(userId);
  }

  @ApiOperation({ summary: 'Подати документи (citizen)' })
  @Roles('citizen')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateVerificationDto) {
    return this.verificationsService.create(userId, dto);
  }

  @ApiOperation({ summary: 'Список верифікацій (staff, admin)' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'approved', 'rejected'] })
  @Roles('staff', 'admin')
  @Get()
  findAll(@Query('status') status?: string) {
    return this.verificationsService.findAll(status);
  }

  @ApiOperation({ summary: 'Схвалити/відхилити (staff, admin)' })
  @Roles('staff', 'admin')
  @Patch(':id')
  review(
    @Param('id') id: string,
    @CurrentUser('sub') staffId: string,
    @Body() dto: ReviewVerificationDto,
  ) {
    return this.verificationsService.review(id, staffId, dto);
  }
}
