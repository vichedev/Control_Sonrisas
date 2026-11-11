import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: any }) =>
  typeof value === 'string' ? value.trim() : value;

export const CHILD_MOODS = [
  '',
  'happy',
  'calm',
  'sleepy',
  'sad',
  'crying',
  'irritable',
  'sick',
] as const;

/** Llegada del niño a la guardería. */
export class CheckInDto {
  /** Foto en data URL base64 (opcional). */
  @IsOptional() @IsString()
  photo?: string;

  @IsOptional() @IsIn(CHILD_MOODS as unknown as string[])
  mood?: string;

  /** Temperatura en °C. Rango amplio a propósito: fuera de él es error de tecleo. */
  @IsOptional() @IsNumber() @Min(30) @Max(45)
  temperature?: number;

  /** Representante registrado que lo trae/retira, si se elige de la lista. */
  @IsOptional() @IsUUID()
  guardianId?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(120)
  personName?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(40)
  personRelationship?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(40)
  personDocument?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000)
  notes?: string;

  /**
   * Confirmación explícita de que se retira a alguien fuera de la lista de autorizados.
   * Sin ella el backend rechaza el retiro: es la única barrera real que tiene la puerta.
   */
  @IsOptional() @IsBoolean()
  overrideUnauthorized?: boolean;

  /** Sólo dirección/coordinación: registrar a una hora distinta de la actual. */
  @IsOptional() @IsString()
  at?: string;
}

export class CheckOutDto extends CheckInDto {}

export class UpdateAttendanceDto {
  @IsOptional() @IsIn(CHILD_MOODS as unknown as string[])
  mood?: string;

  @IsOptional() @IsNumber() @Min(30) @Max(45)
  temperature?: number | null;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(120)
  personName?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(40)
  personRelationship?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(40)
  personDocument?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000)
  notes?: string;

  /** Corrección de la hora del registro (ISO). Recalcula el estado de horario. */
  @IsOptional() @IsString()
  at?: string;

  /** Marca el registro como revisado, quitando el aviso de retiro no autorizado. */
  @IsOptional() @IsBoolean()
  clearFlag?: boolean;
}

/** Marcaje del personal. */
export class StaffMarkDto {
  @IsOptional() @IsIn(['in', 'lunch_out', 'lunch_in', 'out'])
  type?: string;

  @IsOptional() @IsString()
  photo?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  notes?: string;
}

/** Alta manual de un marcaje del personal, hecha por la dirección. */
export class ManualStaffMarkDto extends StaffMarkDto {
  @IsUUID()
  userId: string;

  @IsString()
  at: string;
}
