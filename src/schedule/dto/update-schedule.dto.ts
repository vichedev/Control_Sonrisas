import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateScheduleDto {
  @IsOptional() @IsString() @MaxLength(80)
  name?: string;

  @IsOptional() @IsBoolean()
  enabled?: boolean;

  /** { "0": { enabled, start: "HH:mm", end: "HH:mm", lunchStart?, lunchEnd? }, ... "6": {...} } — el servicio lo sanea. */
  @IsOptional() @IsObject()
  days?: Record<string, { enabled?: boolean; start?: string; end?: string; lunchStart?: string; lunchEnd?: string }>;

  /** [{ date: "YYYY-MM-DD", name: "..." }, ...] — el servicio lo sanea. */
  @IsOptional() @IsArray()
  holidays?: Array<{ date?: string; name?: string }>;

  // --- Niños ---

  @IsOptional() @IsInt() @Min(0) @Max(1440)
  lateArrivalAfterMinutes?: number;

  /** "HH:mm" o '' para desactivar el control de retiro tardío. */
  @IsOptional() @IsString() @MaxLength(5)
  pickupDeadline?: string;

  @IsOptional() @IsInt() @Min(0) @Max(1440)
  latePickupAfterMinutes?: number;

  /** Hora a la que se generan los reportes diarios pendientes. '' = sólo manual. */
  @IsOptional() @IsString() @MaxLength(5)
  reportGenerationTime?: string;

  // --- Personal ---

  @IsOptional() @IsBoolean()
  staffAttendanceEnabled?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(1440)
  lateAfterMinutes?: number;

  @IsOptional() @IsInt() @Min(0) @Max(1440)
  absentAfterMinutes?: number;

  @IsOptional() @IsBoolean()
  overtimeEnabled?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(1440)
  overtimeAfterMinutes?: number;

  @IsOptional() @IsBoolean()
  earlyLeaveEnabled?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(1440)
  earlyLeaveBeforeMinutes?: number;

  // --- Datos del centro (salen en el reporte de la familia) ---

  @IsOptional() @IsString() @MaxLength(120)
  centerName?: string;

  @IsOptional() @IsString() @MaxLength(200)
  centerAddress?: string;

  @IsOptional() @IsString() @MaxLength(40)
  centerPhone?: string;
}
