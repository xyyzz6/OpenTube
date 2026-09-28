// 内置浏览器页面 preload：暴露下载桥接（沙箱模式仅用 contextBridge + ipcRenderer）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('opentubePage', {
  download: (url) => ipcRenderer.send('page:download', String(url || ''))
});
