import { describe, expect, it } from 'vitest';
import { includeCheckoutPath, pnpmInvocation } from '../helpers/contributor';

describe('portable contributor checkout', () => {
  it.each(['node_modules', '.git', 'dist', 'test-results', 'playwright-report'])('excludes %s on both platforms', (name) => {
    expect(includeCheckoutPath(`/tmp/checkout/${name}`)).toBe(false);
    expect(includeCheckoutPath(`C:\\work\\checkout\\${name}`)).toBe(false);
  });
  it('preserves source files in both path styles', () => {
    expect(includeCheckoutPath('/tmp/checkout/src/main.ts')).toBe(true);
    expect(includeCheckoutPath('C:\\work\\src\\main.ts')).toBe(true);
  });
  it('passes CLI paths and arguments as literal process arguments', () => {
    const cli = 'C:\\Program Files\\pnpm\\bin\\pnpm.cjs';
    expect(pnpmInvocation('node.exe', cli, ['install', '--offline'])).toEqual({
      command: 'node.exe', args: [cli, 'install', '--offline'],
    });
    expect(pnpmInvocation('node', '/opt/pnpm', ['--version'])).toEqual({
      command: '/opt/pnpm', args: ['--version'],
    });
    expect(pnpmInvocation('node.exe', 'C:/pnpm/pnpm.exe', [])).toEqual({
      command: 'C:/pnpm/pnpm.exe', args: [],
    });
    expect(() => pnpmInvocation('node', undefined, [])).toThrow('through pnpm');
  });
});
