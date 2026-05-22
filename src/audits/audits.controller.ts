import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditsService } from './audits.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Audits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('staff', 'admin')
@Controller('audits')
export class AuditsController {
  constructor(private readonly auditsService: AuditsService) {}

  @ApiOperation({ summary: 'Аудит талонів (staff, admin)' })
  @ApiQuery({ name: 'ticket_id', required: false })
  @ApiQuery({ name: 'staff_id', required: false })
  @ApiQuery({ name: 'department_id', required: false })
  @ApiQuery({ name: 'date_from', required: false })
  @ApiQuery({ name: 'date_to', required: false })
  @Get()
  findAll(
    @Query('ticket_id') ticket_id?: string,
    @Query('staff_id') staff_id?: string,
    @Query('department_id') department_id?: string,
    @Query('date_from') date_from?: string,
    @Query('date_to') date_to?: string,
  ) {
    return this.auditsService.findAll({ ticket_id, staff_id, department_id, date_from, date_to });
  }
}
