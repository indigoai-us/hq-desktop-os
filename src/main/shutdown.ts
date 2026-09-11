/** Every quit attempt stays blocked until the same owned cleanup completes. */
export class ShutdownGate {
  started = false;
  private complete = false;
  constructor(private readonly stop: () => Promise<void>, private readonly quit: () => void) {}
  handle(event: { preventDefault(): void }): void {
    if (this.complete) return;
    event.preventDefault();
    if (this.started) return;
    this.started = true;
    void this.stop().catch((error: unknown) => { console.error('HQ shutdown failed', error instanceof Error ? error.name : 'unknown'); }).finally(() => { this.complete = true; this.quit(); });
  }
}
