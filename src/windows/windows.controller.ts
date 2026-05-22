import {
  Body,
  Controller,
  forwardRef,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WindowsService } from './windows.service';
import { TicketsService } from '../tickets/tickets.service';
import { CreateWindowDto } from './dto/create-window.dto';
import { QueryWindowsDto } from './dto/query-windows.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Windows')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('windows')
export class WindowsController {
  constructor(
    private readonly windowsService: WindowsService,
    @Inject(forwardRef(() => TicketsService))
    private readonly ticketsService: TicketsService,
  ) {}

  @ApiOperation({ summary: 'Список вікон' })
  @Get()
  findAll(@Query() query: QueryWindowsDto) {
    return this.windowsService.findAll(query);
  }

  @ApiOperation({ summary: 'Вікно за id' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.windowsService.findOne(id);
  }

  @ApiOperation({ summary: 'Загальна черга вікна (service+department)' })
  @Roles('staff', 'admin')
  @Get(':id/queue')
  getQueue(@Param('id') id: string) {
    return this.ticketsService.getWindowQueue(id);
  }

  @ApiOperation({ summary: 'Створити вікно (admin)' })
  @Roles('admin')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateWindowDto) {
    return this.windowsService.create(dto);
  }

  @ApiOperation({ summary: 'Сісти за вікно (staff)' })
  @Roles('staff', 'admin')
  @Post(':id/join')
  join(@Param('id') id: string, @CurrentUser('sub') staffId: string) {
    return this.windowsService.join(id, staffId);
  }

  @ApiOperation({ summary: 'Покинути вікно (staff)' })
  @Roles('staff', 'admin')
  @Post(':id/leave')
  leave(@Param('id') id: string, @CurrentUser('sub') staffId: string) {
    return this.windowsService.leave(id, staffId);
  }

  @ApiOperation({ summary: 'Призупинити чергу (staff)' })
  @Roles('staff', 'admin')
  @Post(':id/pause')
  pause(@Param('id') id: string, @CurrentUser('sub') staffId: string) {
    return this.windowsService.pause(id, staffId);
  }

  @ApiOperation({ summary: 'Відновити чергу (staff)' })
  @Roles('staff', 'admin')
  @Post(':id/resume')
  resume(@Param('id') id: string, @CurrentUser('sub') staffId: string) {
    return this.windowsService.resume(id, staffId);
  }

  @ApiOperation({ summary: 'Викликати наступного з черги (staff)' })
  @Roles('staff', 'admin')
  @Post(':id/call-next')
  callNext(@Param('id') id: string, @CurrentUser('sub') staffId: string) {
    return this.ticketsService.callNextFromWindow(id, staffId);
  }
}
