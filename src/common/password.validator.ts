import { randomInt } from 'crypto';
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/** Longitud mínima para cualquier contraseña del sistema. */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * Contraseñas triviales que se rechazan aunque cumplan longitud y composición.
 * Lista corta a propósito: cubre lo que la gente pone en un sistema en español
 * cuando le obligas a "una letra y un número".
 */
const BLOCKLIST = [
  'password1', 'password123', 'contrasena1', 'contrasena123', 'contraseña1',
  'admin12345', 'administrador1', 'qwerty12345', 'asdf12345', '1234567890',
  'abcd123456', 'facetowork1', 'facetowork123', 'usuario123', 'trabajador1',
];

/**
 * Valida la fortaleza de una contraseña. Devuelve el motivo del rechazo o null.
 * Reglas: ≥10 caracteres, al menos una letra y un dígito, no puede ser una
 * secuencia trivial ni estar en la blocklist, y no puede repetir un mismo
 * carácter en todo el texto.
 */
export function checkPasswordStrength(value: unknown): string | null {
  if (typeof value !== 'string') return 'La contraseña debe ser un texto';
  const pw = value;
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`;
  }
  if (pw.length > 128) return 'La contraseña no puede superar los 128 caracteres';
  if (!/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(pw)) return 'La contraseña debe incluir al menos una letra';
  if (!/[0-9]/.test(pw)) return 'La contraseña debe incluir al menos un número';
  if (/^(.)\1+$/.test(pw)) return 'La contraseña no puede ser el mismo carácter repetido';
  const lower = pw.toLowerCase();
  if (BLOCKLIST.includes(lower)) return 'Esa contraseña es demasiado común, elige otra';
  // Secuencias obvias tipo "12345678901" o "abcdefghij".
  if (/^(?:0123456789|abcdefghij|qwertyuiop)/.test(lower)) {
    return 'Esa contraseña es demasiado predecible, elige otra';
  }
  return null;
}

/**
 * Decorador de class-validator: `@IsStrongPassword()`.
 * Se usa en todos los DTOs que aceptan una contraseña, para que la política
 * sea la misma en el alta de trabajadores, de administradores y en el cambio
 * de contraseña del propio usuario.
 */
export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: any) => checkPasswordStrength(value) === null,
        defaultMessage: (args: ValidationArguments) =>
          checkPasswordStrength(args.value) ||
          `${args.property} no cumple la política de contraseñas`,
      },
    });
  };
}

/**
 * Contraseña temporal para el alta / reseteo de cuentas.
 * Usa `crypto.randomInt` (CSPRNG) — `Math.random()` es predecible y NUNCA debe
 * generar credenciales.
 */
export function generateTempPassword(length = 14): string {
  // Sin caracteres ambiguos (0/O, 1/l/I) para que se pueda dictar por teléfono.
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const alphabet = letters + digits;
  let out = '';
  // Garantizamos al menos una letra y un dígito para cumplir la política.
  out += letters[randomInt(letters.length)];
  out += digits[randomInt(digits.length)];
  for (let i = out.length; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  // Mezcla final (Fisher-Yates con CSPRNG) para no dejar el patrón fijo al inicio.
  const chars = out.split('');
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
