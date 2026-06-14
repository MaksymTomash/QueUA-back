import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { VerificationsService } from './verifications.service';
import { CreateVerificationDto } from './dto/create-verification.dto';
import { ReviewVerificationDto } from './dto/review-verification.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

@ApiTags('Verifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('verifications')
export class VerificationsController {
  constructor(private readonly verificationsService: VerificationsService) {}

  @ApiOperation({ summary: 'Моя верифікація (citizen)' })
  @Roles('citizen')
  @Get('me')
  findMine(@CurrentUser('sub') userId: string) {
    return this.verificationsService.findMine(userId);
  }

  @ApiOperation({ summary: 'Подати документи з фото (citizen)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['online', 'in_person'] },
        document_type: { type: 'string' },
        document_number: { type: 'string' },
        photo: { type: 'string', format: 'binary' },
      },
      required: ['method'],
    },
  })
  @Roles('citizen')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME.includes(file.mimetype))
          return cb(new BadRequestException('Дозволено лише JPEG, PNG, WebP'), false);
        cb(null, true);
      },
      limits: { fileSize: MAX_SIZE_BYTES },
    }),
  )
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateVerificationDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.verificationsService.create(userId, dto, file);
  }

  @ApiOperation({ summary: 'Фото документа верифікації' })
  @Roles('citizen', 'staff', 'admin')
  @Get(':id/photo')
  async getPhoto(@Param('id') id: string, @Res() res: Response) {
    const { data, mime } = await this.verificationsService.getPhoto(id);
    res.set('Content-Type', mime);
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(data);
  }

  @ApiOperation({ summary: 'Список верифікацій (staff, admin)' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'approved', 'rejected'] })
  @Roles('staff', 'admin')
  @Get()
  findAll(@Query('status') status?: string) {
    return this.verificationsService.findAll(status);
  }

  @ApiOperation({ summary: 'Схвалити/відхилити (staff, admin)' })
  @Roles('staff', 'admin')
  @Patch(':id')
  review(
    @Param('id') id: string,
    @CurrentUser('sub') staffId: string,
    @Body() dto: ReviewVerificationDto,
  ) {
    return this.verificationsService.review(id, staffId, dto);
  }
}
