import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard, CoordinatorGuard, StaffGuard } from '../auth/roles.guard';
import { ChildrenService } from './children.service';
import {
  CreateChildDto,
  LinkGuardianDto,
  UpdateChildDto,
  UpdateGuardianDto,
  UpdateGuardianLinkDto,
} from './dto/child.dto';
import { AuditService, auditCtx } from '../audit/audit.service';
import { ScopeService } from '../common/scope/scope.service';
import { ConsentsService } from '../consents/consents.service';

@Controller('children')
export class ChildrenController {
  constructor(
    private readonly service: ChildrenService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly consents: ConsentsService,
  ) {}

  // --- Lectura: todo el personal (educadora: sólo niños de sus salas) ---

  @UseGuards(StaffGuard)
  @Get()
  async list(
    @Req() req: any,
    @Query('includeInactive') includeInactive?: string,
    @Query('classroomId') classroomId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const classroomIds = await this.scope.classroomFilter(req.user, classroomId || undefined);
    // Paginación opcional: sólo si se pide `page` (sin él, lista completa como siempre).
    if (page !== undefined && page !== '') {
      const res = await this.service.findPage(
        { includeInactive: includeInactive === 'true', classroomIds, search: search || undefined },
        Number(page),
        Number(pageSize) || 25,
      );
      const st = await this.consents.statusForChildren(res.items.map((c) => c.id));
      return {
        ...res,
        items: res.items.map((c) => ({ ...c, consents: ConsentsService.compact(st.get(c.id)) })),
      };
    }
    const rows = await this.service.findAll({
      includeInactive: includeInactive === 'true',
      classroomIds,
      search: search || undefined,
    });
    // Estado compacto de consentimientos para los badges (una sola consulta por lote).
    const statuses = await this.consents.statusForChildren(rows.map((c) => c.id));
    return rows.map((c) => ({ ...c, consents: ConsentsService.compact(statuses.get(c.id)) }));
  }

  /**
   * Directorio de representantes (página "Representantes" y selector de hermanos).
   * Sólo coordinación/dirección: trae contacto y documento de todas las familias.
   */
  @UseGuards(CoordinatorGuard)
  @Get('guardians')
  listGuardians(@Query('q') q?: string) {
    return this.service.listAllGuardians(q || undefined);
  }

  /** Edita la cuenta de un representante: nombre, teléfono, correo, activo. */
  @UseGuards(CoordinatorGuard)
  @Patch('guardians/:guardianId')
  async updateGuardian(
    @Req() req: any,
    @Param('guardianId') guardianId: string,
    @Body() dto: UpdateGuardianDto,
  ) {
    const { before, after } = await this.service.updateGuardian(guardianId, dto);
    const deactivated = dto.active === false && before.active;
    await this.audit.record(auditCtx(req), {
      entity: 'guardian',
      entityId: guardianId,
      action: deactivated || dto.email !== undefined ? 'security' : 'update',
      summary: deactivated
        ? `Desactivó la cuenta del representante "${after.name}"`
        : `Editó los datos del representante "${after.name}"`,
      before: { name: before.name, phone: before.phone, email: before.email, active: before.active },
      after: { name: after.name, phone: after.phone, email: after.email, active: after.active },
    });
    return after;
  }

