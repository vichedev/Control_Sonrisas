import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsChildDocumentId, normalizeDocumentId } from '../document-id.util';

const trim = ({ value }: { value: any }) =>
  typeof value === 'string' ? value.trim() : value;

/** Datos de un representante que se crea junto con el niño. */
export class GuardianInputDto {
  /** Si viene, se enlaza a un representante que ya existe y se ignora el resto. */
  @IsOptional() @IsUUID()
  guardianId?: string;

  @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(120)
  name?: string;

  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail()
  email?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(30)
  phone?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(40)
  documentId?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(40)
  relationship?: string;

  @IsOptional() @IsBoolean()
  isPrimary?: boolean;

  @IsOptional() @IsBoolean()
  canPickup?: boolean;

  @IsOptional() @IsBoolean()
  receivesReport?: boolean;

  /** Si es true se le crea cuenta de acceso al portal familiar. */
  @IsOptional() @IsBoolean()
  createAccount?: boolean;
}

export class CreateChildDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40)
  code?: string;

  /** Cédula o pasaporte del niño. Opcional; '' o null la borran. */
  @IsOptional() @Transform(({ value }) => normalizeDocumentId(value)) @IsChildDocumentId()
  documentId?: string | null;

  @Transform(trim) @IsString() @MinLength(2) @MaxLength(60)
  firstName: string;

  @Transform(trim) @IsString() @MinLength(2) @MaxLength(60)
  lastName: string;

  @IsDateString()
  birthDate: string;

  @IsOptional() @IsIn(['f', 'm', 'other'])
  gender?: string;

  /** Foto de perfil como data URL base64. */
  @IsOptional() @IsString()
  photo?: string;

  @IsOptional() @IsUUID()
  classroomId?: string | null;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000)
  allergies?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  medicalConditions?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  medications?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(8)
  bloodType?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(120)
  pediatricianName?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(30)
  pediatricianPhone?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(120)
  insurance?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(120)
  emergencyContactName?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(30)
  emergencyContactPhone?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  dietaryNotes?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  napNotes?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  authorizedPickupNotes?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(4000)
  internalNotes?: string;

  @IsOptional() @IsDateString()
  enrolledAt?: string;

  @IsOptional() @IsBoolean()
  active?: boolean;

  /** Representantes a enlazar en el alta. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => GuardianInputDto)
  guardians?: GuardianInputDto[];
}

export class UpdateChildDto extends CreateChildDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(60)
  declare firstName: string;

  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(60)
  declare lastName: string;

  @IsOptional() @IsDateString()
  declare birthDate: string;
}

export class LinkGuardianDto extends GuardianInputDto {}

export class UpdateGuardianLinkDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40)
  relationship?: string;

  @IsOptional() @IsBoolean()
  isPrimary?: boolean;

  @IsOptional() @IsBoolean()
  canPickup?: boolean;

  @IsOptional() @IsBoolean()
  receivesReport?: boolean;
}

/** Edición de la cuenta de un representante desde el panel (directorio "Representantes"). */
export class UpdateGuardianDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(120)
  name?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(30)
  phone?: string;

  /** '' = quitar el correo (vuelve a uno interno y pierde el acceso al portal). */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @ValidateIf((_, v) => v !== '')
  @IsEmail()
  email?: string;

  @IsOptional() @IsBoolean()
  active?: boolean;
}
