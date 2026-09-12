import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { IsBase64, IsIn, IsNotEmpty, IsString } from 'class-validator';
import { MediaService } from './media.service';
import { RbacGuard } from '../authz/rbac.guard';
import { RequestContext } from '../request-context';
import { ApiException } from '../errors/error-envelope';

class UploadMediaDto {
  @IsString() @IsNotEmpty() contentType: string;
  @IsString() @IsBase64() dataBase64: string;
  @IsString() @IsIn(['pilot', 'kyb', 'claim']) bucket: string;
}

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  // Authenticated org-scoped upload (pilot photos: lot/QC/POD/claim/payment evidence).
  @Post()
  @UseGuards(RbacGuard)
  async upload(@Body() dto: UploadMediaDto) {
    const ctx = RequestContext.get();
    if (!ctx.orgId) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'X-Org-Id header required');
    }
    const stored = await this.media.store(ctx.orgId, dto.contentType, dto.dataBase64, dto.bucket);
    return stored;
  }

  // Signed-URL read: no session required, short-lived HMAC proof only (§8/§9 privacy).
  @Get('raw/:key')
  async raw(
    @Param('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response
  ) {
    if (!this.media.verifySignature(key, Number(exp), String(sig ?? ''))) {
      throw new ApiException(404, 'NOT_FOUND', 'Media not found');
    }
    const { contentType, bytes } = await this.media.readRaw(key);
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'private, max-age=60');
    res.send(bytes);
  }
}
