import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class GoogleAuthDto {
  @ApiProperty({ description: 'Firebase ID Token отриманий після Google Sign-In' })
  @IsString()
  id_token: string;
}
