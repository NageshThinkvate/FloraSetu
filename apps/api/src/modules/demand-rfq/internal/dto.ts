import {
  ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsNumber,
  IsObject, IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min, ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEventDto {
  @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @IsString() @IsNotEmpty() @MaxLength(60) eventType: string;
  @IsOptional() @IsISO8601() startsAt?: string;
  @IsOptional() @IsISO8601() endsAt?: string;
  @IsOptional() @IsString() venueName?: string;
  @IsOptional() @IsString() venueAddress?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateEventDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() eventType?: string;
  @IsOptional() @IsISO8601() startsAt?: string;
  @IsOptional() @IsISO8601() endsAt?: string;
  @IsOptional() @IsString() venueName?: string;
  @IsOptional() @IsString() venueAddress?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsIn(['DRAFT', 'PLANNING', 'CONFIRMED', 'COMPLETED', 'CANCELLED']) status?: string;
}

export class CreateCeremonyDto {
  @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @IsOptional() @IsISO8601() startsAt?: string;
  @IsOptional() @IsString() venueName?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsInt() @Min(1) sortOrder?: number;
}

export class CreateBomLineDto {
  @IsOptional() @IsUUID() ceremonyId?: string;
  @IsUUID() commodityId: string;
  @IsOptional() @IsUUID() varietyId?: string;
  @IsNumber() @IsPositive() quantity: number;
  @IsUUID() uomId: string;
  @IsOptional() @IsISO8601() neededAt?: string;
  @IsOptional() @IsString() deliveryMilestone?: string;
}

export class SubstitutionPolicyDto {
  @IsOptional() @IsBoolean() exactProductOnly?: boolean;
  @IsOptional() @IsBoolean() allowAlternateVariety?: boolean;
  @IsOptional() @IsBoolean() allowAlternateColour?: boolean;
  @IsOptional() @IsUUID() minGradeProfileId?: string;
  @IsOptional() @IsNumber() @Min(0) stemToleranceCm?: number;
  @IsOptional() @IsBoolean() allowPackVariation?: boolean;
}

export class RequirementLineDto {
  @IsOptional() @IsUUID() bomLineId?: string;
  @IsUUID() commodityId: string;
  @IsOptional() @IsUUID() varietyId?: string;
  @IsOptional() @IsString() colourCode?: string;
  @IsOptional() @IsUUID() gradeProfileId?: string;
  @IsOptional() @IsNumber() @Min(0) stemLengthCmMin?: number;
  @IsOptional() @IsNumber() @Min(0) stemLengthCmMax?: number;
  @IsOptional() @IsString() bloomStage?: string;
  @IsOptional() @IsUUID() packDefinitionId?: string;
  @IsNumber() @IsPositive() quantity: number;
  @IsOptional() @IsUUID() uomId?: string;  // OD-07: optional in DTO shape, REQUIRED by domain (UOM_REQUIRED)
  @IsISO8601() neededAt: string;
  @IsString() @IsNotEmpty() deliveryDestination: string;
  @IsOptional() @IsObject() substitutionPolicy?: SubstitutionPolicyDto;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() attachments?: string[];
}

export class CreateRequirementDto {
  @IsIn(['QUICK', 'EVENT', 'FORMAL']) mode: string;
  @IsString() @IsNotEmpty() @MaxLength(200) title: string;
  @IsOptional() @IsUUID() eventId?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => RequirementLineDto)
  lines: RequirementLineDto[];
  @IsOptional() @IsBoolean() assistanceRequested?: boolean;
}

export class ReviseRequirementDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => RequirementLineDto)
  lines: RequirementLineDto[];
  @IsString() @IsNotEmpty() changeReason: string;
}

export class CancelDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
}

export class PublishRfqDto {
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) supplierOrgIds?: string[];
  @IsOptional() @IsISO8601() quoteDeadline?: string;
  @IsOptional() @IsISO8601() clarificationDeadline?: string;
  @IsOptional() @IsString() commercialInstructions?: string;
  @IsOptional() @IsString() deliveryRequirements?: string;
}

export class DeclineInvitationDto {
  @IsString() @IsNotEmpty() @MaxLength(300) reason: string;
}

export class CreateClarificationDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) question: string;
  @IsOptional() @IsIn(['BUYER_PRIVATE', 'PUBLIC']) visibility?: string;
}

export class RespondClarificationDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) response: string;
  @IsOptional() @IsIn(['BUYER_PRIVATE', 'PUBLIC']) visibility?: string;
}

export class QuoteComponentDto {
  @IsIn(['KNOWN', 'UNKNOWN', 'BUYER_ARRANGED', 'SUPPLIER_ARRANGED', 'PLATFORM_QUOTE_PENDING']) state: string;
  @IsOptional() @IsInt() @Min(0) amountMinor?: number;
}

export class QuotationLineDto {
  @IsUUID() requirementLineId: string;
  @IsNumber() @IsPositive() quotedQty: number;
  @IsUUID() quotedUomId: string;
  @IsInt() @Min(0) unitPriceMinor: number;
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsOptional() @IsObject() components?: Record<string, QuoteComponentDto>;
  @IsOptional() @IsString() deviationNote?: string;
  @IsOptional() @IsBoolean() proposesSubstitution?: boolean;
  @IsOptional() @IsObject() substitutionDetail?: Record<string, unknown>;
}

export class SubmitQuotationDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => QuotationLineDto)
  lines: QuotationLineDto[];
  @IsISO8601() validTo: string;
  @IsOptional() @IsInt() @Min(0) leadTimeDays?: number;
  @IsOptional() @IsString() deliveryCommitment?: string;
  @IsOptional() @IsNumber() @IsPositive() moq?: number;
  @IsOptional() @IsBoolean() partialFulfilmentOffered?: boolean;
  @IsOptional() @IsString() commercialTerms?: string;
  @IsOptional() @IsString() supplierNotes?: string;
}

export class ReviseQuotationDto extends SubmitQuotationDto {
  @IsString() @IsNotEmpty() revisionReason: string;
}

export class AwardLineDto {
  @IsUUID() requirementLineId: string;
  @IsUUID() quotationVersionId: string;
  @IsNumber() @IsPositive() awardedQty: number;
  @IsUUID() uomId: string;
}

export class CreateAwardDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => AwardLineDto)
  lines: AwardLineDto[];
  @IsOptional() @IsString() conditions?: string;
  // Required when accepting supplier deviations / outside-policy substitution proposals.
  @IsOptional() @IsBoolean() consentAcceptedDeviations?: boolean;
}

export class SourcingNoteDto {
  @IsString() @IsNotEmpty() @MaxLength(1000) note: string;
}

export class ConsentDto {
  @IsInt() @Min(1) versionNo: number;
}
