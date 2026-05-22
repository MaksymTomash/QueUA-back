import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ManualTicketDto {
  @ApiProperty()
  @IsString()
  window_id: string;

  @ApiProperty()
  @IsString()
  service_id: string;
}
