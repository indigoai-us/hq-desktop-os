import { describe, expect, it } from 'vitest';
import { isAllowedNavigation } from '../../src/main/navigation';
describe('desktop navigation boundary', () => {
  const preview = 'http://127.0.0.1:4173';
  it('permits renderer routes and fragments', () => {
    expect(isAllowedNavigation(`${preview}/setup#details`, preview)).toBe(true);
    expect(isAllowedNavigation('file:///app/index.html#setup', 'file:///app/index.html')).toBe(true);
  });
  it.each(['https://example.com', 'http://127.0.0.1:4174', 'http://127.0.0.1.evil.test:4173', 'javascript:alert(1)', 'data:text/html,hello', 'invalid'])('rejects foreign destinations: %s', (url) => {
    expect(isAllowedNavigation(url, preview)).toBe(false);
  });
  it('prevents packaged navigation to other files or remote hosts', () => {
    expect(isAllowedNavigation('file:///etc/passwd', 'file:///app/index.html')).toBe(false);
    expect(isAllowedNavigation('file://evil/app/index.html', 'file:///app/index.html')).toBe(false);
  });
});
