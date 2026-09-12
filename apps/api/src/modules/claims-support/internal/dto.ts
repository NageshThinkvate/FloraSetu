import {
  ArrayMinSize, IsArray, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString,
  IsUUID, MaxLength, Min
} from 'class-validator';

export const CLAIM_CATEGORIES = [
  'QUALITY_MISMATCH', 'GRADE_MISMATCH', 'SHORT_QUANTITY', 'DAMAGED',
  'WRONG_PRODUCT', 'LATE_DELIVERY', 'TEMPERATURE_EXCEPTION', 'OTHER'
] as const;

export class CreateClaimDto {
  @IsUUID() orderId: string;
  @IsIn(CLAIM_CATEGORIES) category: string;
  @IsString() @IsNotEmpty() @MaxLength(1000) description: string;
  @IsOptional() @IsNumber() @Min(0) disputedQty?: number;
  @IsOptional() @IsUUID() uomId?: string;
  // Evidence linkage: lot / QC / POD references stay attached (§20).
  @IsOptional() @IsUUID() lotId?: string;
  @IsOptional() @IsUUID() inspectionId?: string;
  @IsOptional() @IsUUID() podId?: string;
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) mediaObjectIds?: string[];
}

export class RespondClaimDto {
  @IsString() @IsNotEmpty() @MaxLength(1000) response: string;
}

export class ClaimTransitionDto {
  @IsIn(['EVIDENCE_VALIDATION', 'UNDER_REVIEW', 'PROPOSED_RESOLUTION', 'APPROVED',
    'FINANCIAL_ADJUSTMENT', 'REPLACEMENT', 'CLOSED', 'REJECTED']) to: string;
  @IsOptional() @IsString() @MaxLength(1000) resolutionNote?: string;
  @IsOptional() @IsNumber() @Min(0) adjustmentMinor?: number;
}

export class AddEvidenceDto {
  @IsUUID() mediaObjectId: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsUUID() lotId?: string;
  @IsOptional() @IsUUID() inspectionId?: string;
  @IsOptional() @IsUUID() podId?: string;
}

export class ListClaimsDto {
  @IsOptional() @IsArray() @ArrayMinSize(1) @IsString({ each: true }) statuses?: string[];
}
