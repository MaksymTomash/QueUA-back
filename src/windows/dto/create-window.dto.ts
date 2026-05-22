import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateWindowDto {
  @ApiProperty()
  @IsString()
  department_id: string;

  @ApiProperty()
  @IsString()
  service_id: string;

  @ApiProperty({ example: 'Вікно 1' })
  @IsString()
  label: string;

  @ApiPropertyOptional({ example: '2026-05-22' })
  @IsOptional()
  @IsDateString()
  date?: string;
}
