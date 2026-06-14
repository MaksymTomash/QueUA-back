import {
  Body,
  Controller,
  Delete,
  forwardRef,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WindowsService } from './windows.service';
import { TicketsService } from '../tickets/tickets.service';
import { CreateWindowDto } from './dto/create-window.dto';
import { UpdateWindowDto } from './dto/update-window.dto';
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

  @ApiOperation({ summary: 'Створити вікно (admin, керівник відділення)' })
  @Roles('admin', 'staff')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateWindowDto, @CurrentUser() user: { sub: string; role: string }) {
    return this.windowsService.create(dto, user);
  }

  @ApiOperation({ summary: 'Оновити вікно — назва, послуга, призначений працівник (admin, керівник відділення)' })
  @Roles('admin', 'staff')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWindowDto,
    @CurrentUser() user: { sub: string; role: string },
  ) {
    return this.windowsService.update(id, dto, user);
  }

  @ApiOperation({ summary: 'Видалити вікно (admin, керівник відділення)' })
  @Roles('admin', 'staff')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: { sub: string; role: string }) {
    return this.windowsService.remove(id, user);
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
