import { IsString, Length, MinLength } from 'class-validator';

export class VerifyTotpDto {
  @IsString() @Length(6, 6)
  code: string;
}

export class Disable2FADto {
  @IsString() @Length(6, 6)
  code: string;

  @IsString() @MinLength(6)
  password: string;
}

export class TotpLoginDto {
  /** Token temporal devuelto por /auth/login cuando la cuenta tiene 2FA activado. */
  @IsString()
  tempToken: string;

  @IsString() @Length(6, 6)
  code: string;
}
