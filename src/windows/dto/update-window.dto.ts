import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateWindowDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  service_id?: string;

  @ApiPropertyOptional({ example: 'Вікно 1' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ nullable: true, description: 'id співробітника або null, щоб зняти призначення' })
  @IsOptional()
  @IsString()
  staff_id?: string | null;
}
