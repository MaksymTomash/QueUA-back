import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class AssignStaffDto {
  @ApiProperty({ example: 'uuid' })
  @IsString()
  staff_id: string;

  @ApiProperty({ example: 'uuid' })
  @IsString()
  service_id: string;
}
