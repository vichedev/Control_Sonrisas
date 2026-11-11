import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: any }) =>
  typeof value === 'string' ? value.trim() : value;

export const CLASSROOM_LEVELS = [
  'lactantes',
  'maternal',
  'caminadores',
  'prekinder',
  'kinder',
  'otro',
] as const;

export class CreateClassroomDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(80)
  name: string;

  @IsOptional() @IsIn(CLASSROOM_LEVELS as unknown as string[])
  level?: string;

  @IsOptional() @IsInt() @Min(0) @Max(240)
  ageMinMonths?: number;

  @IsOptional() @IsInt() @Min(0) @Max(240)
  ageMaxMonths?: number;

  @IsOptional() @IsInt() @Min(0) @Max(500)
  capacity?: number;

  @IsOptional() @IsHexColor()
  color?: string;

  @IsOptional() @IsUUID()
  teacherId?: string | null;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  notes?: string;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

export class UpdateClassroomDto extends CreateClassroomDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(80)
  declare name: string;
}
