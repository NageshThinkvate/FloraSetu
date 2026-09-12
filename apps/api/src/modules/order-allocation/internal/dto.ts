import {
  ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional,
  IsPositive, IsString, IsUUID, MaxLength, Min
} from 'class-validator';

export class ConvertAwardDto {
  @IsUUID() awardId: string;
}

export class TransitionOrderDto {
  @IsString() @IsNotEmpty() to: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class AllocateLotDto {
  @IsUUID() supplierAllocationLineId: string;
  @IsUUID() lotId: string;
  @IsNumber() @IsPositive() qty: number;
}

export class ShortfallDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class AcceptDeliveryDto {
  @IsNumber() @Min(0) acceptedQty: number;
  @IsOptional() @IsNumber() @Min(0) disputedQty?: number;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class SupplierConfirmDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class IdemListDto {
  @IsOptional() @IsArray() @ArrayMinSize(1) @IsUUID(undefined, { each: true }) ids?: string[];
  @IsOptional() @IsInt() @Min(1) limit?: number;
  @IsOptional() @IsIn(['ASC', 'DESC']) order?: 'ASC' | 'DESC';
}
