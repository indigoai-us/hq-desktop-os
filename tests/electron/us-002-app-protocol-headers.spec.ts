import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { APP_ENTRY_URL, APP_ORIGIN } from '../../src/main/app-protocol';
import { PACKAGED_CSP } from '../../src/main/csp';
import { launchProductionApp } from './runtime';

/**
 * What the packaged renderer's own origin actually delivers.
 *
 * A `<meta>` CSP is required to ignore `frame-ancestors`, so reading the
 * policy out of the shipped HTML cannot show that framing is refused. These
 * assertions read the headers Chromium received for real `app://` responses —
 * successful, refused and not-found alike — and then try to frame the
 * application document from inside itself.
 */
let app: ElectronApplication;
let appWindow: Page;

interface ProbeResult {
  readonly status: number;
  readonly csp: string | null;
  readonly nosniff: string | null;
  readonly contentType: string | null;
  readonly contentLength: string | null;
  readonly allow: string | null;
  readonly bodyBytes: number;
  readonly bodyText: string;
}

async function probe(url: string, method = 'GET'): Promise<ProbeResult> {
  return appWindow.evaluate(async ([target, verb]) => {
    const response = await fetch(target!, { method: verb });
    const body = await response.arrayBuffer();
    return {
      status: response.status,
      csp: response.headers.get('content-security-policy'),
      nosniff: response.headers.get('x-content-type-options'),
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length'),
      allow: response.headers.get('allow'),
      bodyBytes: body.byteLength,
      bodyText: new TextDecoder().decode(body),
    };
  }, [url, method]);
}

test.beforeAll(async () => {
  ({ app, window: appWindow } = await launchProductionApp());
});

test.afterAll(async () => {
  await app?.close();
});

test.describe('US-002 app:// response headers', () => {
  test('serves the renderer from its own origin', async () => {
    const url = await appWindow.evaluate(() => window.location.href);
    expect(url).toBe(APP_ENTRY_URL);
    expect(await appWindow.evaluate(() => window.origin)).toBe(APP_ORIGIN);
  });

  test('delivers the packaged CSP with a served asset', async () => {
    const result = await probe(APP_ENTRY_URL);
    expect(result.status).toBe(200);
    expect(result.csp).toBe(PACKAGED_CSP);
    expect(result.nosniff).toBe('nosniff');
    expect(result.contentType).toBe('text/html; charset=utf-8');
    expect(result.bodyBytes).toBeGreaterThan(0);
  });

  test('delivers the packaged CSP with every refusal Chromium can reach', async () => {
    const cases: Array<[string, number]> = [
      [`${APP_ORIGIN}/index.html?x=1`, 400],
      [`${APP_ORIGIN}/index.html%00.png`, 400],
      [`${APP_ORIGIN}//attacker-share/payload.js`, 403],
      [`${APP_ORIGIN}/C:/Windows/win.ini`, 403],
      [`${APP_ORIGIN}/index.html.map`, 403],
      [`${APP_ORIGIN}/does-not-exist.html`, 404],
    ];
    for (const [url, status] of cases) {
      const result = await probe(url);
      expect(result.status, url).toBe(status);
      expect(result.csp, url).toBe(PACKAGED_CSP);
      expect(result.nosniff, url).toBe('nosniff');
      expect(result.bodyBytes, url).toBe(0);
    }
  });

  test('refuses every method that is not a read, and answers HEAD without a body', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const result = await probe(APP_ENTRY_URL, method);
      expect(result.status, method).toBe(405);
      expect(result.allow, method).toBe('GET, HEAD');
      expect(result.csp, method).toBe(PACKAGED_CSP);
      expect(result.bodyBytes, method).toBe(0);
      expect(result.bodyText, method).not.toContain('<html');
    }

    const head = await probe(APP_ENTRY_URL, 'HEAD');
    const get = await probe(APP_ENTRY_URL);
    expect(head.status).toBe(200);
    expect(head.bodyBytes).toBe(0);
    expect(head.contentType).toBe(get.contentType);
    expect(Number(head.contentLength)).toBe(get.bodyBytes);
  });

  test('refuses to be framed, and the framed document never renders', async () => {
    // The top-level document renders its heading; a frame of the same document
    // must not, because frame-ancestors 'none' arrives on the response.
    expect(await appWindow.evaluate(() => document.querySelector('h1')?.textContent)).toBe(
      'Your desktop companion',
    );

    const framed = await appWindow.evaluate(async (target) => {
      const frame = document.createElement('iframe');
      frame.id = 'hq-framing-probe';
      frame.src = target;
      const settled = new Promise<string>((resolve) => {
        frame.addEventListener('load', () => resolve('load'), { once: true });
        frame.addEventListener('error', () => resolve('error'), { once: true });
        setTimeout(() => resolve('timeout'), 5_000);
      });
      document.body.appendChild(frame);
      const outcome = await settled;
      let heading: string | null = null;
      let denied = false;
      try {
        heading = frame.contentDocument?.querySelector('h1')?.textContent ?? null;
      } catch {
        denied = true;
      }
      return { outcome, heading, denied };
    }, APP_ENTRY_URL);

    expect(framed.heading).toBeNull();

    // The main process is authoritative about what the child frame holds.
    const childFrames = await app.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]!.webContents;
      const results: Array<{ url: string; heading: string | null }> = [];
      for (const frame of contents.mainFrame.frames) {
        let heading: string | null = null;
        try {
          heading = (await frame.executeJavaScript(
            'document.querySelector("h1") ? document.querySelector("h1").textContent : null',
          )) as string | null;
        } catch {
          heading = null;
        }
        results.push({ url: frame.url, heading });
      }
      return results;
    });

    expect(childFrames.length).toBeGreaterThan(0);
    for (const frame of childFrames) {
      expect(frame.heading, frame.url).toBeNull();
    }

    await appWindow.evaluate(() => document.getElementById('hq-framing-probe')?.remove());
  });
});
