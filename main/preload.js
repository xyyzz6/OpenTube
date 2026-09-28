// 渲染进程桥接 API
const { contextBridge, ipcRenderer } = require('electron');

const JOB_CHANNELS = ['jobs'];
const SAFE_EVENTS = ['jobs', 'sniffed', 'browser:url', 'browser:buttons'];

contextBridge.exposeInMainWorld('opentube', {
  getInfo: (url) => ipcRenderer.invoke('info:get', url),
  enqueue: (tasks) => ipcRenderer.invoke('queue:enqueue', tasks),
  listJobs: () => ipcRenderer.invoke('queue:list'),
  jobAction: (action, id) => ipcRenderer.invoke('queue:action', { action, id }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  listPresets: () => ipcRenderer.invoke('presets:list'),
  engineStatus: () => ipcRenderer.invoke('engines:status'),
  updateYtDlp: () => ipcRenderer.invoke('yt-dlp:update'),
  chooseDir: () => ipcRenderer.invoke('dialog:chooseDir'),
  chooseFile: () => ipcRenderer.invoke('dialog:chooseFile'),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),

  browserNavigate: (url) => ipcRenderer.invoke('browser:navigate', url),
  browserBack: () => ipcRenderer.invoke('browser:back'),
  browserForward: () => ipcRenderer.invoke('browser:forward'),
  browserReload: () => ipcRenderer.invoke('browser:reload'),
  browserBounds: (rect) => ipcRenderer.invoke('browser:bounds', rect),
  browserVisible: (v) => ipcRenderer.invoke('browser:visible', v),
  sniffList: () => ipcRenderer.invoke('sniff:list'),
  sniffClear: () => ipcRenderer.invoke('sniff:clear'),

  on(channel, cb) {
    if (!SAFE_EVENTS.includes(channel)) return;
    const listener = (_e, data) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
