import { app, BrowserWindow, Menu, nativeImage, protocol, session, Tray } from 'electron';
import { join, resolve } from 'node:path';
import { isReviewedHttpsLink } from '../shared/platform.js';
import { APP_ENTRY_URL, APP_SCHEME, serveAppAsset } from './app-protocol.js';
import { DEVELOPMENT_CSP, PACKAGED_CSP } from './csp.js';
import { openReviewedExternal, registerPlatformIpc } from './ipc.js';
import { ShutdownGate } from './shutdown.js';
import { CompanionService } from './companion.js';
import { installApplicationMenu } from './menu.js';
import { isAllowedNavigation } from './navigation.js';

let companionService: CompanionService | undefined;
let tray: Tray | undefined;
let quitting = false;

/**
 * Must run before `app.whenReady()`. Registering `app:` as a standard, secure
 * scheme is what gives the packaged document a real origin, so CSP `'self'`
 * names this app's assets rather than the whole local filesystem.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      codeCache: true,
    },
  },
]);

/** The only directory the renderer scheme may ever serve from. */
function rendererRootDir(): string {
  return resolve(join(__dirname, '..', 'renderer'));
}

function registerAppProtocol(): void {
  const rootDir = rendererRootDir();
  protocol.handle(APP_SCHEME, (request) => serveAppAsset(request, rootDir));
}

function rendererEntryUrl(): string {
  return app.isPackaged ? APP_ENTRY_URL : 'http://127.0.0.1:4173';
}

/**
 * Second layer over the policy the `app://` handler already delivers: this
 * covers the development renderer, which is served by Vite rather than by the
 * handler. Any policy already on the response is dropped first, whatever its
 * header casing, so a response can never carry two policies that could drift.
 */
function applyContentSecurityPolicy(isPackaged: boolean): void {
  const policy = isPackaged ? PACKAGED_CSP : DEVELOPMENT_CSP;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = Object.fromEntries(
      Object.entries(details.responseHeaders ?? {}).filter(
        ([name]) => name.toLowerCase() !== 'content-security-policy',
      ),
    );
    headers['Content-Security-Policy'] = [policy];
    callback({ responseHeaders: headers });
  });
}

async function createWindow(rendererUrl: string): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1024,
    height: 700,
    minWidth: 640,
    minHeight: 480,
    // Native OS frame: the platform supplies the titlebar, the window controls,
    // dragging, edge resize, snapping and screen-reader window semantics. The
    // app draws none of that itself.
    frame: true,
    title: 'HQ',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // File System Access (showOpenFilePicker / showDirectoryPicker /
      // showSaveFilePicker) would be a second, untyped route to the host
      // filesystem beside PlatformClient. It is switched off at the Blink
      // level, and the session permission handlers deny `fileSystem` as well.
      disableBlinkFeatures: 'FileSystemAccess,FileSystemAccessLocal',
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isReviewedHttpsLink(url)) {
      void openReviewedExternal(url).then((result) => {
        if (!result.ok) {
          console.error('Could not open external link:', result.error.code, result.error.message);
        }
      });
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, rendererUrl)) event.preventDefault();
  });

  // Chromium commits some renderer-initiated navigations (notably about:blank)
  // without ever raising will-navigate, so the window is also pulled back if it
  // ever ends up anywhere other than the app renderer.
  const restoreRenderer = (url: string) => {
    if (isAllowedNavigation(url, rendererUrl)) return;
    void window.webContents.loadURL(rendererUrl);
  };
  window.webContents.on('did-navigate', (_event, url) => restoreRenderer(url));
  window.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) restoreRenderer(url);
  });

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  window.on('close', event => {
    if (!quitting && tray && companionService?.preferences.state.closeToTray) { event.preventDefault(); window.hide(); }
  });
  await window.loadURL(rendererUrl);
  return window;
}

const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
});

void app.whenReady().then(async () => {
  if (!ownsInstance) return;
  const rendererUrl = rendererEntryUrl();
  if (app.isPackaged) registerAppProtocol();
  applyContentSecurityPolicy(app.isPackaged);
  installApplicationMenu(app.isPackaged);
  const companion = new CompanionService(); companionService = companion;
  await companion.initialize();

  const shutdown = new ShutdownGate(() => companion.shutdown(), () => app.quit());
  app.on('before-quit', event => { quitting = true; shutdown.handle(event); });
  registerPlatformIpc(rendererUrl, companion);

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  await createWindow(rendererUrl);
  const showWindow = () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
    else void createWindow(rendererUrl).catch(error => console.error('HQ window could not be opened', error instanceof Error ? error.name : 'unknown'));
  };
  try {
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'build/icon.png')).resize({ width: 22, height: 22 });
    if (icon.isEmpty()) throw new Error('Tray icon is missing');
    tray = new Tray(icon); companion.trayAvailable = true; tray.setToolTip('HQ'); tray.on('click', showWindow);
    const updateTray = () => tray?.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open HQ', click: showWindow },
      { label: 'Pause sync', enabled: companion.sync.running, click: () => { void companion.request({ action: 'pause-sync' }).catch(error => console.error('Sync could not be paused', error instanceof Error ? error.name : 'unknown')); } },
      { type: 'separator' }, { label: 'Quit HQ', click: () => app.quit() },
    ]));
    updateTray(); const timer = setInterval(updateTray, 5000);
    app.once('will-quit', () => { clearInterval(timer); tray?.destroy(); tray = undefined; });
  } catch (error) { console.error('HQ tray is unavailable', error instanceof Error ? error.name : 'unknown'); }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow(rendererUrl);
    }
  });
}).catch((error: unknown) => {
  console.error('Could not start HQ Desktop OS:', error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && (!tray || !companionService?.preferences.state.closeToTray)) app.quit();
});
