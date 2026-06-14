import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class SubmitIdentityDto {
  @IsString()
  @Length(10, 10)
  @Matches(/^\d{10}$/, { message: 'ІПН має містити рівно 10 цифр' })
  tax_id: string;

  @IsString()
  @Length(5, 20)
  passport_number: string;

  @IsOptional()
  @IsString()
  document_photo_url?: string;
}
