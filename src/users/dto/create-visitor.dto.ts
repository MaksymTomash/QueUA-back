import { IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';

export class CreateVisitorDto {
  @IsString()
  @MinLength(2)
  first_name: string;

  @IsString()
  @MinLength(2)
  last_name: string;

  @IsOptional()
  @IsString()
  middle_name?: string;

  @IsOptional()
  @IsString()
  @Length(10, 10)
  @Matches(/^\d{10}$/, { message: 'ІПН має містити рівно 10 цифр' })
  tax_id?: string;

  @IsOptional()
  @IsString()
  @Length(5, 20)
  passport_number?: string;
}
