import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, ValidateIf } from 'class-validator';

export class ReviewVerificationDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsEnum(['approved', 'rejected'])
  status: 'approved' | 'rejected';

  @ApiPropertyOptional()
  @ValidateIf((o) => o.status === 'rejected')
  @IsString()
  rejection_reason?: string;

  @ApiPropertyOptional({ description: 'Номер паспорту або ID-картки — записується в профіль при схваленні' })
  @IsOptional()
  @IsString()
  passport_number?: string;

  @ApiPropertyOptional({ description: 'ІПН (РНОКПП) — записується в профіль при схваленні' })
  @IsOptional()
  @IsString()
  tax_id?: string;
}
