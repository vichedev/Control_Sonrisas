import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../common/password.validator';

const trim = ({ value }: { value: any }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateProfileDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120)
  name?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(40)
  phone?: string;

  /** Foto en data URL base64 (opcional). Si viene reemplaza la foto del usuario. */
  @IsOptional() @IsString()
  photoBase64?: string;
}

export class ChangePasswordDto {
  @IsString() @MinLength(6)
  currentPassword: string;

  @IsString() @IsStrongPassword()
  newPassword: string;

  /**
   * Código TOTP de 6 dígitos. OBLIGATORIO si el usuario tiene 2FA activo —
   * el service valida según `user.totpEnabled`. Lo dejamos opcional en el DTO
   * para no romper clientes legacy; la lógica de bloqueo está en AuthService.
   */
  @IsOptional() @IsString() @MaxLength(8)
  totpCode?: string;
}
