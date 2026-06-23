import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AuditAction =
  | 'called'
  | 'client_identified'
  | 'serving_started'
  | 'completed'
  | 'missed'
  | 'redirected'
  | 'cancelled';

@Entity('ticket_audits')
export class TicketAudit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  ticket_id: string;

  @Column()
  staff_id: string;

  @Column({
    type: 'enum',
    enum: ['called', 'client_identified', 'serving_started', 'completed', 'missed', 'redirected', 'cancelled'],
  })
  action: AuditAction;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', nullable: true })
  service_result: string | null;

  @Column({ type: 'integer', nullable: true })
  duration_seconds: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
