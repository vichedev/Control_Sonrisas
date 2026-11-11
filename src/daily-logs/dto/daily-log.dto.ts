import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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

export const LOG_KINDS = ['nap', 'hygiene', 'health', 'incident', 'mood', 'note'] as const;

export class CreateDailyLogDto {
  @IsUUID()
  childId: string;

  @IsIn(LOG_KINDS as unknown as string[])
  kind: string;

  @IsOptional() @IsString() @MaxLength(10)
  date?: string;

  /**
   * Subtipo: 'panal_mojado', 'siesta', 'fiebre', 'medicacion'…
   * Siesta: 'no_durmio' = no durmió (sin endedAt → duración 0).
   */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(32)
  detail?: string;

  /** Hora del hecho (ISO). Por defecto, ahora. */
  @IsOptional() @IsString()
  occurredAt?: string;

  /** Sólo siestas: hora de despertar (ISO). */
  @IsOptional() @IsString()
  endedAt?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  notes?: string;

  @IsOptional() @IsNumber() @Min(30) @Max(45)
  temperature?: number;

  @IsOptional() @IsString()
  photo?: string;

  /** Marca que hay que avisar a la familia ahora, no al cierre del día. */
  @IsOptional() @IsBoolean()
  notifyGuardian?: boolean;
}

export class UpdateDailyLogDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(32)
  detail?: string;

  @IsOptional() @IsString()
  occurredAt?: string;

  @IsOptional() @IsString()
  endedAt?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  notes?: string;

  @IsOptional() @IsNumber() @Min(30) @Max(45)
  temperature?: number | null;

  @IsOptional() @IsString()
  photo?: string;

  @IsOptional() @IsBoolean()
  notifyGuardian?: boolean;

  @IsOptional() @IsBoolean()
  guardianNotified?: boolean;
}

/** Anotación rápida para varios niños a la vez (p. ej. "todos durmieron de 13:00 a 14:30"). */
export class BulkDailyLogDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('4', { each: true })
  childIds: string[];

  @IsIn(LOG_KINDS as unknown as string[])
  kind: string;

  @IsOptional() @IsString() @MaxLength(10)
  date?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(32)
  detail?: string;

  @IsOptional() @IsString()
  occurredAt?: string;

  @IsOptional() @IsString()
  endedAt?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  notes?: string;

  /** Avisar a la familia ahora. Por defecto, sólo en incidentes (igual que el alta individual). */
  @IsOptional() @IsBoolean()
  notifyGuardian?: boolean;
}
