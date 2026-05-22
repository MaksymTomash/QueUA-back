import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TicketsService } from './tickets.service';
import { BookTicketDto } from './dto/book-ticket.dto';
import { ManualTicketDto } from './dto/manual-ticket.dto';
import { CompleteTicketDto } from './dto/complete-ticket.dto';
import { QueryTicketsDto } from './dto/query-tickets.dto';
import { SlotsQueryDto } from './dto/slots-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  // ─── citizen ─────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Доступні слоти відділення (будь-яка роль)' })
  @Roles('citizen', 'staff', 'admin')
  @Get('slots')
  getSlots(@Query() query: SlotsQueryDto) {
    return this.ticketsService.getSlots(query.department_id, query.service_id, query.date);
  }

  @ApiOperation({ summary: 'Забронювати талон (citizen)' })
  @Roles('citizen')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  book(@CurrentUser('sub') clientId: string, @Body() dto: BookTicketDto) {
    return this.ticketsService.book(clientId, dto);
  }

  @ApiOperation({ summary: 'Активний талон (citizen)' })
  @Roles('citizen')
  @Get('active')
  getActive(@CurrentUser('sub') clientId: string) {
    return this.ticketsService.getActive(clientId);
  }

  @ApiOperation({ summary: 'Мої талони (citizen)' })
  @Roles('citizen')
  @Get('my')
  getMy(
    @CurrentUser('sub') clientId: string,
    @Query('page') page = 1,
    @Query('page_size') pageSize = 20,
  ) {
    return this.ticketsService.getMy(clientId, +page, +pageSize);
  }

  @ApiOperation({ summary: 'Скасувати талон (citizen)' })
  @Roles('citizen')
  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser('sub') clientId: string) {
    return this.ticketsService.cancel(id, clientId);
  }

  // ─── staff / admin ────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Ручна видача талону (staff)' })
  @Roles('staff', 'admin')
  @Post('manual')
  @HttpCode(HttpStatus.CREATED)
  manual(@CurrentUser('sub') staffId: string, @Body() dto: ManualTicketDto) {
    return this.ticketsService.issueManual(staffId, dto);
  }

  @ApiOperation({ summary: 'Список талонів (staff, admin)' })
  @Roles('staff', 'admin')
  @Get()
  findAll(@Query() query: QueryTicketsDto) {
    return this.ticketsService.findAll(query);
  }

  @ApiOperation({ summary: 'Почати обслуговування (staff)' })
  @Roles('staff', 'admin')
  @Post(':id/start')
  start(@Param('id') id: string, @CurrentUser('sub') staffId: string) {
    return this.ticketsService.start(id, staffId);
  }

  @ApiOperation({ summary: 'Завершити обслуговування (staff)' })
  @Roles('staff', 'admin')
  @Post(':id/complete')
  complete(
    @Param('id') id: string,
    @CurrentUser('sub') staffId: string,
    @Body() dto: CompleteTicketDto,
  ) {
    return this.ticketsService.complete(id, staffId, dto);
  }

  @ApiOperation({ summary: 'Клієнт відсутній (staff)' })
  @Roles('staff', 'admin')
  @Post(':id/miss')
  miss(@Param('id') id: string, @CurrentUser('sub') staffId: string) {
    return this.ticketsService.miss(id, staffId);
  }

  // ─── будь-яка роль ────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Талон за id' })
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser('sub') requesterId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.ticketsService.findOne(id, requesterId, role);
  }
}
