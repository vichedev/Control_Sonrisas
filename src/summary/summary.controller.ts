import { Controller, Get, UseGuards } from '@nestjs/common';
import { StaffGuard } from '../auth/roles.guard';
import { JustificationsService } from '../justifications/justifications.service';
import { TasksService } from '../tasks/tasks.service';
import { DailyLogsService } from '../daily-logs/daily-logs.service';
import { AttendanceService } from '../attendance/attendance.service';
import { ReportsService } from '../reports/reports.service';
import { dayKey } from '../common/day.util';

/**
 * Contadores ligeros para la barra lateral de la SPA. Se pide cada minuto, así que
 * todo lo que hay aquí son `count`s, nunca listados completos.
 */
@UseGuards(StaffGuard)
@Controller('summary')
export class SummaryController {
  constructor(
    private readonly justifications: JustificationsService,
    private readonly tasks: TasksService,
    private readonly logs: DailyLogsService,
    private readonly attendance: AttendanceService,
    private readonly reports: ReportsService,
  ) {}

  @Get('badges')
  async badges() {
    const today = dayKey();
    const [pendingJustifications, openTasks, pendingNotices, totals, pendingReports] =
      await Promise.all([
        this.justifications.pendingCount(),
        this.tasks.countOpen(),
        this.logs.pendingNoticesCount(),
        this.attendance.dailyTotals(today),
        this.reports.pendingForDay(today),
      ]);

    return {
      pendingJustifications,
      pendingTasks: openTasks.pending,
      inProgressTasks: openTasks.inProgress,
      /** Avisos a familias que aún no se han comunicado (incidentes, fiebre…). */
      pendingNotices,
      /** Niños presentes ahora mismo. */
      presentNow: totals.present,
      absentToday: totals.absent,
      flaggedToday: totals.flagged,
      /** Reportes diarios que faltan por generar. */
      pendingReports: pendingReports.length,
    };
  }
}
