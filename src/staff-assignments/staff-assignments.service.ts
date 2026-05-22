import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StaffAssignment } from './staff-assignment.entity';
import { AssignStaffDto } from './dto/assign-staff.dto';

@Injectable()
export class StaffAssignmentsService {
  constructor(
    @InjectRepository(StaffAssignment)
    private readonly repo: Repository<StaffAssignment>,
  ) {}

  findByDepartment(departmentId: string) {
    return this.repo
      .createQueryBuilder('sa')
      .leftJoinAndSelect('sa.staff', 'staff')
      .leftJoinAndSelect('sa.service', 'service')
      .where('sa.department_id = :departmentId', { departmentId })
      .getMany();
  }

  async assign(departmentId: string, dto: AssignStaffDto) {
    const exists = await this.repo.findOneBy({
      department_id: departmentId,
      service_id: dto.service_id,
      staff_id: dto.staff_id,
    });
    if (exists) throw new BadRequestException('Спеціаліст вже призначений до цього відділення');

    const assignment = this.repo.create({
      department_id: departmentId,
      service_id: dto.service_id,
      staff_id: dto.staff_id,
    });
    return this.repo.save(assignment);
  }

  async remove(departmentId: string, staffId: string) {
    const assignment = await this.repo.findOneBy({ department_id: departmentId, staff_id: staffId });
    if (!assignment) throw new NotFoundException('Призначення не знайдено');
    await this.repo.remove(assignment);
  }

  isAssigned(departmentId: string, staffId: string): Promise<boolean> {
    return this.repo.exists({ where: { department_id: departmentId, staff_id: staffId } });
  }
}
