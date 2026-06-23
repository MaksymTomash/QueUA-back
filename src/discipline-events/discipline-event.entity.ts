import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type DisciplineEventType =
  | 'missed_ticket'
  | 'completed_ticket'
  | 'rating_received'
  | 'streak_achieved';

@Entity('discipline_events')
export class DisciplineEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @Column({
    type: 'enum',
    enum: ['missed_ticket', 'completed_ticket', 'rating_received', 'streak_achieved'],
  })
  event_type: DisciplineEventType;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  impact: number;

  @Column({ type: 'varchar', nullable: true })
  ticket_id: string | null;

  @Column({ type: 'varchar', nullable: true })
  rating_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
