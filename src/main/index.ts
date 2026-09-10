import { app, BrowserWindow, session } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isAllowedNavigation } from './navigation.js';

async function createWindow(): Promise<void> {
  const rendererUrl = app.isPackaged
    ? pathToFileURL(join(__dirname, '../renderer/index.html')).href
    : 'http://127.0.0.1:4173';
  const window = new BrowserWindow({
    width: 1024, height: 700, minWidth: 640, minHeight: 480,
    title: 'HQ Desktop OS',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, rendererUrl)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  await window.loadURL(rendererUrl);
}

void app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch((error: unknown) => {
  console.error('Could not start HQ Desktop OS:', error);
  app.exit(1);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
