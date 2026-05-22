import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  first_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  last_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  middle_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\+?[\d\s\-()]{7,20}$/)
  phone?: string;

  @ApiPropertyOptional({ enum: ['citizen', 'staff', 'admin'] })
  @IsOptional()
  @IsEnum(['citizen', 'staff', 'admin'])
  role?: 'citizen' | 'staff' | 'admin';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_verified?: boolean;
}
