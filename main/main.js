// OpenTube 主进程入口
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { getSettings, saveSettings } = require('./store');
const engine = require('./engine');
const queue = require('./queue');
const sniffer = require('./sniffer');
const cookies = require('./cookies');
const { BrowserPane, setHooks } = require('./browserview');
const ffmpegMod = require('./ffmpeg');

let mainWindow = null;
let settingsWin = null;
const browserPane = BrowserPane;

// browserview 回调注入
setHooks({
  bound(win, pane) {},
  notifyUrl(url) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser:url', url);
    }
  },
  notifyAdded(n) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser:buttons', n);
    }
  }
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#f5f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 嗅探结果推送到渲染进程
  sniffer.onItem((item) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sniffed', item);
  });

  mainWindow.on('closed', () => {
    browserPane.destroy();
    mainWindow = null;
  });
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) return settingsWin.focus();
  settingsWin = new BrowserWindow({
    width: 560,
    height: 480,
    parent: mainWindow,
    backgroundColor: '#f5f5f7',
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---------- IPC ----------
ipcMain.handle('info:get', async (_e, url) => engine.getInfo(url));
ipcMain.handle('queue:enqueue', (_e, tasks) => queue.enqueue(tasks));
ipcMain.handle('queue:list', () => queue.snapshot());
ipcMain.handle('queue:action', (_e, { action, id }) => {
  if (action === 'pause') queue.pause(id);
  else if (action === 'resume') queue.resume(id);
  else if (action === 'cancel') queue.cancel(id);
  else if (action === 'remove') queue.remove(id);
});
ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('settings:save', (_e, patch) => {
  const merged = saveSettings(patch);
  applyProxy(); // 立即生效，无需重启
  return merged;
});
ipcMain.handle('settings:open', () => openSettings());
ipcMain.handle('presets:list', () => ffmpegMod.loadPresets());
ipcMain.handle('engines:status', () => ({
  ytDlp: engine.resolveYtDlp(),
  ffmpeg: engine.resolveFfmpeg()
}));
ipcMain.handle('yt-dlp:update', async () => {
  try {
    await engine.runYtDlp(['-U'], () => {});
    return 'yt-dlp 已更新';
  } catch (e) {
    return '更新失败: ' + e.message;
  }
});

ipcMain.handle('dialog:chooseDir', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:chooseFile', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('shell:showItem', (_e, p) => {
  if (p && fs.existsSync(p)) shell.showItemInFolder(p);
});

// ---------- 内置浏览器 ----------
// 页面内「下载」按钮触发的下载（按钮挂在视频卡片/<video> 上，yt-dlp 负责提取）
ipcMain.on('page:download', (_e, url) => {
  if (typeof url !== 'string' || !url) return;
  if (url.length > 2000) return;
  const referer = typeof _e.sender.getURL === 'function' ? _e.sender.getURL() : '';
  // __ot_player__ 哨兵：Feed 播放器（blob 源）没有详情页链接，取嗅探到的最新媒体直链
  if (url === '__ot_player__') {
    const items = sniffer.list().filter((i) => /^https?:/i.test(i.url) && !sniffer.isNoise(i.url));
    if (!items.length) return;
    // 只接受视频 CDN（douyinvod/zjcdn 等）；找不到就不下载，避免误下特效贴纸等无关小文件
    const isVideoCdn = (u) => { try { return /douyinvod\.com|zjcdn\.com|aweme\/v1\/play\//i.test(u) || /(vod|video)\./i.test(new URL(u).hostname); } catch (_) { return false; } };
    const media = items.find((i) => isVideoCdn(i.url));
    if (!media) return;
    queue.enqueue([{ kind: 'download', url: media.url, formatId: 'bv*+ba/b', title: '页面视频', referer }]);
    return;
  }
  if (!/^https?:\/\//i.test(url)) return;
  queue.enqueue([{ kind: 'download', url, formatId: 'bv*+ba/b', title: '页面视频', referer }]);
});

ipcMain.handle('browser:navigate', (_e, url) => browserPane.navigate(mainWindow, url));
ipcMain.handle('browser:back', () => browserPane.back());
ipcMain.handle('browser:forward', () => browserPane.forward());
ipcMain.handle('browser:reload', () => browserPane.reload());
ipcMain.handle('browser:bounds', (_e, rect) => browserPane.setBounds(rect));
ipcMain.handle('browser:visible', (_e, v) => browserPane.setVisible(v));
ipcMain.handle('sniff:list', () => sniffer.list());
ipcMain.handle('sniff:clear', () => { sniffer.clear(); });

// 主进程诊断日志（写文件，便于事后排查界面看不到的主进程问题）
function mainLog(...args) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'main.log'),
      `[${new Date().toISOString()}] ${args.map(String).join(' ')}\n`);
  } catch (_) {}
}

// 代理设置应用到内置浏览器（yt-dlp 由 engine.js 读取同一设置）
async function applyProxy() {
  const { session } = require('electron');
  const s = getSettings();
  const rules = browserProxyRules(s.proxyUrl);
  try {
    const ses = session.fromPartition('persist:opentube-browser');
    if (rules) await ses.setProxy({ proxyRules: rules, proxyBypassRules: '<local>' });
    else await ses.setProxy({ mode: 'direct' });
    mainLog('applyProxy ok, proxyRules =', rules || '(direct)');
  } catch (e) {
    mainLog('applyProxy FAILED:', e && e.message, '| rules =', rules);
  }
}

// Chromium proxyRules 归一化：http(s) 前缀去掉（裸 host:port 全协议生效），socks 保留
function browserProxyRules(url) {
  if (!url || typeof url !== 'string') return '';
  const u = url.trim();
  const m = u.match(/^(https?|socks[45]):\/\/(.+)$/i);
  if (!m) return u;
  return /^socks/i.test(m[1]) ? 'socks5://' + m[2] : m[2];
}

// ---------- 应用生命周期 ----------
// [proxy-boot-fix] 网络服务初始化前用命令行开关应用代理（比 session.setProxy 更底层可靠）
try {
  const _fs = require('fs'), _path = require('path');
  const _cfg = JSON.parse(_fs.readFileSync(_path.join(app.getPath('userData'), 'data', 'settings.json'), 'utf8'));
  const _raw = _cfg && typeof _cfg.proxyUrl === 'string' ? _cfg.proxyUrl.trim() : '';
  if (_raw) {
    let _rules = _raw.replace(/^https?:\/\//i, '');
    if (/^socks/i.test(_raw)) _rules = 'socks5://' + _raw.replace(/^socks[45]:\/\//i, '');
    app.commandLine.appendSwitch('proxy-server', _rules);
  }
} catch (_) {}

app.whenReady().then(() => {
  const { session } = require('electron');
  const browserSession = session.fromPartition('persist:opentube-browser');
  sniffer.attach(browserSession);
  cookies.setSession(browserSession); // 内置浏览器登录态 -> 下载自动携带
  // 拒绝网页拉起外部应用的请求（如抖音的 bytedance:// 唤端），
  // 否则系统找不到对应应用会弹「获取打开此链接的应用」选择框
  browserSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'openExternal') { mainLog('denied openExternal permission'); callback(false); return; }
    callback(true);
  });
  browserSession.setPermissionCheckHandler((_wc, permission) => permission !== 'openExternal');
  applyProxy();
  createMainWindow();
  queue.init(mainWindow); // 必须在窗口创建后，否则进度事件推不到渲染层
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
