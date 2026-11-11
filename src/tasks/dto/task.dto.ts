import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: any }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateTaskDto {
  @IsUUID()
  assigneeId: string;

  @Transform(trim) @IsString() @MinLength(3) @MaxLength(150)
  title: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsIn(['low', 'normal', 'high', 'urgent'])
  priority?: string;

  @IsOptional() @IsUUID()
  classroomId?: string;

  @IsOptional() @IsUUID()
  childId?: string;

  /** Fecha límite en ISO. */
  @IsOptional() @IsString()
  dueAt?: string;
}

export class UpdateTaskDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(150)
  title?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsIn(['low', 'normal', 'high', 'urgent'])
  priority?: string;

  @IsOptional() @IsIn(['pending', 'in_progress', 'completed', 'cancelled'])
  status?: string;

  @IsOptional() @IsString()
  dueAt?: string;

  @IsOptional() @IsUUID()
  assigneeId?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000)
  completionNote?: string;
}
