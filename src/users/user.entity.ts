import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RefreshToken } from '../auth/refresh-token.entity';

export type UserRole = 'citizen' | 'staff' | 'admin';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password_hash: string;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column()
  first_name: string;

  @Column()
  last_name: string;

  @Column({ type: 'varchar', nullable: true })
  middle_name: string | null;

  @Column({ type: 'enum', enum: ['citizen', 'staff', 'admin'], default: 'citizen' })
  role: UserRole;

  @Column({ default: false })
  is_verified: boolean;

  @Column({ type: 'float', default: 0 })
  discipline_score: number;

  @Column({ type: 'float', default: 0 })
  attendance_rate: number;

  @Column({ default: 0 })
  current_streak: number;

  @Column({ type: 'varchar', nullable: true })
  avatar_url: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => RefreshToken, (token) => token.user)
  refresh_tokens: RefreshToken[];
}
