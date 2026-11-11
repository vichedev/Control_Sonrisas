import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Clase (no interface) para que el ValidationPipe global la valide y
 * `forbidNonWhitelisted` rechace campos extra.
 */
export class UpdateBrandingDto {
  @IsOptional() @IsString() @MaxLength(120)
  companyName?: string;

  @IsOptional() @IsString() @MaxLength(200)
  tagline?: string;

  @IsOptional() @IsString() @Matches(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i, {
    message: 'primaryColor debe ser un color hex (#rrggbb o #rrggbbaa)',
  })
  primaryColor?: string;

  /** Si viene, reemplaza el logo. Si es '' (string vacío) → limpia el logo. ~8 MB en base64. */
  @IsOptional() @IsString() @MaxLength(12_000_000)
  logoBase64?: string;
}
