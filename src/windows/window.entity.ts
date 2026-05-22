import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Department } from '../departments/department.entity';
import { QueueService } from '../services/service.entity';

export type WindowStatus = 'open' | 'paused' | 'closed';

@Entity('windows')
export class Window {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  department_id: string;

  @ManyToOne(() => Department, { onDelete: 'CASCADE' })
  department: Department;

  @Column()
  service_id: string;

  @ManyToOne(() => QueueService, { onDelete: 'CASCADE' })
  service: QueueService;

  @Column({ type: 'varchar', nullable: true })
  staff_id: string | null;

  @Column()
  label: string;

  @Column({ type: 'enum', enum: ['open', 'paused', 'closed'], default: 'open' })
  status: WindowStatus;

  // Номер талону який зараз обслуговується (специфічний для цього вікна)
  @Column({ default: 0 })
  current_number: number;

  @Column({ type: 'date' })
  date: string;

  @CreateDateColumn()
  created_at: Date;
}
