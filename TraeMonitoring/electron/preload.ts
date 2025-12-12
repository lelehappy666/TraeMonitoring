import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  onUsageDataUpdate: (callback: (data: unknown) => void) =>
    ipcRenderer.on('usage-data-update', (_event, value) => callback(value)),
  onConfigUpdate: (callback: (config: unknown) => void) =>
    ipcRenderer.on('config-update', (_event, value) => callback(value)),
  getUsageData: () => ipcRenderer.invoke('get-usage-data'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateRefreshInterval: (seconds: number) => ipcRenderer.invoke('update-refresh-interval', seconds),
  resetLogin: () => ipcRenderer.invoke('reset-login'),
  resetLoginActive: () => ipcRenderer.invoke('reset-login'),
  refreshNow: () => ipcRenderer.invoke('refresh-now'),
  getActiveDays: () => ipcRenderer.invoke('get-active-days'),
  refreshActiveDays: () => ipcRenderer.invoke('refresh-active-days'),
  getLoginStatus: () => ipcRenderer.invoke('get-login-status'),
  openActiveWindow: () => ipcRenderer.invoke('open-active-window'),
  showLiveCalendar: () => ipcRenderer.invoke('show-live-calendar'),
  getWindowBounds: () => ipcRenderer.invoke('get-window-bounds'),
  setWindowSize: (size: { width: number; height: number }) => ipcRenderer.invoke('set-window-size', size),
  setResizing: (flag: boolean) => ipcRenderer.send('set-resizing', flag),
  setWindowPosition: (pos: { x: number; y: number }) =>
    ipcRenderer.send('set-window-position', pos),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  removeListener: (channel: string) => ipcRenderer.removeAllListeners(channel),
});
