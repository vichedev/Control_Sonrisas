import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: any }) =>
  typeof value === 'string' ? value.trim() : value;

export const MEAL_TYPES = ['breakfast', 'snack_am', 'lunch', 'snack_pm', 'bottle'] as const;
export const MEAL_INTAKES = ['all', 'most', 'half', 'little', 'none'] as const;

export class CreateMealDto {
  @IsUUID()
  childId: string;

  @IsIn(MEAL_TYPES as unknown as string[])
  type: string;

  @IsOptional() @IsString() @MaxLength(10)
  date?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  menu?: string;

  @IsOptional() @IsIn(MEAL_INTAKES as unknown as string[])
  intake?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000)
  notes?: string;

  @IsOptional() @IsString()
  photo?: string;
}

/** Cantidad y observación de un niño concreto dentro del registro en bloque. */
export class BulkMealEntryDto {
  @IsUUID()
  childId: string;

  @IsOptional() @IsIn(MEAL_INTAKES as unknown as string[])
  intake?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000)
  notes?: string;
}

/**
 * Registro de una comida para toda una sala: un menú común y la cantidad que comió
 * cada niño. Es como se trabaja de verdad — nadie abre una ficha por niño a la hora
 * del almuerzo.
 */
export class BulkMealDto {
  @IsIn(MEAL_TYPES as unknown as string[])
  type: string;

  @IsOptional() @IsString() @MaxLength(10)
  date?: string;

  @IsOptional() @IsUUID()
  classroomId?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  menu?: string;

  /** Foto del plato del día: se asocia a la sala, no a un niño. */
  @IsOptional() @IsString()
  photo?: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => BulkMealEntryDto)
  entries: BulkMealEntryDto[];
}

export class UpdateMealDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  menu?: string;

  @IsOptional() @IsIn(MEAL_INTAKES as unknown as string[])
  intake?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000)
  notes?: string;

  @IsOptional() @IsString()
  photo?: string;
}
