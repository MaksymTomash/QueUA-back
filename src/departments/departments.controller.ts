import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { QueryDepartmentsDto } from './dto/query-departments.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DepartmentServicesService } from '../department-services/department-services.service';
import { AddDepartmentServiceDto } from '../department-services/dto/add-department-service.dto';
import { StaffAssignmentsService } from '../staff-assignments/staff-assignments.service';
import { AssignStaffDto } from '../staff-assignments/dto/assign-staff.dto';

@ApiTags('Departments')
@Controller('departments')
export class DepartmentsController {
  constructor(
    private readonly departmentsService: DepartmentsService,
    private readonly deptServicesService: DepartmentServicesService,
    private readonly staffAssignments: StaffAssignmentsService,
  ) {}

  @ApiOperation({ summary: 'Список відділень (публічний)' })
  @Get()
  findAll(@Query() query: QueryDepartmentsDto) {
    return this.departmentsService.findAll(query);
  }

  @ApiOperation({ summary: 'Відділення за id (публічний)' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.departmentsService.findOne(id);
  }

  @ApiOperation({ summary: 'Створити відділення (admin)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateDepartmentDto) {
    return this.departmentsService.create(dto);
  }

  @ApiOperation({ summary: 'Оновити відділення (admin — повністю; керівник — лише операційні поля)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() user: { sub: string; role: string },
  ) {
    return this.departmentsService.updateForUser(id, dto, user);
  }

  @ApiOperation({ summary: 'Видалити відділення (admin)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.departmentsService.remove(id);
  }

  // ─── Послуги відділення ───────────────────────────────────────────────────

  @ApiOperation({ summary: 'Послуги відділення (публічний)' })
  @Get(':id/services')
  getDepartmentServices(@Param('id') id: string) {
    return this.deptServicesService.findByDepartment(id);
  }

  @ApiOperation({ summary: 'Додати послугу до відділення (admin, керівник відділення)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  @Post(':id/services')
  @HttpCode(HttpStatus.CREATED)
  async addService(
    @Param('id') id: string,
    @Body() dto: AddDepartmentServiceDto,
    @CurrentUser() user: { sub: string; role: string },
  ) {
    await this.departmentsService.assertCanManage(id, user);
    return this.deptServicesService.add(id, dto);
  }

  @ApiOperation({ summary: 'Прибрати послугу з відділення (admin, керівник відділення)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  @Delete(':id/services/:serviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeService(
    @Param('id') id: string,
    @Param('serviceId') serviceId: string,
    @CurrentUser() user: { sub: string; role: string },
  ) {
    await this.departmentsService.assertCanManage(id, user);
    return this.deptServicesService.remove(id, serviceId);
  }

  // ─── Персонал відділення ──────────────────────────────────────────────────

  @ApiOperation({ summary: 'Персонал відділення (admin, staff)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  @Get(':id/staff')
  getDepartmentStaff(@Param('id') id: string) {
    return this.staffAssignments.findByDepartment(id);
  }

  @ApiOperation({ summary: 'Призначити спеціаліста до відділення (admin, керівник відділення)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  @Post(':id/staff')
  @HttpCode(HttpStatus.CREATED)
  async assignStaff(
    @Param('id') id: string,
    @Body() dto: AssignStaffDto,
    @CurrentUser() user: { sub: string; role: string },
  ) {
    await this.departmentsService.assertCanManage(id, user);
    return this.staffAssignments.assign(id, dto);
  }

  @ApiOperation({ summary: 'Зняти спеціаліста з відділення (admin, керівник відділення)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  @Delete(':id/staff/:staffId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeStaff(
    @Param('id') id: string,
    @Param('staffId') staffId: string,
    @CurrentUser() user: { sub: string; role: string },
  ) {
    await this.departmentsService.assertCanManage(id, user);
    return this.staffAssignments.remove(id, staffId);
  }

  @ApiOperation({ summary: 'Зняти одну послугу у спеціаліста (admin, керівник відділення)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  @Delete(':id/staff/:staffId/services/:serviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeStaffService(
    @Param('id') id: string,
    @Param('staffId') staffId: string,
    @Param('serviceId') serviceId: string,
    @CurrentUser() user: { sub: string; role: string },
  ) {
    await this.departmentsService.assertCanManage(id, user);
    return this.staffAssignments.removeOne(id, staffId, serviceId);
  }
}
