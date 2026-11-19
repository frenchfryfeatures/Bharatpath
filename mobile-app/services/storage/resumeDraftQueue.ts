/** Serialize autosaves and coalesce intermediate edits. No network requests run in parallel. */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
export class ResumeDraftQueue<T> {
  private latest: T;
  private savedKey: string | null;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(initial: T, saved: boolean, private write: (value: T) => Promise<unknown>, private status: (state: SaveState, error?: unknown) => void, private delay = 700) {
    this.latest = initial;
    this.savedKey = saved ? JSON.stringify(initial) : null;
  }
  get value() { return this.latest; }
  get dirty() { return JSON.stringify(this.latest) !== this.savedKey; }
  enqueue(value: T) {
    this.latest = value;
    if (this.timer)
      clearTimeout(this.timer);
    if (!this.dirty)
      return;
    if (!this.running)
      this.status('idle');
    this.timer = setTimeout(() => { this.timer = null; void this.flush().catch(() => { }); }, this.delay);
  }
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.running) {
      await this.running;
      if (this.dirty)
        return this.flush();
      return;
    }
    if (!this.dirty)
      return;
    const drain = async () => {
      try {
        while (this.dirty) {
          const value = this.latest;
          const key = JSON.stringify(value);
          this.status('saving');
          await this.write(value);
          this.savedKey = key;
        }
        this.status('saved');
      }
      catch (error) {
        this.status('error', error);
        throw error;
      }
    };
    this.running = drain();
    try {
      await this.running;
    }
    finally {
      this.running = null;
    }
  }
  dispose() {
    if (this.timer)
      clearTimeout(this.timer); this.timer = null;
  }
}
