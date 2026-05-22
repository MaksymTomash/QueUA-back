import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('queue_counters')
@Unique(['department_id', 'service_id'])
export class QueueCounter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  department_id: string;

  @Column()
  service_id: string;

  // Атомарно інкрементується при кожному бронюванні
  @Column({ default: 1 })
  next_number: number;
}
