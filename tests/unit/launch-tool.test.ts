import { describe, expect, it } from 'vitest';
import { win32 } from 'node:path';
import { windowsTerminalPath } from '../../src/main/launch-tool';
describe('Windows terminal executable trust', () => {
  it('uses the absolute installed app alias, never searches a workspace for wt.exe', () => {
    const executable = windowsTerminalPath('C:\\Users\\Example\\AppData\\Local');
    expect(win32.isAbsolute(executable)).toBe(true);
    expect(executable).toBe('C:\\Users\\Example\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe');
  });
  it('fails closed if the OS install location is missing or relative', () => {
    for (const value of [undefined, '', '.', 'workspace']) expect(() => windowsTerminalPath(value)).toThrow('unavailable');
  });
});
