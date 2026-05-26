import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { StaffAssignmentsService } from '../staff-assignments/staff-assignments.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly staffAssignments: StaffAssignmentsService,
  ) {}

  @ApiOperation({ summary: 'Профіль поточного користувача' })
  @Get('me')
  getMe(@CurrentUser('sub') userId: string) {
    return this.usersService.findMe(userId);
  }

  @ApiOperation({ summary: 'Призначення поточного спеціаліста (staff/admin)' })
  @Roles('staff', 'admin')
  @Get('me/assignments')
  getMyAssignments(@CurrentUser('sub') staffId: string) {
    return this.staffAssignments.findByStaff(staffId);
  }

  @ApiOperation({ summary: 'Оновити власний профіль' })
  @Patch('me')
  updateMe(@CurrentUser('sub') userId: string, @Body() dto: UpdateMeDto) {
    return this.usersService.updateMe(userId, dto);
  }

  @ApiOperation({ summary: 'Список користувачів (admin — всі; staff — тільки з role фільтром)' })
  @Roles('staff', 'admin')
  @Get()
  findAll(@Query() query: QueryUsersDto, @CurrentUser('role') requesterRole: string) {
    if (requesterRole === 'staff' && !query.role) {
      throw new BadRequestException('Параметр role є обовʼязковим для staff');
    }
    return this.usersService.findAll(query);
  }

  @ApiOperation({ summary: 'Користувач за id (staff, admin)' })
  @Roles('staff', 'admin')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @ApiOperation({ summary: 'Оновити користувача (admin)' })
  @Roles('admin')
  @Patch(':id')
  updateOne(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.updateOne(id, dto);
  }

  @ApiOperation({ summary: 'Видалити користувача (admin)' })
  @Roles('admin')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
