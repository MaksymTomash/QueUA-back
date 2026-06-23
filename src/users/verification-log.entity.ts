import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

export type VerificationEventType = 'submitted' | 'approved' | 'rejected' | 'revoked';

@Entity('verification_logs')
export class VerificationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'enum', enum: ['submitted', 'approved', 'rejected', 'revoked'] })
  event_type: VerificationEventType;

  @Column({ type: 'varchar', nullable: true })
  tax_id: string | null;

  @Column({ type: 'varchar', nullable: true })
  passport_number: string | null;

  @Column({ type: 'varchar', nullable: true })
  document_photo_url: string | null;

  @Column({ type: 'varchar', nullable: true })
  processed_by_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'processed_by_id' })
  processed_by: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
