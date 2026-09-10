import { basename } from 'node:path';

export function includeCheckoutPath(source: string): boolean {
  // Normalize both native path styles so exclusions also work on Windows.
  const name = basename(source.replaceAll('\\', '/'));
  return !['node_modules', '.git', 'dist', 'test-results', 'playwright-report'].includes(name);
}

export function pnpmInvocation(node: string, cli: string | undefined, args: string[]) {
  if (!cli) throw new Error('Run the contributor suite through pnpm so npm_execpath identifies its CLI');
  // Launch the JavaScript CLI directly: Windows cannot spawn a .cmd shim without a shell.
  if (/\.[cm]?js$/i.test(cli)) return { command: node, args: [cli, ...args] };
  // Standalone pnpm distributions expose a native executable through npm_execpath.
  return { command: cli, args };
}
