import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass123' })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 'Іван' })
  @IsString()
  first_name: string;

  @ApiProperty({ example: 'Петренко' })
  @IsString()
  last_name: string;

  @ApiPropertyOptional({ example: 'Олексійович' })
  @IsOptional()
  @IsString()
  middle_name?: string;

  @ApiPropertyOptional({ example: '+380501234567' })
  @IsOptional()
  @Matches(/^\+?[\d\s\-()]{7,20}$/)
  phone?: string;
}
