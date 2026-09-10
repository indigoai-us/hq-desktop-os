import { contextBridge } from 'electron';
// No IPC or privileged capabilities are exposed by the foundation.
contextBridge.exposeInMainWorld('hqDesktop', Object.freeze({ version: '0.1.0' }));
