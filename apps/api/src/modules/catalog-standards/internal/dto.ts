import {
  ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsNumber,
  IsOptional, IsPositive, IsString, IsUUID, Matches, Max, Min, ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCategoryDto {
  @IsString() @IsNotEmpty() @Matches(/^[A-Z0-9_]+$/) code: string;
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsUUID() parentId?: string;
}

export class CreateProductDto {
  @IsUUID() categoryId: string;
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() botanicalName?: string;
  @IsOptional() @IsString() commonName?: string;
  @IsOptional() @IsString() commercialName?: string;
  @IsOptional() @IsUUID() defaultUomId?: string;
  @IsOptional() @IsArray() @IsInt({ each: true }) @ArrayMinSize(1) seasonalityMonths?: number[];
}

export class CreateAliasDto {
  @IsUUID() commodityId: string;
  @IsString() @IsNotEmpty() alias: string;
  @IsIn(['BOTANICAL', 'COMMON', 'COMMERCIAL', 'SYNONYM']) aliasType: string;
}

export class CreateColourDto {
  @IsString() @IsNotEmpty() @Matches(/^[A-Z0-9_]+$/) code: string;
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() hex?: string;
}

export class CreateVarietyDto {
  @IsUUID() commodityId: string;
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsUUID() colourId?: string;
  @IsOptional() @IsString() productForm?: string;
  @IsOptional() @IsNumber() @Min(0) stemLengthCmMin?: number;
  @IsOptional() @IsNumber() @Min(0) stemLengthCmMax?: number;
}

export class CreateUomDto {
  @IsString() @IsNotEmpty() @Matches(/^[A-Z_]+$/) code: string;
  @IsString() @IsNotEmpty() name: string;
}

export class CreateConversionDto {
  @IsOptional() @IsUUID() commodityId?: string;
  @IsOptional() @IsUUID() packDefinitionId?: string;
  @IsUUID() fromUomId: string;
  @IsUUID() toUomId: string;
  @IsNumber() @IsPositive() factor: number;
  @IsISO8601() effectiveFrom: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsString() changeReason?: string;
  @IsOptional() @IsBoolean() activate?: boolean;
}

export class CreatePackDto {
  @IsOptional() @IsUUID() commodityId?: string;
  @IsString() @IsNotEmpty() @Matches(/^[A-Z0-9_]+$/) code: string;
  @IsString() @IsNotEmpty() name: string;
  @IsIn(['UNIT', 'BUNCH', 'PACK', 'BOX', 'CARTON']) level: string;
  @IsNumber() @IsPositive() containsQty: number;
  @IsUUID() containsUomId: string;
  @IsOptional() @IsUUID() parentPackId?: string;
  @IsISO8601() effectiveFrom: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsString() changeReason?: string;
  @IsOptional() @IsBoolean() activate?: boolean;
}

export class GradeRuleDto {
  @IsString() @IsNotEmpty() attribute: string;
  @IsIn(['MIN', 'MAX', 'BETWEEN', 'EQ', 'IN']) op: string;
  @IsOptional() @IsNumber() min?: number;
  @IsOptional() @IsNumber() max?: number;
  @IsOptional() @IsString() value?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) values?: string[];
}

export class CreateGradeProfileDto {
  @IsUUID() commodityId: string;
  @IsString() @IsNotEmpty() gradeCode: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => GradeRuleDto) rules: GradeRuleDto[];
  @IsISO8601() effectiveFrom: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsString() changeReason?: string;
  @IsOptional() @IsBoolean() activate?: boolean;
  @IsOptional() @IsIn(['DEMO', 'VALIDATED']) dataClassification?: string;
}

export class CreateQualityAttributeDto {
  @IsString() @IsNotEmpty() @Matches(/^[a-z0-9_]+$/) code: string;
  @IsString() @IsNotEmpty() name: string;
  @IsIn(['NUMERIC', 'INTEGER', 'ENUM', 'BOOLEAN', 'TEXT']) dataType: string;
  @IsOptional() @IsUUID() uomId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) allowedValues?: string[];
  @IsOptional() @IsString() description?: string;
}

export class CreateDefectTypeDto {
  @IsString() @IsNotEmpty() @Matches(/^[a-z0-9_]+$/) code: string;
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() defectClass: string;
  @IsOptional() @IsString() description?: string;
}

export class CreateHandlingProfileDto {
  @IsOptional() @IsUUID() commodityId?: string;
  @IsString() @IsNotEmpty() @Matches(/^[A-Z0-9_]+$/) code: string;
  @IsOptional() @IsNumber() tempMinC?: number;
  @IsOptional() @IsNumber() tempMaxC?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) humidityMinPct?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) humidityMaxPct?: number;
  @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH']) lightSensitivity?: string;
  @IsOptional() @IsIn(['NONE', 'LOW', 'MEDIUM', 'HIGH']) ethyleneSensitivity?: string;
  @IsOptional() @IsString() hydrationNote?: string;
  @IsOptional() @IsInt() @Min(0) maxHoldingHours?: number;
  @IsOptional() @IsBoolean() precoolingRequired?: boolean;
  @IsOptional() @IsString() packagingRequirements?: string;
  @IsOptional() @IsString() orientationFragilityNotes?: string;
  @IsOptional() @IsString() transportRestrictions?: string;
  @IsOptional() @IsString() handlingGroupCode?: string;
  @IsISO8601() effectiveFrom: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsOptional() @IsString() changeReason?: string;
  @IsOptional() @IsBoolean() activate?: boolean;
  @IsIn(['DEMO', 'VALIDATED']) dataClassification: string;
}

export class CreateTransportRuleDto {
  @IsUUID() profileAId: string;
  @IsUUID() profileBId: string;
  @IsBoolean() compatible: boolean;
  @IsOptional() @IsString() reason?: string;
  @IsISO8601() effectiveFrom: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
}

export class LaunchFlagsDto {
  @IsBoolean() launchEnabled: boolean;
  @IsArray() @IsString({ each: true }) launchCities: string[];
}

export class CreateCapabilityDto {
  @IsUUID() varietyId: string;
  @IsOptional() @IsString() notes?: string;
}

export class StatusChangeDto {
  @IsIn(['ACTIVE', 'INACTIVE', 'RETIRED', 'DRAFT']) status: string;
  @IsOptional() @IsString() reason?: string;
}
