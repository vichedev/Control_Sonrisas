import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Re-confirmación: contraseña + código 2FA (si la cuenta lo tiene). */
export class ReauthDto {
  @IsString()
  @MaxLength(200)
  password: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos' })
  code?: string;
}

export class CreateBackupDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class RestoreBackupDto extends ReauthDto {
  /** Hay que escribir literalmente RESTAURAR. */
  @IsString()
  @IsIn(['RESTAURAR'], { message: 'Escribe RESTAURAR para confirmar' })
  confirm: string;
}

export class UpdateSystemDto extends ReauthDto {
  @IsString()
  @Matches(/^v\d+\.\d+\.\d+$/, { message: 'Versión inválida (formato vX.Y.Z)' })
  version: string;
}

export class RollbackSystemDto extends ReauthDto {
  /** true: además de volver al código anterior, restaura la BD del respaldo previo a la actualización. */
  @IsOptional()
  @IsBoolean()
  restoreDb?: boolean;
}
