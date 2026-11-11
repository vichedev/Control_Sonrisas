import { Module, Logger } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { User } from '../users/user.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { TwoFactorService } from './two-factor.service';
import { UploadsModule } from '../uploads/uploads.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([User]),
    UploadsModule,
    AuditModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        const logger = new Logger('AuthModule');

        // Sin fallback: si no hay un secreto fuerte, el módulo NO arranca.
        // Esto previene firmar tokens con una constante hardcodeada en cualquier
        // ambiente (producción, staging o dev). La única forma de levantar la app
        // es proveer un JWT_SECRET adecuado por env var.
        if (!secret) {
          throw new Error(
            'JWT_SECRET no está definido. Genera uno con `openssl rand -base64 48` y exportalo antes de levantar la app.',
          );
        }
        if (secret.length < 32) {
          throw new Error(
            `JWT_SECRET es demasiado corto (${secret.length} chars). Necesita al menos 32 caracteres.`,
          );
        }
        // Detección heurística de placeholders comunes que jamás deberían firmar tokens reales.
        const looksLikePlaceholder = /(changeme|secret|password|dev|test|example|placeholder)/i.test(secret);
        if (looksLikePlaceholder && config.get<string>('NODE_ENV') === 'production') {
          throw new Error('JWT_SECRET parece un placeholder. Regéneralo antes de producción.');
        }
        if (looksLikePlaceholder) {
          logger.warn('JWT_SECRET parece un placeholder; regéneralo antes de producción.');
        }

        return {
          secret,
          signOptions: {
            expiresIn: config.get<string>('JWT_EXPIRES_IN') || '7d',
            issuer: 'sonrisas',
          },
        };
      },
    }),
  ],
  providers: [AuthService, JwtStrategy, TwoFactorService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
