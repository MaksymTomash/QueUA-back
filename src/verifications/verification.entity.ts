import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export type VerificationStatus = 'pending' | 'approved' | 'rejected' | 'not_submitted';
export type VerificationMethod = 'online' | 'in_person';

@Entity('verifications')
export class Verification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({
    type: 'enum',
    enum: ['pending', 'approved', 'rejected', 'not_submitted'],
    default: 'pending',
  })
  status: VerificationStatus;

  @Column({ type: 'enum', enum: ['online', 'in_person'] })
  method: VerificationMethod;

  @Column({ type: 'varchar', nullable: true })
  document_type: string | null;

  @Column({ type: 'varchar', nullable: true })
  document_number: string | null;

  @Column({ type: 'bytea', nullable: true, select: false })
  document_photo: Buffer | null;

  @Column({ type: 'varchar', nullable: true })
  document_photo_mime: string | null;

  @Column({ type: 'varchar', nullable: true })
  verified_by: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  verified_at: Date | null;

  @Column({ type: 'varchar', nullable: true })
  rejection_reason: string | null;

  @CreateDateColumn()
  created_at: Date;
}
