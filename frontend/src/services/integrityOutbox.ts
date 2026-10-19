export interface IntegrityEvent {
  attemptId: string;
  body: { event_id: string; [field: string]: unknown };
}
type EventStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
export const INTEGRITY_QUEUED = 'eraedu:integrity-queued';
export const INTEGRITY_SAVED = 'eraedu:integrity-saved';

// One storage key per event avoids overwriting another tab's event list.
// No credentials/answers are stored. Server ownership and event-id uniqueness
// remain authoritative; simultaneous tabs may safely retry the same event.
export class IntegrityOutbox {
  private storage: EventStorage;
  private prefix: string;
  private running = false;
  private retry = new Map<string, { failures: number; at: number }>();
  constructor(storage: EventStorage, userId: string) {
    if (!userId) throw new Error('Sign in to save monitoring reports');
    this.storage = storage;
    this.prefix = `eraedu:integrity:v1:${encodeURIComponent(userId)}:`;
  }
  private eventKey(event: IntegrityEvent) {
    return `${this.prefix}${encodeURIComponent(event.attemptId)}:${encodeURIComponent(event.body.event_id)}`;
  }
  enqueue(event: IntegrityEvent) {
    if (!event.attemptId || !event.body.event_id) throw new Error('Monitoring report identity is missing');
    const key = this.eventKey(event);
    if (this.storage.getItem(key) === null) this.storage.setItem(key, JSON.stringify(event));
  }
  pending(): IntegrityEvent[] {
    const events: IntegrityEvent[] = [];
    for (let index = 0; index < this.storage.length; index++) {
      const key = this.storage.key(index);
      if (!key?.startsWith(this.prefix)) continue;
      const raw = this.storage.getItem(key);
      if (raw === null) continue;
      const event = JSON.parse(raw) as IntegrityEvent;
      if (!event?.attemptId || !event.body?.event_id || this.eventKey(event) !== key) {
        throw new Error('A stored monitoring report could not be read. Contact support; it has not been discarded.');
      }
      events.push(event);
    }
    return events;
  }
  async flush(send: (event: IntegrityEvent) => Promise<void>, active = () => true, force = false, now = Date.now()) {
    if (this.running) return;
    this.running = true;
    try {
      for (const event of this.pending()) {
        if (!active()) return;
        const key = this.eventKey(event);
        const previous = this.retry.get(key);
        if (!force && previous && previous.at > now) continue;
        try {
          await send(event);
          // Only a confirmed successful server response permits deletion.
          this.storage.removeItem(key);
          this.retry.delete(key);
        } catch (error: any) {
          const failures = (previous?.failures || 0) + 1;
          const status = error?.response?.status;
          this.retry.set(key, { failures, at: status === 401 || status === 403 || status === 400
            ? Infinity : now + Math.min(60_000, 1000 * 2 ** Math.min(failures, 6)) });
        }
      }
    } finally { this.running = false; }
  }
}

export function queueIntegrityEvent(userId: string, event: IntegrityEvent) {
  new IntegrityOutbox(window.localStorage, userId).enqueue(event);
  window.dispatchEvent(new Event(INTEGRITY_QUEUED));
}
