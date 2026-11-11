import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { DataSource, DataSourceOptions } from 'typeorm';
import { join } from 'path';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { UploadsModule } from './uploads/uploads.module';
import { StaffModule } from './staff/staff.module';
import { ClassroomsModule } from './classrooms/classrooms.module';
import { ChildrenModule } from './children/children.module';
import { AttendanceModule } from './attendance/attendance.module';
import { MealsModule } from './meals/meals.module';
import { DailyLogsModule } from './daily-logs/daily-logs.module';
import { ActivitiesModule } from './activities/activities.module';
import { PhotosModule } from './photos/photos.module';
import { ReportsModule } from './reports/reports.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { FamilyModule } from './family/family.module';
import { WorkScheduleModule } from './schedule/work-schedule.module';
import { JustificationsModule } from './justifications/justifications.module';
import { TasksModule } from './tasks/tasks.module';
import { AuditModule } from './audit/audit.module';
import { PushModule } from './push/push.module';
import { RemindersModule } from './reminders/reminders.module';
import { BrandingModule } from './branding/branding.module';
import { SummaryModule } from './summary/summary.module';
import { ScopeModule } from './common/scope/scope.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ConsentsModule } from './consents/consents.module';
import { OpsModule } from './ops/ops.module';
import { baseDbOptions } from './database/db-options';
import { prepareSchema } from './database/schema-manager';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'medium', ttl: 10000, limit: 60 },
      { name: 'long', ttl: 60000, limit: 200 },
    ]),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
      exclude: ['/api/(.*)', '/uploads/(.*)'],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Credenciales + migraciones (src/database). `synchronize` nunca va aquí: lo decide
        // prepareSchema según DB_SYNC (dev: sync; producción: migraciones, jamás sync).
        ...baseDbOptions({
          host: config.get<string>('DB_HOST') || 'localhost',
          port: parseInt(config.get<string>('DB_PORT') || '5432', 10),
          username: config.get<string>('DB_USERNAME') || 'postgres',
          password: config.get<string>('DB_PASSWORD') || '',
          database: config.get<string>('DB_NAME') || 'sonrisas',
        }),
        autoLoadEntities: true,
      }),
      dataSourceFactory: async (options?: DataSourceOptions) => {
        if (!options) throw new Error('TypeORM options no definidos');
        const ds = await new DataSource(options).initialize();
        await prepareSchema(ds);
        return ds;
      },
    }),

    // Alcance por sala (global)
    ScopeModule,
    RealtimeModule,

    // Base
    AuthModule,
    UsersModule,
    UploadsModule,
    StaffModule,

    // Dominio de la guardería
    ClassroomsModule,
    ChildrenModule,
    AttendanceModule,
    MealsModule,
    DailyLogsModule,
    ActivitiesModule,
    PhotosModule,
    ReportsModule,
    WhatsappModule,
    FamilyModule,

    // Soporte
    WorkScheduleModule,
    JustificationsModule,
    TasksModule,
    AuditModule,
    PushModule,
    RemindersModule,
    BrandingModule,
    SummaryModule,
    ConsentsModule,
    OpsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
