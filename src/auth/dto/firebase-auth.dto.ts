import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class FirebaseAuthDto {
  @ApiProperty({ description: 'Firebase ID Token' })
  @IsString()
  id_token: string;

  @ApiPropertyOptional({ description: "Ім'я (для першої реєстрації через email)" })
  @IsOptional()
  @IsString()
  first_name?: string;

  @ApiPropertyOptional({ description: 'Прізвище (для першої реєстрації через email)' })
  @IsOptional()
  @IsString()
  last_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  middle_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;
}
