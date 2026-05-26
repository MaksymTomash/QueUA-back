import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class QueryUsersDto {
  @ApiPropertyOptional({ enum: ['citizen', 'staff', 'admin'] })
  @IsOptional()
  @IsEnum(['citizen', 'staff', 'admin'])
  role?: 'citizen' | 'staff' | 'admin';

  @ApiPropertyOptional({ example: 'Іваненко' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page_size?: number = 20;
}
