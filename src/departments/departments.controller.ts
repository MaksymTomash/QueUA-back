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

  @ApiOperation({ summary: 'Оновити відділення (admin)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    return this.departmentsService.update(id, dto);
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

  @ApiOperation({ summary: 'Додати послугу до відділення (admin)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post(':id/services')
  @HttpCode(HttpStatus.CREATED)
  addService(@Param('id') id: string, @Body() dto: AddDepartmentServiceDto) {
    return this.deptServicesService.add(id, dto);
  }

  @ApiOperation({ summary: 'Прибрати послугу з відділення (admin)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete(':id/services/:serviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeService(@Param('id') id: string, @Param('serviceId') serviceId: string) {
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

  @ApiOperation({ summary: 'Призначити спеціаліста до відділення (admin)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post(':id/staff')
  @HttpCode(HttpStatus.CREATED)
  assignStaff(@Param('id') id: string, @Body() dto: AssignStaffDto) {
    return this.staffAssignments.assign(id, dto);
  }

  @ApiOperation({ summary: 'Зняти спеціаліста з відділення (admin)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete(':id/staff/:staffId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeStaff(@Param('id') id: string, @Param('staffId') staffId: string) {
    return this.staffAssignments.remove(id, staffId);
  }
}
