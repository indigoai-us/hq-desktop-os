import { expect, it, vi } from 'vitest';
import { ShutdownGate } from '../../src/main/shutdown';
it('repeated quit attempts cannot overtake an owned process shutdown', async () => {
  let finish!: () => void; const pending = new Promise<void>(resolve => { finish = resolve; });
  const stop = vi.fn(() => pending); const quit = vi.fn(); const event = { preventDefault: vi.fn() };
  const gate = new ShutdownGate(stop, quit); gate.handle(event); gate.handle(event);
  expect(event.preventDefault).toHaveBeenCalledTimes(2); expect(stop).toHaveBeenCalledTimes(1); expect(quit).not.toHaveBeenCalled();
  finish(); await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce()); gate.handle(event);
  expect(event.preventDefault).toHaveBeenCalledTimes(2);
});
