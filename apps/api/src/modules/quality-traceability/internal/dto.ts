import { ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateInspectionDto {
  @IsUUID() lotId: string;
  @IsIn(['SAMPLE', 'FULL']) scope: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  // Conflict-control path (§12): ops override approval when inspector == supplier org.
  @IsOptional() @IsString() @MaxLength(300) conflictOverrideReason?: string;
}

export class GradeResultDto {
  @IsUUID() gradeProfileId: string;
  @IsObject() measurements: Record<string, unknown>;
}

export class DefectDto {
  @IsOptional() @IsUUID() defectTypeId?: string;
  @IsOptional() @IsNumber() @Min(0) qty?: number;
  @IsOptional() @IsIn(['MINOR', 'MAJOR', 'CRITICAL']) severity?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class CompleteInspectionDto {
  @IsNumber() @Min(0) acceptedQty: number;
  @IsNumber() @Min(0) rejectedQty: number;
  @IsNumber() @Min(0) heldQty: number;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => GradeResultDto) gradeResults: GradeResultDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DefectDto) defects?: DefectDto[];
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) mediaObjectIds?: string[];
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class CustodyEventDto {
  @IsUUID() lotId: string;
  @IsOptional() @IsUUID() orderId?: string;
  @IsOptional() @IsUUID() shipmentId?: string;
  @IsString() @IsNotEmpty() eventType: string;
  @IsOptional() @IsUUID() toOrgId?: string;
  @IsOptional() @IsString() @MaxLength(200) locationText?: string;
  @IsOptional() @IsString() @MaxLength(300) conditionNote?: string;
  @IsOptional() @IsNumber() temperatureC?: number;
  @IsOptional() @IsUUID() mediaObjectId?: string;
}

export class QueueQueryDto {
  @IsOptional() @IsInt() @Min(1) limit?: number;
  @IsOptional() @IsISO8601() since?: string;
}
