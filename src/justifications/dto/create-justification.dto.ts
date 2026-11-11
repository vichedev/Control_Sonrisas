import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: any }) =>
  typeof value === 'string' ? value.trim() : value;

export const JUSTIFICATION_TYPES = [
  'enfermedad',
  'cita_medica',
  'viaje',
  'familiar',
  'tardanza',
  'otro',
] as const;

export class CreateJustificationDto {
  /**
   * Obligatorio para el personal. Los representantes lo indican también, pero el
   * backend comprueba que el niño sea suyo antes de aceptarlo.
   */
  @IsUUID()
  childId: string;

  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;

  @IsOptional() @IsIn(JUSTIFICATION_TYPES as unknown as string[])
  type?: string;

  @Transform(trim) @IsString() @MinLength(3) @MaxLength(2000)
  reason: string;

  /** Certificado médico u otro documento, en data URL base64. */
  @IsOptional() @IsString()
  attachment?: string;
}
