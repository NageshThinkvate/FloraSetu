import {
  IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsNumber, IsOptional,
  IsPositive, IsString, IsUUID, MaxLength, Min
} from 'class-validator';

export const TRANSPORT_MODES = [
  'BUS_PARCEL', 'RAIL_PARCEL', 'AIR_CARGO', 'NORMAL_ROAD',
  'INSULATED_ROAD', 'REEFER_ROAD', 'LOCAL_PICKUP', 'SPECIAL_EXPRESS'
] as const;

export class CreatePackDto {
  @IsUUID() orderId: string;
  @IsUUID() supplierAllocationLineId: string;
  @IsUUID() lotId: string;
  @IsNumber() @IsPositive() packedQty: number;
  @IsUUID() uomId: string;
  @IsOptional() @IsString() @MaxLength(60) packType?: string;
  @IsOptional() @IsInt() @Min(0) bunchCount?: number;
  @IsOptional() @IsInt() @Min(0) cartonCount?: number;
  @IsOptional() @IsString() @MaxLength(120) labelRef?: string;
  @IsOptional() @IsString() @MaxLength(120) sealRef?: string;
  @IsOptional() @IsString() @MaxLength(300) storageConditionNote?: string;
}

export class CreateShipmentDto {
  @IsUUID() orderId: string;
  @IsIn(TRANSPORT_MODES) mode: string;
  @IsBoolean() tempControlled: boolean; // explicit YES/NO — never inferred (§17)
  @IsOptional() @IsString() @MaxLength(120) carrierName?: string;
  @IsOptional() @IsString() @MaxLength(200) originText?: string;
  @IsOptional() @IsString() @MaxLength(200) destinationText?: string;
  @IsOptional() @IsString() @MaxLength(120) originTerminal?: string;
  @IsOptional() @IsString() @MaxLength(120) destinationTerminal?: string;
  @IsOptional() @IsString() @MaxLength(120) transportRef?: string;  // bus/train/flight/vehicle
  @IsOptional() @IsString() @MaxLength(120) parcelAwbRef?: string;
  @IsOptional() @IsInt() @Min(0) packageCount?: number;
  @IsOptional() @IsISO8601() pickupAt?: string;
  @IsOptional() @IsISO8601() etd?: string;
  @IsOptional() @IsISO8601() eta?: string;
  @IsOptional() @IsString() @MaxLength(300) lastMileDetail?: string;
  @IsOptional() @IsString() @MaxLength(300) handlingNote?: string;
}

export class PodDto {
  @IsNumber() @Min(0) deliveredQty: number;
  @IsOptional() @IsUUID() uomId?: string;
  @IsOptional() @IsString() @MaxLength(120) receiverName?: string;
  @IsOptional() @IsUUID() mediaObjectId?: string;
  @IsOptional() @IsString() @MaxLength(120) signatureRef?: string;
  @IsOptional() @IsUUID() signatureMediaObjectId?: string;
  @IsOptional() @IsString() @MaxLength(120) podRef?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsBoolean() shortageFlag?: boolean;
  @IsOptional() @IsBoolean() damageFlag?: boolean;
  @IsOptional() @IsString() @MaxLength(500) exceptionNote?: string;
}

export class TemperatureExceptionDto {
  @IsIn(['WARNING', 'CRITICAL']) severity: string;
  @IsNumber() celsius: number;
  @IsISO8601() occurredAt: string;
  @IsOptional() @IsInt() @Min(0) durationSeconds?: number;
  @IsOptional() @IsString() @MaxLength(300) actionTaken?: string;
  @IsOptional() @IsUUID() handlingProfileId?: string;
}

export class ResolveExceptionDto {
  @IsString() @IsNotEmpty() @MaxLength(500) resolution: string;
}

// B4 (ADR-011): logistics partner job DTOs.
export class AssignJobDto {
  @IsUUID() logisticsOrgId: string;
  @IsOptional() @IsUUID() driverUserId?: string;
}

export class ConfirmPickupDto {
  @IsOptional() @IsString() @MaxLength(120) awbRef?: string;
  @IsOptional() @IsString() @MaxLength(120) transportRef?: string;
  @IsOptional() @IsUUID() mediaObjectId?: string;
}

export class ReportLogisticsExceptionDto {
  @IsIn(['PICKUP_DELAY', 'VEHICLE_BREAKDOWN', 'MISSED_DEPARTURE', 'PARCEL_REJECTED',
    'DAMAGE_OBSERVED', 'TEMPERATURE_CONCERN', 'ADDRESS_ISSUE', 'RECIPIENT_UNAVAILABLE', 'OTHER'])
  type: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsUUID() mediaObjectId?: string;
}

// ADR-012: partner-controlled driver assignment (own-org members only).
export class AssignDriverDto {
  @IsUUID() driverUserId: string;
  @IsOptional() @IsString() @MaxLength(120) vehicleRef?: string;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class UnassignDriverDto {
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
