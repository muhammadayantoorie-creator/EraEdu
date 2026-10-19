// One create operation retains its identity after a lost/failed response.
// A changed draft or a newly opened form starts a separate operation.
export class ExamSaveSession {
  private busy = false;
  private draft: { signature: string; key: string } | null = null;
  private newKey: () => string;

  constructor(newKey = () => crypto.randomUUID()) { this.newKey = newKey; }
  get isSaving() { return this.busy; }
  reset() { if (!this.busy) this.draft = null; }

  async submit<T>(payload: unknown, create: boolean, save: (key?: string) => Promise<T>) {
    if (this.busy) return { started: false as const };
    this.busy = true;
    try {
      let key: string | undefined;
      if (create) {
        const signature = JSON.stringify(payload);
        if (this.draft?.signature !== signature) this.draft = { signature, key: this.newKey() };
        key = this.draft.key;
      }
      return { started: true as const, value: await save(key) };
    } finally { this.busy = false; }
  }
}
