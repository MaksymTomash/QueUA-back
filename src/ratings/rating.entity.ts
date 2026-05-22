import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type RatingType = 'client' | 'staff';

@Entity('ratings')
export class Rating {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  ticket_id: string;

  @Column()
  staff_id: string;

  @Column()
  citizen_id: string;

  // 'client' = громадянин оцінює спеціаліста
  // 'staff'  = спеціаліст оцінює громадянина
  @Column({ type: 'enum', enum: ['client', 'staff'] })
  type: RatingType;

  @Column({ type: 'smallint' })
  score: number;

  @Column({ type: 'varchar', nullable: true })
  topic: string | null;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn()
  created_at: Date;
}
