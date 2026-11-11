import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Ajustes de esquema que `synchronize` no resuelve solo (antes vivían en app.module.ts).
 * Son idempotentes y conservan los datos. Se ejecutan:
 *   · en modo `sync` (desarrollo), antes de cada synchronize;
 *   · una sola vez al adoptar el baseline en una BD creada con synchronize.
 *
 * La conversión `timestamp → timestamptz` existe porque el driver `pg` inserta en UTC
 * pero relee en la hora LOCAL del proceso: con TZ=America/Guayaquil, un `timestamp`
 * sin zona provoca un desfase de 5 h en cada hora mostrada.
 */
export async function preSyncFixups(ds: DataSource): Promise<void> {
  const log = new Logger('SchemaFixups');
  const qr = ds.createQueryRunner();
  try {
    const timestampTargets: Array<[string, string]> = [
      ['users', 'createdAt'],
      ['users', 'updatedAt'],
      ['children', 'createdAt'],
      ['children', 'updatedAt'],
      ['classrooms', 'createdAt'],
      ['classrooms', 'updatedAt'],
      ['child_attendances', 'createdAt'],
      ['staff_attendances', 'createdAt'],
      ['meals', 'createdAt'],
      ['meals', 'servedAt'],
      ['daily_logs', 'occurredAt'],
      ['daily_logs', 'endedAt'],
      ['daily_logs', 'createdAt'],
      ['activities', 'startedAt'],
      ['activities', 'endedAt'],
      ['activities', 'createdAt'],
      ['activities', 'updatedAt'],
      ['photos', 'createdAt'],
      ['daily_reports', 'sentAt'],
      ['daily_reports', 'createdAt'],
      ['daily_reports', 'updatedAt'],
      ['whatsapp_messages', 'sentAt'],
      ['whatsapp_messages', 'createdAt'],
      ['work_schedule', 'createdAt'],
      ['work_schedule', 'updatedAt'],
      ['audit_log', 'createdAt'],
      ['justifications', 'createdAt'],
      ['justifications', 'updatedAt'],
      ['justifications', 'decidedAt'],
      ['tasks', 'createdAt'],
      ['tasks', 'updatedAt'],
      ['tasks', 'dueAt'],
      ['tasks', 'completedAt'],
      ['push_subscriptions', 'createdAt'],
      ['reminder_sent', 'createdAt'],
      ['app_branding', 'createdAt'],
      ['app_branding', 'updatedAt'],
    ];
    for (const [table, column] of timestampTargets) {
      if (!(await qr.hasTable(table))) continue;
      const info = await qr.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_name=$1 AND column_name=$2`,
        [table, column],
      );
      if (info?.[0]?.data_type === 'timestamp without time zone') {
        log.log(`Migrando ${table}.${column} (timestamp) → timestamptz (UTC)`);
        await ds.query(
          `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE timestamptz USING "${column}" AT TIME ZONE 'UTC'`,
        );
      }
    }

    // Antes del índice único (childId, date, type): quitar llegadas/retiros duplicados.
    // Se conserva la llegada más temprana y el retiro más reciente de cada día.
    if (await qr.hasTable('child_attendances')) {
      const res = await qr.query(
        `DELETE FROM child_attendances a
         USING (
           SELECT id, ROW_NUMBER() OVER (
             PARTITION BY "childId", "date", "type"
             ORDER BY CASE WHEN "type" = 'out' THEN -EXTRACT(EPOCH FROM "createdAt")
                           ELSE EXTRACT(EPOCH FROM "createdAt") END, id
           ) AS rn
           FROM child_attendances
         ) d
         WHERE a.id = d.id AND d.rn > 1
         RETURNING a.id`,
      );
      const removed = Array.isArray(res?.[0]) ? res[0].length : Array.isArray(res) ? res.length : 0;
      if (removed) log.warn(`Eliminados ${removed} registros de asistencia duplicados`);
    }

    // Salas sin educadora en `teacherId` pero con una educadora asignada desde Personal.
    if ((await qr.hasTable('classrooms')) && (await qr.hasTable('users'))) {
      await ds.query(
        `UPDATE classrooms c SET "teacherId" = u.id
           FROM (SELECT DISTINCT ON ("classroomId") id, "classroomId" FROM users
                  WHERE role = 'teacher' AND active = true AND "classroomId" IS NOT NULL
                  ORDER BY "classroomId", "createdAt") u
          WHERE c.id = u."classroomId" AND c."teacherId" IS NULL`,
      );
    }
  } catch (e: any) {
    log.warn(`pre-sync fixup falló: ${e?.message || e}`);
  } finally {
    await qr.release();
  }
}
