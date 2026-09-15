import { ArrayMinSize, IsArray, IsIn, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength } from 'class-validator';

export const ORIGIN_TYPES = [
  'OWN_FARM', 'PARTNER_FARM', 'WHOLESALE_STOCK', 'IMPORTER_STOCK', 'MARKET_PURCHASE', 'OTHER_APPROVED_SOURCE'
] as const;

export class LotCoreDto {
  @IsUUID() commodityId: string;
  @IsOptional() @IsUUID() varietyId?: string;
  @IsOptional() @IsUUID() gradeProfileId?: string;
  @IsOptional() @IsString() @MaxLength(40) colourCode?: string;
  @IsNumber() @IsPositive() declaredQty: number;
  @IsUUID() uomId: string;
  @IsIn(ORIGIN_TYPES) originType: string;
  @IsOptional() @IsString() @MaxLength(500) originDetail?: string;
}

export class CreateStockLotDto extends LotCoreDto {
  @IsISO8601() receivedAt: string;
}

export class CreateHarvestLotDto extends LotCoreDto {
  @IsISO8601() harvestedAt: string;
  @IsOptional() @IsString() @MaxLength(200) farmName?: string;
  @IsOptional() @IsString() @MaxLength(200) farmBlock?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class AddLotMediaDto {
  @IsUUID() mediaObjectId: string;
  @IsOptional() @IsIn(['LOT_PHOTO', 'LOT_ACTUAL', 'LOT_VIDEO', 'INSPECTION', 'PACKING', 'PACKED_LOT', 'POD', 'DISPATCH_EVIDENCE', 'RECEIPT_EVIDENCE', 'PICKUP_EVIDENCE', 'CLAIM_EVIDENCE', 'EXCEPTION_EVIDENCE', 'OTHER']) purpose?: string;
  @IsOptional() @IsUUID() inspectionId?: string;
}

// ADR-011: supplier-declaration submission (pilot quality basis — no fake QC).
export class SubmitDeclarationDto {
  @IsOptional() @IsUUID() declaredGradeProfileId?: string;
  @IsOptional() @IsNumber() @IsPositive() declaredStemLengthCm?: number;
  @IsOptional() @IsString() @MaxLength(60) bloomStage?: string;
  @IsOptional() @IsString() @MaxLength(120) batchRef?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class ResolveHoldDto {
  @IsNumber() toAvailableQty: number;
  @IsNumber() toRejectedQty: number;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ReserveDto {
  @IsArray() @ArrayMinSize(1) @IsUUID(undefined, { each: true }) ids?: string[];
}
