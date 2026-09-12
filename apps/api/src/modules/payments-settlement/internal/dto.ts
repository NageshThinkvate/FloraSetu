import {
  IsArray, IsIn, IsISO8601, IsNotEmpty, IsNumber,
  IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min
} from 'class-validator';

export const PAYMENT_METHODS = ['BANK_TRANSFER', 'UPI', 'NEFT', 'RTGS', 'IMPS', 'OTHER_APPROVED_EXTERNAL'] as const;

// §22: manual record of an ACTUAL external payment. Not escrow. No auto success.
export class RecordPaymentDto {
  @IsUUID() orderId: string;
  @IsNumber() @IsPositive() amountMinor: number;
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsIn(PAYMENT_METHODS) method: string;
  @IsString() @IsNotEmpty() @MaxLength(120) externalRef: string; // UTR / reference
  @IsISO8601() paidAt: string;
  @IsOptional() @IsUUID() evidenceMediaId?: string;
}

export class RecordSettlementDto {
  @IsUUID() orderId: string;
  @IsUUID() supplierOrgId: string;
  @IsNumber() @IsPositive() grossMinor: number;
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsOptional() @IsArray() deductions?: { label: string; amountMinor: number }[];
  @IsOptional() @IsNumber() @Min(0) claimAdjustmentMinor?: number;
  @IsOptional() @IsString() @MaxLength(120) payoutRef?: string;
  @IsOptional() @IsISO8601() payoutDate?: string;
}

export class AdjustmentDto {
  @IsIn(['CREDIT', 'DEBIT']) direction: string;
  @IsNumber() @IsPositive() amountMinor: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
  @IsOptional() @IsUUID() claimId?: string;
}

export class VerifyDto {
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
