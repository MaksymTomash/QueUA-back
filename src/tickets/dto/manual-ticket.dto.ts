import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ManualTicketDto {
  @ApiProperty()
  @IsString()
  window_id: string;

  @ApiProperty()
  @IsString()
  service_id: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  client_id?: string;
}
