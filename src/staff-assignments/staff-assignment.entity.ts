import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Department } from '../departments/department.entity';
import { QueueService } from '../services/service.entity';
import { User } from '../users/user.entity';

@Entity('staff_assignments')
@Unique(['department_id', 'service_id', 'staff_id'])
export class StaffAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  department_id: string;

  @ManyToOne(() => Department)
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @Column()
  service_id: string;

  @ManyToOne(() => QueueService)
  @JoinColumn({ name: 'service_id' })
  service: QueueService;

  @Column()
  staff_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'staff_id' })
  staff: User;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
