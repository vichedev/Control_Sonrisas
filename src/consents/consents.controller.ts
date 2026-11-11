import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminGuard, CoordinatorGuard, GuardianGuard, StaffGuard } from '../auth/roles.guard';
import { ScopeService } from '../common/scope/scope.service';
import { auditCtx } from '../audit/audit.service';
import { ChildGuardian } from '../children/child-guardian.entity';
import { Child } from '../children/child.entity';
import { ConsentsService } from './consents.service';
import { FamilyConsentBatchDto, FamilyConsentDto, PublishPolicyDto, StaffConsentDto } from './consents.dto';
import { CONSENT_TYPES, ConsentType } from './consent.types';

const LEGAL_REP_MSG = 'Debe confirmar que es el representante legal del niño o niña';

/** Portal familiar: cada representante decide sólo por sus niños. */
@UseGuards(GuardianGuard)
@Controller('family/consents')
export class FamilyConsentsController {
  constructor(
    private readonly service: ConsentsService,
    @InjectRepository(ChildGuardian) private readonly links: Repository<ChildGuardian>,
  ) {}

  @Get()
  mine(@Req() req: any) {
    return this.service.forGuardian(req.user.id);
  }

  @Get('history')
  history(@Req() req: any) {
    return this.service.historyForGuardian(req.user.id);
  }

  private async assertMine(guardianId: string, childId: string) {
    const link = await this.links.findOne({ where: { guardianId, childId } });
    if (!link) throw new NotFoundException('Niño no encontrado');
  }

  private decide(req: any, d: { childId: string; type: ConsentType; granted: boolean }) {
    const ctx = auditCtx(req);
    return this.service.record(
      {
        childId: d.childId,
        type: d.type,
        granted: d.granted,
        method: 'portal',
        guardianId: req.user.id,
        guardianName: req.user.name,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      ctx,
    );
  }

  @Post()
  async record(@Req() req: any, @Body() dto: FamilyConsentDto) {
    if (!dto.legalRepresentative) throw new BadRequestException(LEGAL_REP_MSG);
    await this.assertMine(req.user.id, dto.childId);
    const { consents } = await this.decide(req, dto);
    return { childId: dto.childId, consents };
  }

  /** Flujo inicial: todas las decisiones pendientes de una vez. */
  @Post('batch')
  async batch(@Req() req: any, @Body() dto: FamilyConsentBatchDto) {
    if (!dto.legalRepresentative) throw new BadRequestException(LEGAL_REP_MSG);
    for (const d of dto.decisions) await this.assertMine(req.user.id, d.childId);
    for (const d of dto.decisions) await this.decide(req, d);
    return this.service.forGuardian(req.user.id);
  }
}

/** Personal: consulta de estados; coordinación registra formularios en papel; dirección edita textos. */
@Controller('consents')
export class ConsentsController {
  constructor(
    private readonly service: ConsentsService,
    private readonly scope: ScopeService,
    @InjectRepository(Child) private readonly children: Repository<Child>,
  ) {}

  /** Estado por niño. La educadora sólo ve sus salas (sabe a quién puede fotografiar). */
  @UseGuards(StaffGuard)
  @Get('children')
  async list(
    @Req() req: any,
    @Query('classroomId') classroomId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const classroomIds = await this.scope.classroomFilter(req.user, classroomId || undefined);
    return this.service.childrenWithStatus({ classroomIds, includeInactive: includeInactive === 'true' });
  }

  /** Niños de una sala que NO deben aparecer en una foto grupal. */
  @UseGuards(StaffGuard)
  @Get('classrooms/:classroomId/photo-check')
  async photoCheck(@Req() req: any, @Param('classroomId', ParseUUIDPipe) classroomId: string) {
    await this.scope.assertClassroom(req.user, classroomId);
    return this.service.classroomPhotoCheck(classroomId);
  }

  @UseGuards(StaffGuard)
  @Get('children/:childId')
  async detail(@Req() req: any, @Param('childId', ParseUUIDPipe) childId: string) {
    await this.scope.assertChild(req.user, childId);
    const child = await this.children.findOne({ where: { id: childId }, relations: ['classroom'] });
    if (!child) throw new NotFoundException('Niño no encontrado');
    const full = this.scope.isUnrestricted(req.user);
    const [consents, history, guardians] = await Promise.all([
      this.service.statusForChild(childId),
      this.service.history(childId),
      full ? this.service.guardiansOf(childId) : Promise.resolve([]),
    ]);
    return {
      child: {
        id: child.id,
        name: `${child.firstName} ${child.lastName}`.trim(),
        photoUrl: child.photoUrl,
        classroomId: child.classroomId,
        classroomName: child.classroom?.name || '',
      },
      consents,
      // IP y navegador sólo para coordinación/dirección (prueba del consentimiento).
      history: full ? history : history.map(({ ip: _ip, userAgent: _ua, ...r }) => r),
      guardians,
    };
  }

  @UseGuards(CoordinatorGuard)
  @Post('children/:childId')
  async recordPaper(
    @Req() req: any,
    @Param('childId', ParseUUIDPipe) childId: string,
    @Body() dto: StaffConsentDto,
  ) {
    const ctx = auditCtx(req);
    return this.service.record(
      {
        childId,
        type: dto.type,
        granted: dto.granted,
        method: 'presencial',
        guardianId: dto.guardianId || null,
        guardianName: dto.guardianName || '',
        recordedById: req.user.id,
        recordedByName: req.user.name,
        note: dto.note,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      ctx,
    );
  }

  @UseGuards(CoordinatorGuard)
  @Get('summary')
  summary(@Query('classroomId') classroomId?: string) {
    return this.service.summary(classroomId ? [classroomId] : undefined);
  }

  /** Textos vigentes; `?history=true` (dirección) trae todas las versiones. */
  @UseGuards(StaffGuard)
  @Get('policies')
  policies(@Req() req: any, @Query('history') history?: string) {
    if (history === 'true' && req.user?.role === 'admin') return this.service.policyHistory();
    return this.service.currentPolicies();
  }

  @UseGuards(AdminGuard)
  @Put('policies/:type')
  publish(@Req() req: any, @Param('type') type: string, @Body() dto: PublishPolicyDto) {
    if (!CONSENT_TYPES.includes(type as ConsentType)) throw new BadRequestException('Tipo de consentimiento inválido');
    return this.service.publishPolicy(type as ConsentType, dto, req.user, auditCtx(req));
  }
}
