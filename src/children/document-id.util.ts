import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Cédula / pasaporte del niño.
 *
 * Regla "suave": se acepta una cédula ecuatoriana válida (10 dígitos + dígito verificador)
 * o algo con forma de pasaporte (5–20 letras/dígitos con al menos una letra). Se rechazan
 * los casos claramente erróneos: 10 dígitos con verificador incorrecto, números de
 * longitud rara, símbolos, etc.
 */

/** Normaliza: quita espacios, puntos y guiones, mayúsculas. '' → null. */
export function normalizeDocumentId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return value as any;
  const v = value.replace(/[\s.-]+/g, '').toUpperCase();
  return v || null;
}

/** Cédula ecuatoriana: provincia 01–24 (o 30 = exterior), 3.er dígito < 6, módulo 10. */
export function isValidEcuadorCedula(v: string): boolean {
  if (!/^\d{10}$/.test(v)) return false;
  const province = Number(v.slice(0, 2));
  if (!((province >= 1 && province <= 24) || province === 30)) return false;
  if (Number(v[2]) >= 6) return false;
  const coef = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let p = Number(v[i]) * coef[i];
    if (p >= 10) p -= 9;
    sum += p;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(v[9]);
}

/** Pasaporte u otro documento extranjero: 5–20 alfanuméricos con al menos una letra. */
export function looksLikePassport(v: string): boolean {
  return /^[A-Z0-9]{5,20}$/.test(v) && /[A-Z]/.test(v);
}

/** null si es válido; si no, el mensaje de error en español. */
export function documentIdError(v: string | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') return 'La cédula debe ser texto';
  if (v.length > 20) return 'La cédula o pasaporte no puede tener más de 20 caracteres';
  if (/^\d+$/.test(v)) {
    if (v.length !== 10) return 'La cédula ecuatoriana tiene 10 dígitos';
    if (!isValidEcuadorCedula(v)) return 'La cédula no es válida: revisa los dígitos';
    return null;
  }
  if (looksLikePassport(v)) return null;
  return 'Escribe una cédula de 10 dígitos o un pasaporte (5 a 20 letras y números)';
}

/** Decorador class-validator para el DTO. Acepta undefined/null ('' ya llega como null). */
export function IsChildDocumentId(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isChildDocumentId',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => documentIdError(value as any) === null,
        defaultMessage: (args) => documentIdError(args?.value as any) || 'Documento no válido',
      },
    });
  };
}