  @UseGuards(StaffGuard)
  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    await this.scope.assertChild(req.user, id);
    const [child, consents] = await Promise.all([
      this.service.findOneWithGuardians(id),
      this.consents.statusForChild(id),
    ]);
    return { ...child, consents };
  }

  // --- Escritura: coordinación y dirección ---

  @UseGuards(CoordinatorGuard)
  @Post()
  async create(@Req() req: any, @Body() dto: CreateChildDto) {
    const child = await this.service.create(dto);
    await this.audit.record(auditCtx(req), {
      entity: 'child',
      entityId: child.id,
      action: 'create',
      summary: `Inscribió a "${child.fullName}"`,
      after: { code: child.code, classroomId: child.classroomId },
    });
    return child;
  }

  @UseGuards(CoordinatorGuard)
  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateChildDto) {
    const before = await this.service.findOne(id);
    const child = await this.service.update(id, dto);
    await this.audit.record(auditCtx(req), {
      entity: 'child',
      entityId: id,
      action: 'update',
      summary: `Editó la ficha de "${child.fullName}"`,
      before: { classroomId: before.classroomId, active: before.active, allergies: before.allergies },
      after: { classroomId: child.classroomId, active: child.active, allergies: child.allergies },
    });
    return child;
  }

  /**
   * Las notas internas las puede editar cualquier educadora: son el día a día
   * ("hoy vino sin chupón", "la abuela lo retira los viernes"). Queda auditado.
   */
  @UseGuards(StaffGuard)
  @Patch(':id/notes')
  async updateNotes(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateChildDto) {
    await this.scope.assertChild(req.user, id);
    const before = await this.service.findOne(id);
    const child = await this.service.update(id, { internalNotes: dto.internalNotes ?? '' } as UpdateChildDto);
    await this.audit.record(auditCtx(req), {
      entity: 'child',
      entityId: id,
      action: 'update',
      summary: `Editó las notas internas de "${child.fullName}"`,
      before: { internalNotes: before.internalNotes || '' },
      after: { internalNotes: child.internalNotes || '' },
    });
    return { id, internalNotes: child.internalNotes };
  }

  /** Recuento de lo que se borraría (la UI lo muestra antes de pedir confirmación). */
  @UseGuards(AdminGuard)
  @Get(':id/delete-preview')
  deletePreview(@Param('id') id: string) {
    return this.service.deletionPreview(id);
  }

  /**
   * Eliminación DEFINITIVA (sólo dirección). La UI debe pedir que se escriba el nombre del
   * niño y ofrecer antes "Dar de baja" (PATCH active=false), que no borra nada.
   */
  @UseGuards(AdminGuard)
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const preview = await this.service.deletionPreview(id);
    const child = await this.service.findOne(id);
    const res = await this.service.remove(id);
    await this.audit.record(auditCtx(req), {
      entity: 'child',
      entityId: id,
      action: 'delete',
      summary: `Eliminó definitivamente la ficha de "${child.fullName}" y su historial`,
      before: {
        code: child.code,
        documentId: child.documentId,
        classroomName: child.classroomName,
        birthDate: child.birthDate,
        active: child.active,
        deleted: preview.counts,
        removedFiles: res.removedFiles,
      },
    });
    return res;
  }

  /**
   * Elimina la cuenta del representante y sus enlaces (sólo dirección).
   * 409 `{ code: 'ONLY_GUARDIAN', message, children: [{id,name}] }` si es el único
   * representante de algún niño activo; repetir con `?force=true` tras avisar.
   */
  @UseGuards(AdminGuard)
  @Delete('guardians/:guardianId')
  async removeGuardian(
    @Req() req: any,
    @Param('guardianId') guardianId: string,
    @Query('force') force?: string,
  ) {
    const res = await this.service.removeGuardian(guardianId, force === 'true');
    const orphans = res.childrenLeftWithoutGuardian.length;
    await this.audit.record(auditCtx(req), {
      entity: 'guardian',
      entityId: guardianId,
      action: 'delete',
      summary: `Eliminó la cuenta del representante "${res.guardian.name}"${
        orphans ? ` (${orphans} niño(s) quedaron sin representante)` : ''
      }`,
      before: res.guardian,
    });
    return res;
  }

  // --- Representantes del niño ---

  @UseGuards(StaffGuard)
  @Get(':id/guardians')
  async guardians(@Req() req: any, @Param('id') id: string) {
    await this.scope.assertChild(req.user, id);
    return this.service.listGuardians(id);
  }

  @UseGuards(CoordinatorGuard)
  @Post(':id/guardians')
  async linkGuardian(@Req() req: any, @Param('id') id: string, @Body() dto: LinkGuardianDto) {
    const { guardian, tempPassword, existingAccount } = await this.service.linkGuardian(id, dto);
    const child = await this.service.findOne(id);
    await this.audit.record(auditCtx(req), {
      entity: 'child',
      entityId: id,
      action: 'update',
      summary: `Enlazó a "${guardian.name}" como representante de "${child.fullName}"`,
      after: { guardianId: guardian.id, relationship: dto.relationship || '' },
    });
    return {
      guardians: await this.service.listGuardians(id),
      // Sólo se devuelve en la respuesta de creación: no queda almacenada en claro.
      credentials: tempPassword
        ? { name: guardian.name, email: guardian.email, tempPassword }
        : null,
      // Ya tenía cuenta: no se generó clave; usar "Restablecer acceso" si la perdió.
      existingAccount,
    };
  }

  @UseGuards(CoordinatorGuard)
  @Patch(':id/guardians/:linkId')
  updateLink(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @Body() dto: UpdateGuardianLinkDto,
  ) {
    return this.service.updateGuardianLink(id, linkId, dto);
  }

  @UseGuards(CoordinatorGuard)
  @Delete(':id/guardians/:linkId')
  async unlink(@Req() req: any, @Param('id') id: string, @Param('linkId') linkId: string) {
    const res = await this.service.unlinkGuardian(id, linkId);
    await this.audit.record(auditCtx(req), {
      entity: 'child',
      entityId: id,
      action: 'update',
      summary: 'Desvinculó a un representante',
    });
    return res;
  }

  /** Genera una contraseña temporal para que el representante entre al portal familiar. */
  @UseGuards(CoordinatorGuard)
  @Post('guardians/:guardianId/reset-access')
  async resetGuardianAccess(@Req() req: any, @Param('guardianId') guardianId: string) {
    const res = await this.service.resetGuardianAccess(guardianId);
    await this.audit.record(auditCtx(req), {
      entity: 'guardian',
      entityId: guardianId,
      action: 'security',
      summary: `Regeneró el acceso del representante "${res.name}"`,
    });
    return res;
  }
}
