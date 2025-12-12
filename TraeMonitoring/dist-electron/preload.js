"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    onUsageDataUpdate: (callback) => electron_1.ipcRenderer.on('usage-data-update', (_event, value) => callback(value)),
    onConfigUpdate: (callback) => electron_1.ipcRenderer.on('config-update', (_event, value) => callback(value)),
    getUsageData: () => electron_1.ipcRenderer.invoke('get-usage-data'),
    getConfig: () => electron_1.ipcRenderer.invoke('get-config'),
    updateRefreshInterval: (seconds) => electron_1.ipcRenderer.invoke('update-refresh-interval', seconds),
    resetLogin: () => electron_1.ipcRenderer.invoke('reset-login'),
    resetLoginActive: () => electron_1.ipcRenderer.invoke('reset-login'),
    refreshNow: () => electron_1.ipcRenderer.invoke('refresh-now'),
    getActiveDays: () => electron_1.ipcRenderer.invoke('get-active-days'),
    refreshActiveDays: () => electron_1.ipcRenderer.invoke('refresh-active-days'),
    getLoginStatus: () => electron_1.ipcRenderer.invoke('get-login-status'),
    openActiveWindow: () => electron_1.ipcRenderer.invoke('open-active-window'),
    showLiveCalendar: () => electron_1.ipcRenderer.invoke('show-live-calendar'),
    getWindowBounds: () => electron_1.ipcRenderer.invoke('get-window-bounds'),
    setWindowSize: (size) => electron_1.ipcRenderer.invoke('set-window-size', size),
    setResizing: (flag) => electron_1.ipcRenderer.send('set-resizing', flag),
    setWindowPosition: (pos) => electron_1.ipcRenderer.send('set-window-position', pos),
    openExternal: (url) => electron_1.ipcRenderer.send('open-external', url),
    removeListener: (channel) => electron_1.ipcRenderer.removeAllListeners(channel),
});
//# sourceMappingURL=preload.js.map