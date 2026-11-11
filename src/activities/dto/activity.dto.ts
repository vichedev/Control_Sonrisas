import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
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

const trim = ({ value }: { value: any }) =>
  typeof value === 'string' ? value.trim() : value;

export const ACTIVITY_CATEGORIES = [
  'motor',
  'arte',
  'musica',
  'lectura',
  'juego',
  'aprendizaje',
  'exterior',
  'sensorial',
  'higiene',
  'otro',
] as const;

export const PARTICIPATIONS = ['excellent', 'good', 'regular', 'low', 'absent'] as const;

export class ParticipantInputDto {
  @IsUUID()
  childId: string;

  @IsOptional() @IsIn(PARTICIPATIONS as unknown as string[])
  participation?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000)
  note?: string;
}

export class CreateActivityDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120)
  title: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(4000)
  description?: string;

  @IsOptional() @IsIn(ACTIVITY_CATEGORIES as unknown as string[])
  category?: string;

  @IsOptional() @IsUUID()
  classroomId?: string | null;

  @IsOptional() @IsString() @MaxLength(10)
  date?: string;

  @IsOptional() @IsString()
  startedAt?: string;

  @IsOptional() @IsString()
  endedAt?: string;

  /** Foto principal, en data URL base64. */
  @IsOptional() @IsString()
  coverPhoto?: string;

  /** Fotos adicionales de la actividad. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  photos?: string[];

  @IsOptional() @IsBoolean()
  shareWithFamilies?: boolean;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  summary?: string;

  /** Niños que participan. Si se omite, se toman todos los de la sala. */
  @IsOptional() @IsArray() @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => ParticipantInputDto)
  participants?: ParticipantInputDto[];
}

export class UpdateActivityDto extends CreateActivityDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120)
  declare title: string;

  @IsOptional() @IsIn(['planned', 'in_progress', 'completed', 'cancelled'])
  status?: string;
}

export class SetParticipantsDto {
  @IsArray() @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => ParticipantInputDto)
  participants: ParticipantInputDto[];
}
