import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString } from 'class-validator';

export class SlotsQueryDto {
  @ApiProperty({ example: 'uuid' })
  @IsString()
  department_id: string;

  @ApiProperty({ example: 'uuid' })
  @IsString()
  service_id: string;

  @ApiProperty({ example: '2026-05-23' })
  @IsDateString()
  date: string;
}
