import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Window } from '../windows/window.entity';
import { Department } from '../departments/department.entity';
import { QueueService } from '../services/service.entity';

export type TicketStatus =
  | 'waiting'
  | 'called'
  | 'serving'
  | 'completed'
  | 'missed'
  | 'cancelled';

@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // null до моменту виклику — талон у загальній черзі послуги
  @Column({ type: 'varchar', nullable: true })
  window_id: string | null;

  @ManyToOne(() => Window, { onDelete: 'SET NULL', nullable: true })
  window: Window | null;

  @Column({ default: '' })
  client_id: string;

  @Column({ type: 'varchar', nullable: true })
  staff_id: string | null;

  @Column()
  service_id: string;

  @ManyToOne(() => QueueService)
  service: QueueService;

  @Column()
  department_id: string;

  @ManyToOne(() => Department)
  department: Department;

  @Column()
  ticket_number: number;

  @Column({ length: 3 })
  prefix: string;

  @Column({
    type: 'enum',
    enum: ['waiting', 'called', 'serving', 'completed', 'missed', 'cancelled'],
    default: 'waiting',
  })
  status: TicketStatus;

  @Column({ type: 'date', nullable: true })
  scheduled_date: string | null;

  @Column({ type: 'varchar', nullable: true })
  time_slot: string | null;

  @Column({ type: 'varchar', nullable: true })
  nfc_token: string | null;

  @Column({ default: false })
  is_missed_by_client: boolean;

  @CreateDateColumn()
  issued_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  called_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  estimated_start_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  estimated_end_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  serving_started_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelled_at: Date | null;

  @Column({ type: 'varchar', nullable: true })
  rating_by_client_id: string | null;

  @Column({ type: 'varchar', nullable: true })
  rating_by_staff_id: string | null;

  @Column({ type: 'float', nullable: true })
  client_rating: number | null;

  @Column({ type: 'text', nullable: true })
  client_comment: string | null;

  @Column({ type: 'varchar', nullable: true })
  client_rating_topic: string | null;

  @Column({ type: 'float', nullable: true })
  staff_rating: number | null;

  @Column({ type: 'varchar', nullable: true })
  staff_rating_topic: string | null;

  @Column({ type: 'text', nullable: true })
  staff_rating_comment: string | null;
}
