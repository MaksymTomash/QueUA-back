import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateVerificationDto {
  @ApiProperty({ enum: ['online', 'in_person'] })
  @IsEnum(['online', 'in_person'])
  method: 'online' | 'in_person';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  document_type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  document_number?: string;

}
