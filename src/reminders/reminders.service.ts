import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ReminderSent } from './reminder-sent.entity';
import { User } from '../users/user.entity';
import { WorkScheduleService } from '../schedule/work-schedule.service';
import { PushService } from '../push/push.service';
import { AttendanceService } from '../attendance/attendance.service';
import { DailyLogsService } from '../daily-logs/daily-logs.service';
import { ReportsService } from '../reports/reports.service';
import { dayKey, minutesOfDay, timeKey } from '../common/day.util';

/**
 * Avisos automáticos al personal.
 *
 * Tres cosas que se olvidan de verdad en una guardería y que el sistema sí puede
 * recordar: niños sin registrar el retiro al cerrar, reportes diarios sin generar y
 * avisos urgentes a familias que siguen sin comunicarse.
 *
 * Cada aviso se registra en `reminder_sent` para no repetirse el mismo día.
 */
@Injectable()
export class RemindersService {
  private readonly log = new Logger('RemindersService');

  /**
   * Id sintético para los avisos que son del centro entero y no de una persona.
   * La columna es uuid; usar un uuid fijo evita añadir un tipo sólo por este caso.
   */
  private readonly CENTER_ID = '00000000-0000-0000-0000-0000000000ce';

  constructor(
    @InjectRepository(ReminderSent) private readonly sentRepo: Repository<ReminderSent>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly schedule: WorkScheduleService,
    private readonly push: PushService,
    private readonly attendance: AttendanceService,
    private readonly logs: DailyLogsService,
    private readonly reports: ReportsService,
  ) {}

  /**
   * La ventana la decide la configuración del horario, no el cron: así la dirección
   * puede mover la hora de cierre sin tocar el código.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async tick() {
    try {
      const schedule = await this.schedule.get();
      if (!schedule.enabled) return;

      const today = dayKey();
      if (this.schedule.isClosed(schedule, today).closed) return;

      const reportTime = schedule.reportGenerationTime || '17:00';
      // Antes de la hora de cierre, que falten retiros y reportes es lo normal.
      if (minutesOfDay(timeKey()) < minutesOfDay(reportTime)) return;

      await this.remindPendingCheckouts(today);
      await this.remindPendingReports(today);
      await this.remindPendingNotices(today);
    } catch (e: any) {
      this.log.warn(`Fallo en el ciclo de recordatorios: ${e?.message || e}`);
    }
  }

  /** Niños que siguen marcados como presentes pasada la hora de cierre. */
  private async remindPendingCheckouts(day: string) {
    const board = await this.attendance.board({ date: day });
    const stillIn = board.children.filter((c) => c.status === 'present');
    if (!stillIn.length) return;
    // Se reserva el aviso antes de enviarlo: si otro proceso ya lo reservó, no se repite.
    if (!(await this.claim(day, 'pending_checkout'))) return;

    await this.notifyOrRelease(day, 'pending_checkout', {
      title: 'Retiros sin registrar',
      body: `${stillIn.length} niño(s) siguen marcados como presentes: ${stillIn
        .slice(0, 5)
        .map((c) => c.name)
        .join(', ')}${stillIn.length > 5 ? '…' : ''}`,
      tag: `pending-checkout-${day}`,
    });
  }

  /** Reportes diarios que faltan por generar. */
  private async remindPendingReports(day: string) {
    const pending = await this.reports.pendingForDay(day);
    if (!pending.length) return;
    // Se reserva el aviso antes de enviarlo: si otro proceso ya lo reservó, no se repite.
    if (!(await this.claim(day, 'pending_reports'))) return;

    await this.notifyOrRelease(day, 'pending_reports', {
      title: 'Reportes del día pendientes',
      body: `Faltan ${pending.length} reporte(s) por generar y enviar a las familias.`,
      tag: `pending-reports-${day}`,
    });
  }

  /** Incidentes o alertas de salud que aún no se han comunicado a la familia. */
  private async remindPendingNotices(day: string) {
    const count = await this.logs.pendingNoticesCount();
    if (!count) return;
    // Se reserva el aviso antes de enviarlo: si otro proceso ya lo reservó, no se repite.
    if (!(await this.claim(day, 'pending_notice'))) return;

    await this.notifyOrRelease(day, 'pending_notice', {
      title: 'Avisos a familias sin comunicar',
      body: `Hay ${count} anotación(es) marcadas como "avisar a la familia" todavía sin comunicar.`,
      tag: `pending-notice-${day}`,
    });
  }

  /** Notifica a dirección y coordinación, que son quienes cierran el día. */
  private async notifyStaff(payload: { title: string; body: string; tag: string }) {
    const managers = await this.usersRepo.find({
      where: { role: In(['admin', 'coordinator']), active: true },
    });
    if (!managers.length) return;
    await this.push.notifyUsers(
      managers.map((m) => m.id),
      payload,
    );
  }

  /**
   * Inserta la marca de "enviado" (clave única). True sólo si esta llamada la creó:
   * así dos ciclos simultáneos no mandan el mismo aviso dos veces.
   */
  private async claim(day: string, kind: string): Promise<boolean> {
    try {
      await this.sentRepo.insert({ subjectId: this.CENTER_ID, day, kind });
      return true;
    } catch {
      // Colisión con la clave única: otro proceso lo reservó primero.
      return false;
    }
  }

  /** Notifica; si el envío falla, libera la marca para reintentar en el próximo ciclo. */
  private async notifyOrRelease(
    day: string,
    kind: string,
    payload: { title: string; body: string; tag: string },
  ) {
    try {
      await this.notifyStaff(payload);
    } catch (e) {
      await this.sentRepo.delete({ subjectId: this.CENTER_ID, day, kind }).catch(() => undefined);
      throw e;
    }
  }

  /** Limpia la bitácora de recordatorios de más de 60 días. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    await this.sentRepo
      .createQueryBuilder()
      .delete()
      .where('day < :cutoff', { cutoff: dayKey(cutoff) })
      .execute();
  }
}
