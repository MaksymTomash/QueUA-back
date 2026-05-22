import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('services')
export class QueueService {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ default: false })
  requires_verification: boolean;

  @Column({ default: 15 })
  estimated_duration_minutes: number;

  @Column({ default: true })
  is_active: boolean;

  @Column({ length: 3 })
  ticket_prefix: string;
}
