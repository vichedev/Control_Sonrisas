import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { RealtimeEvent } from './realtime.types';

/**
 * Bus de eventos interno. Cualquier módulo puede escuchar `events$`
 * (tiempo real hacia los navegadores, notificaciones por WhatsApp…).
 */
@Injectable()
export class RealtimeService {
  private readonly subject = new Subject<RealtimeEvent>();
  readonly events$: Observable<RealtimeEvent> = this.subject.asObservable();

  emit(event: RealtimeEvent): void {
    this.subject.next(event);
  }
}
