import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('departments')
export class Department {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  address: string;

  @Column()
  city: string;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ type: 'float', nullable: true })
  latitude: number | null;

  @Column({ type: 'float', nullable: true })
  longitude: number | null;

  @Column({ type: 'jsonb', default: {} })
  working_hours: Record<string, string>;

  // Час початку «живої черги» (формат "HH:00"). До цього часу — лише попередній запис.
  // null = відділення працює лише за записом, без живої черги.
  @Column({ type: 'varchar', nullable: true })
  live_queue_from: string | null;

  @Column({ default: true })
  is_active: boolean;

  @Column({ type: 'varchar', nullable: true })
  leader_id: string | null;

  @Column({ type: 'float', default: 0 })
  rating: number;

  @CreateDateColumn()
  created_at: Date;
}
