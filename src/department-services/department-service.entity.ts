import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Department } from '../departments/department.entity';
import { QueueService } from '../services/service.entity';

@Entity('department_services')
@Unique(['department_id', 'service_id'])
export class DepartmentService {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  department_id: string;

  @ManyToOne(() => Department, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @Column()
  service_id: string;

  @ManyToOne(() => QueueService, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_id' })
  service: QueueService;

  @Column({ default: true })
  is_active: boolean;
}
