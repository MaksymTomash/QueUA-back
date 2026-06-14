import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches } from 'class-validator';

export class IdentifyClientDto {
  // Привʼязати до існуючого акаунта відвідувача
  @ApiPropertyOptional({ description: 'Id існуючого акаунта відвідувача' })
  @IsOptional()
  @IsString()
  client_id?: string;

  // Або створити новий акаунт відвідувача (заповнюються дані з документів)
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
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\+?[\d\s\-()]{7,20}$/)
  phone?: string;

  @ApiPropertyOptional({ description: 'ІПН' })
  @IsOptional()
  @IsString()
  tax_id?: string;

  @ApiPropertyOptional({ description: 'Номер паспорта' })
  @IsOptional()
  @IsString()
  passport_number?: string;
}
