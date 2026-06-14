import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { StaffAssignmentsService } from '../staff-assignments/staff-assignments.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { SubmitIdentityDto } from './dto/submit-identity.dto';
import { CreateVisitorDto } from './dto/create-visitor.dto';
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

  @ApiOperation({ summary: 'Подати документи для верифікації (citizen)' })
  @Roles('citizen')
  @Patch('me/identity')
  submitIdentity(@CurrentUser('sub') userId: string, @Body() dto: SubmitIdentityDto) {
    return this.usersService.submitIdentity(userId, dto);
  }

  @ApiOperation({ summary: 'Список на очікуванні верифікації (staff, admin)' })
  @Roles('staff', 'admin')
  @Get('pending-verification')
  findPendingVerification(
    @CurrentUser('sub') requesterId: string,
    @CurrentUser('role') requesterRole: string,
  ) {
    return this.usersService.findPendingVerification({ id: requesterId, role: requesterRole });
  }

  @ApiOperation({ summary: 'Створити акаунт відвідувача без смартфону (staff, admin)' })
  @Roles('staff', 'admin')
  @Post('visitor')
  @HttpCode(HttpStatus.CREATED)
  createVisitor(@Body() dto: CreateVisitorDto) {
    return this.usersService.createVisitor(dto);
  }

  @ApiOperation({ summary: 'Моя історія верифікацій' })
  @Get('me/verification-history')
  getMyVerificationHistory(@CurrentUser('sub') userId: string) {
    return this.usersService.getVerificationHistory(userId);
  }

  @ApiOperation({ summary: 'Повна історія верифікацій (admin)' })
  @Roles('admin')
  @Get('verification-history')
  getAllVerificationHistory(
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('page_size', new ParseIntPipe({ optional: true })) pageSize?: number,
    @Query('search') search?: string,
  ) {
    return this.usersService.getAllVerificationHistory(page ?? 1, pageSize ?? 30, search || undefined);
  }

  @ApiOperation({ summary: 'Список користувачів (admin — всі; staff — тільки з role фільтром)' })
  @Roles('staff', 'admin')
  @Get()
  findAll(
    @Query() query: QueryUsersDto,
    @CurrentUser('sub') requesterId: string,
    @CurrentUser('role') requesterRole: string,
  ) {
    if (requesterRole === 'staff' && !query.role) {
      throw new BadRequestException('Параметр role є обовʼязковим для staff');
    }
    return this.usersService.findAll(query, { id: requesterId, role: requesterRole });
  }

  @ApiOperation({ summary: 'Користувач за id (staff, admin)' })
  @Roles('staff', 'admin')
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser('sub') requesterId: string,
    @CurrentUser('role') requesterRole: string,
  ) {
    return this.usersService.findOne(id, { id: requesterId, role: requesterRole });
  }

  @ApiOperation({ summary: 'Історія верифікацій конкретного користувача (staff, admin)' })
  @Roles('staff', 'admin')
  @Get(':id/verification-history')
  getUserVerificationHistory(@Param('id') id: string) {
    return this.usersService.getVerificationHistory(id);
  }

  @ApiOperation({ summary: 'Підтвердити верифікацію (staff, admin)' })
  @Roles('staff', 'admin')
  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  approveVerification(
    @Param('id') id: string,
    @CurrentUser('sub') staffId: string,
  ) {
    return this.usersService.approveVerification(staffId, id);
  }

  @ApiOperation({ summary: 'Відхилити верифікацію (staff, admin)' })
  @Roles('staff', 'admin')
  @Post(':id/reject-identity')
  @HttpCode(HttpStatus.NO_CONTENT)
  rejectVerification(@Param('id') id: string, @CurrentUser('sub') staffId: string) {
    return this.usersService.rejectVerification(id, staffId);
  }

  @ApiOperation({ summary: 'Оновити користувача (admin)' })
  @Roles('admin')
  @Patch(':id')
  updateOne(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('sub') adminId: string,
  ) {
    return this.usersService.updateOne(id, dto, adminId);
  }

  @ApiOperation({ summary: 'Видалити користувача (admin)' })
  @Roles('admin')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
