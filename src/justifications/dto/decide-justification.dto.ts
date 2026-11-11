import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: any }) => (typeof value === 'string' ? value.trim() : value);

export class DecideJustificationDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000)
  adminNote?: string;
}
