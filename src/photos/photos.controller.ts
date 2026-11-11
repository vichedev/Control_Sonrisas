import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StaffGuard } from '../auth/roles.guard';
import { PhotosService } from './photos.service';
import { Photo, PHOTO_SUBJECTS, PhotoSubject } from './photo.entity';
import { Activity } from '../activities/activity.entity';
import { ScopeService } from '../common/scope/scope.service';

const trim = ({ value }: { value: any }) =>
  typeof value === 'string' ? value.trim() : value;

/** Máximo de imágenes por petición (el cuerpo total está limitado a 16 MB). */
const MAX_PHOTOS = 10;
const MAX_TAGS = 60;

class UploadPhotoDto {
  /** Imagen en data URL base64. */
  @IsOptional() @IsString()
  photo?: string;

  /** Varias imágenes en una sola petición (comprimidas en el cliente). */
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_PHOTOS) @IsString({ each: true })
  photos?: string[];

  @IsOptional() @IsIn(PHOTO_SUBJECTS)
  subject?: PhotoSubject;

  /** Compatibilidad: un solo niño. */
  @IsOptional() @IsUUID()
  childId?: string;

  /** Niños que salen en la foto. */
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_TAGS) @IsUUID('all', { each: true })
  childIds?: string[];

  @IsOptional() @IsUUID()
  classroomId?: string;

  @IsOptional() @IsUUID()
  activityId?: string;

  @IsOptional() @IsString() @MaxLength(10)
  date?: string;

  @IsOptional() @IsDateString()
  takenAt?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  caption?: string;

  @IsOptional() @IsBoolean()
  shareWithFamily?: boolean;
}

class UpdatePhotoDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  caption?: string;

  @IsOptional() @IsBoolean()
  shareWithFamily?: boolean;

  /** Compatibilidad: deja un solo niño (o ninguno con null). */
  @IsOptional() @IsUUID()
  childId?: string | null;

  /** Sustituye la lista de niños etiquetados ([] = foto grupal). */
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_TAGS) @IsUUID('all', { each: true })
  childIds?: string[];
}

@Controller('photos')
export class PhotosController {
  constructor(
    private readonly service: PhotosService,
    private readonly scope: ScopeService,
    @InjectRepository(Activity) private readonly activities: Repository<Activity>,
  ) {}

  /** La foto de niños se rige por sus niños; la grupal, por su sala. */
  private async assertPhoto(user: any, photo: Photo) {
    if (this.scope.isUnrestricted(user)) return;
    const tags = await this.service.tagIds(photo);
    if (photo.classroomId) {
      try {
        await this.scope.assertClassroom(user, photo.classroomId);
        return;
      } catch {
        /* puede ser de un niño suyo aunque la sala sea otra */
      }
    }
    if (!tags.length) throw new ForbiddenException('Esa foto no es de una sala a tu cargo');
    await this.scope.assertChildren(user, tags);
  }

  @UseGuards(StaffGuard)
  @Get()
  async list(
    @Req() req: any,
    @Query('date') date?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('childId') childId?: string,
    @Query('classroomId') classroomId?: string,
    @Query('activityId') activityId?: string,
    @Query('subject') subject?: PhotoSubject,
  ) {
    if (childId) await this.scope.assertChild(req.user, childId);
    // Con niño concreto ya validado, no se filtra por sala (la foto puede ser de otra sala).
    const classroomIds = childId && !classroomId ? undefined : await this.scope.classroomFilter(req.user, classroomId);
    return this.service.list({ date, from, to, childId, classroomIds, activityId, subject });
  }

  /**
   * Sube una o varias fotos con los niños que aparecen.
   * 403 `{ message, blocked: [{id,name}] }` si algún niño no tiene autorización de imagen.
   * Respuesta: `{ url, photos: [...] }` (`url` = la primera, por compatibilidad).
   */
  @UseGuards(StaffGuard)
  @Post()
  async upload(@Req() req: any, @Body() dto: UploadPhotoDto) {
    const images = [...(dto.photos || []), ...(dto.photo ? [dto.photo] : [])];
    if (!images.length) throw new BadRequestException('Falta la foto');
    if (images.length > MAX_PHOTOS) throw new BadRequestException(`Máximo ${MAX_PHOTOS} fotos por envío`);
    const childIds = [...new Set([...(dto.childIds || []), ...(dto.childId ? [dto.childId] : [])])];

    await this.scope.assertChildren(req.user, childIds);
    if (dto.classroomId) await this.scope.assertClassroom(req.user, dto.classroomId);
    if (dto.activityId) {
      const activity = await this.activities.findOne({ where: { id: dto.activityId }, select: ['id', 'classroomId'] });
      if (!activity) throw new NotFoundException('Actividad no encontrada');
      if (!this.scope.isUnrestricted(req.user)) await this.scope.assertClassroom(req.user, activity.classroomId);
    }
    if (!dto.classroomId && !childIds.length && !dto.activityId && !this.scope.isUnrestricted(req.user)) {
      throw new BadRequestException('Indica la sala o los niños de la foto');
    }

    const subject: PhotoSubject =
      dto.subject || (dto.activityId ? 'activity' : childIds.length ? 'moment' : 'general');
    let photos;
    try {
      photos = await this.service.createTagged({
        photos: images,
        childIds,
        subject,
        classroomId: dto.classroomId || null,
        activityId: dto.activityId || null,
        date: dto.date,
        caption: dto.caption,
        takenAt: dto.takenAt ? new Date(dto.takenAt) : null,
        shareWithFamily: dto.shareWithFamily,
        actorId: req.user?.id,
        actorName: req.user?.name,
      });
    } catch (e: any) {
      if (e?.getStatus) throw e;
      throw new BadRequestException(e?.message || 'No se pudo guardar la foto');
    }
    return { url: photos[0]?.url || '', photos };
  }

  @UseGuards(StaffGuard)
  @Patch(':id')
  async update(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePhotoDto) {
    await this.assertPhoto(req.user, await this.service.findOne(id));
    const next = dto.childIds ?? (dto.childId ? [dto.childId] : []);
    await this.scope.assertChildren(req.user, next);
    return this.service.update(id, dto);
  }

  /** Dirección/coordinación borran cualquiera; la educadora, las que subió ella. */
  @UseGuards(StaffGuard)
  @Delete(':id')
  async remove(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const photo = await this.service.findOne(id);
    if (!this.scope.isUnrestricted(req.user)) {
      if (photo.uploadedById !== req.user?.id) {
        throw new ForbiddenException('Sólo puedes borrar las fotos que subiste');
      }
      await this.assertPhoto(req.user, photo);
    }
    return this.service.remove(id);
  }
}
