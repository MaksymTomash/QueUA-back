import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class BookTicketDto {
  @ApiProperty()
  @IsString()
  department_id: string;

  @ApiProperty()
  @IsString()
  service_id: string;

  @ApiPropertyOptional({ example: '2026-05-25', description: 'Дата відвідування. Якщо не вказана — сьогодні (жива черга)' })
  @IsOptional()
  @IsDateString()
  scheduled_date?: string;

  @ApiPropertyOptional({ example: '10:00', description: 'Бажаний часовий слот (HH:00). Якщо не вказано — поточний слот (жива черга)' })
  @IsOptional()
  @IsString()
  time_slot?: string;
}
