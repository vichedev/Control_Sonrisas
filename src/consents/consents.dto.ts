import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CONSENT_TYPES, ConsentType } from './consent.types';

const trim = ({ value }: { value: any }) => (typeof value === 'string' ? value.trim() : value);

/** Decisión de la familia desde el portal. */
export class FamilyConsentDto {
  @IsUUID()
  childId: string;

  @IsIn(CONSENT_TYPES as unknown as string[])
  type: ConsentType;

  @IsBoolean()
  granted: boolean;

  /** Confirmación explícita "Soy el representante legal…". */
  @IsBoolean()
  legalRepresentative: boolean;
}

export class ConsentDecisionDto {
  @IsUUID()
  childId: string;

  @IsIn(CONSENT_TYPES as unknown as string[])
  type: ConsentType;

  @IsBoolean()
  granted: boolean;
}

/** Varias decisiones a la vez (flujo inicial del portal). */
export class FamilyConsentBatchDto {
  @IsBoolean()
  legalRepresentative: boolean;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(60)
  @ValidateNested({ each: true }) @Type(() => ConsentDecisionDto)
  decisions: ConsentDecisionDto[];
}

/** Formulario en papel registrado por coordinación/dirección. */
export class StaffConsentDto {
  @IsIn(CONSENT_TYPES as unknown as string[])
  type: ConsentType;

  @IsBoolean()
  granted: boolean;

  @IsOptional() @IsIn(['presencial'])
  method?: 'presencial';

  @IsOptional() @IsUUID()
  guardianId?: string;

  /** Nombre de quien firmó, si no tiene cuenta en el sistema. */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160)
  guardianName?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000)
  note?: string;
}

export class PublishPolicyDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(200)
  title: string;

  @Transform(trim) @IsString() @MinLength(20) @MaxLength(20000)
  body: string;

  /** true = las autorizaciones anteriores quedan pendientes de renovar. */
  @IsBoolean()
  requireReconsent: boolean;
}
