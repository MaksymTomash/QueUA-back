import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

export class AddDepartmentServiceDto {
  @ApiProperty()
  @IsString()
  @IsUUID()
  service_id: string;
}
