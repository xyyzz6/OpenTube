// yt-dlp 引擎封装：元数据解析、格式整理、下载进程、进度解析
const { app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getSettings } = require('./store');
const cookies = require('./cookies');

// 引擎二进制定位：设置指定 > 打包 resources/bin > userData/bin > 项目 bin > 开发机已知 ffmpeg
function resolveYtDlp() {
  const s = getSettings();
  const candidates = [
    s.ytDlpPath,
    app.isPackaged ? path.join(process.resourcesPath, 'bin', 'yt-dlp.exe') : '',
    path.join(app.getPath('userData'), 'bin', 'yt-dlp.exe'),
    path.join(__dirname, '..', 'bin', 'yt-dlp.exe')
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resolveFfmpeg() {
  const s = getSettings();
  const candidates = [
    s.ffmpegPath,
    app.isPackaged ? path.join(process.resourcesPath, 'bin', 'ffmpeg.exe') : '',
    path.join(app.getPath('userData'), 'bin', 'ffmpeg.exe'),
    path.join(__dirname, '..', 'bin', 'ffmpeg.exe'),
    'e:\\boki\\抖音直播录屏工具\\tools\\ffmpeg.exe' // 开发机已知位置
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ffmpeg 所在目录（yt-dlp 用 --ffmpeg-location 参数）
function ffmpegLocation() {
  const p = resolveFfmpeg();
  return p ? path.dirname(p) : null;
}

function missingEngineError() {
  const err = new Error('未找到 yt-dlp.exe，请先运行 npm run bootstrap 或在设置中手动指定路径');
  err.code = 'ENGINE_MISSING';
  return err;
}

// 代理参数（设置里填了 proxyUrl 时启用；裸 host:port 默认按 http 代理处理）
function proxyArgs() {
  const p = (getSettings().proxyUrl || '').trim();
  if (!p) return [];
  const url = /^[a-z]+:\/\//i.test(p) ? p : 'http://' + p;
  return ['--proxy', url];
}

function runYtDlp(args, onLine) {
  return new Promise((resolve, reject) => {
    const exe = resolveYtDlp();
    if (!exe) return reject(missingEngineError());
    // Windows 下 yt-dlp 重定向输出默认跟随系统 ANSI 代码页（GBK），强制 UTF-8 才能正确处理中文文件名
    const proc = spawn(exe, ['--encoding', 'utf-8', ...args], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => {
      const text = d.toString();
      stdout += text;
      if (onLine) text.split(/\r?\n|\r/).forEach((l) => l && onLine(l));
    });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim().split('\n').pop() || ('yt-dlp 退出码 ' + code)));
    });
  });
}

// yt-dlp 报错转译：给出可操作的提示
function humanizeError(msg) {
  const m = String(msg || '');
  if (/fresh cookies|cookies are needed/i.test(m)) {
    return m + ' —— 请先在「在线」页签打开一次该站点（如抖音），让 OpenTube 获取站点 Cookie 后再重试';
  }
  return m;
}

// 解析单个视频或播放列表
async function getInfo(url) {
  // 自动携带内置浏览器的登录 Cookie（若有）
  const cFile = await cookies.exportFor(url);
  const cArgs = cFile ? ['--cookies', cFile] : [];
  // 先用 flat-playlist 快速判断类型
  const flat = await runYtDlp([...proxyArgs(), ...cArgs, '-J', '--flat-playlist', '--no-warnings', url]).catch((e) => {
    throw new Error(humanizeError(e.message));
  });
  let data;
  try { data = JSON.parse(flat.stdout.slice(flat.stdout.indexOf('{'))); } catch (_) {
    throw new Error('无法解析视频信息（网络或站点不支持）');
  }
  if (data._type === 'playlist' && Array.isArray(data.entries) && data.entries.length > 1) {
    return {
      type: 'playlist',
      title: data.title || '播放列表',
      count: data.entries.length,
      entries: data.entries.map((e, i) => ({
        index: i + 1,
        id: e.id,
        title: e.title || e.id,
        url: e.url || e.webpage_url || e.original_url || ''
      }))
    };
  }
  // 单视频：取完整元数据
  const full = await runYtDlp([...proxyArgs(), ...cArgs, '-J', '--no-playlist', '--no-warnings', url]);
  let info;
  try { info = JSON.parse(full.stdout.slice(full.stdout.indexOf('{'))); } catch (_) {
    throw new Error('无法解析视频信息');
  }
  return { type: 'video', info: summarize(info) };
}

function summarize(info) {
  const formats = pickFormats(info.formats || []);
  return {
    id: info.id,
    title: info.title,
    duration: info.duration,
    webpage_url: info.webpage_url || info.original_url,
    extractor: info.extractor_key || info.extractor,
    formats,
    best: 'bv*+ba/b'
  };
}

// 整理格式列表：去重、排序、标注音视频
function pickFormats(formats) {
  const seen = new Map();
  for (const f of formats) {
    if (!f.format_id) continue;
    const isVideo = f.vcodec && f.vcodec !== 'none';
    const isAudio = f.acodec && f.acodec !== 'none';
    if (!isVideo && !isAudio) continue;
    const height = f.height || 0;
    const tbr = f.tbr || f.abr || 0;
    // 分组键：类型+容器+分辨率+帧率，同组保留码率最高的
    const key = [isVideo ? 'v' : 'a', f.ext, isVideo ? height : (f.abr || f.tbr || ''), isVideo ? (f.fps || '') : ''].join('|');
    const prev = seen.get(key);
    const size = (f.filesize || f.filesize_approx || 0);
    if (!prev || (tbr > prev._tbr)) {
      seen.set(key, {
        _tbr: tbr,
        id: f.format_id,
        ext: f.ext,
        kind: isVideo ? 'video' : 'audio',
        res: isVideo ? (height ? height + 'p' : (f.resolution || '未知')) : (f.abr ? Math.round(f.abr) + 'kbps' : '音频'),
        fps: isVideo && f.fps ? f.fps + 'fps' : '',
        size: size ? (size / 1048576).toFixed(1) + 'MB' : '',
        note: f.format_note || ''
      });
    }
  }
  const list = [...seen.values()];
  list.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'video' ? -1 : 1;
    return (parseFloat(b.res) || parseFloat(b._tbr) || 0) - (parseFloat(a.res) || parseFloat(a._tbr) || 0);
  });
  return list.slice(0, 25);
}

// 进度行解析：返回 {percent, speed, eta} 或状态 {phase}
function parseProgressLine(line) {
  const dl = line.match(/\[download\]\s+([\d.]+)% of\s+~?\s*([\d.]+\w+)(?:.*?at\s+([\d.]+\w*\/s|Unknown\s+B\/s))?(?:.*?ETA\s+([\d:]+|Unknown))?/);
  if (dl) {
    return { percent: parseFloat(dl[1]), size: dl[2], speed: dl[3] || '', eta: dl[4] || '' };
  }
  if (/\[Merger\]/.test(line)) return { phase: '合并音视频...' };
  if (/\[ExtractAudio\]/.test(line)) return { phase: '提取音频...' };
  if (/\[Fixup|\[Metadata|\[EmbedThumbnail|\[VideoRemuxer/.test(line)) return { phase: '后处理...' };
  if (/\[download\] Destination|\[info\] Downloading video thumbnail/.test(line)) return { phase: 'downloading' };
  return null;
}

// 启动下载（或直接下载嗅探到的媒体地址）
// opts: { url, formatId, outputDir, referer, onEvent(line parsed), onExit(code, filePath) }
async function startDownload(opts) {
  const exe = resolveYtDlp();
  if (!exe) { opts.onExit(1, null, missingEngineError().message); return null; }
  // 自动携带内置浏览器的登录 Cookie（若有）
  let cArgs = [];
  try {
    const cFile = await cookies.exportFor(opts.url);
    if (cFile) cArgs = ['--cookies', cFile];
  } catch (_) {}
  const args = [
    ...proxyArgs(),
    ...cArgs,
    '--encoding', 'utf-8', // Windows 输出编码修正
    '-f', opts.formatId || 'bv*+ba/b',
    '--newline', '--progress', '--no-simulate',
    '--print', 'after_move:filepath',
    '--no-mtime', '--windows-filenames',
    '--retries', '3', '--concurrent-fragments', '5',
    '-P', opts.outputDir,
    '-o', '%(title)s.%(ext)s'
  ];
  const loc = ffmpegLocation();
  if (loc) args.push('--ffmpeg-location', loc);
  if (opts.referer) args.push('--referer', opts.referer);
  args.push(opts.url);

  const proc = spawn(exe, args, { windowsHide: true });
  let filePath = null;
  let lastErrLine = '';
  const handleLine = (line) => {
    const t = line.trim();
    if (!t) return;
    // --print 输出的最终文件路径（非方括号开头的行）
    if (!t.startsWith('[') && /\.(mp4|mkv|webm|mp3|m4a|aac|flv|ogg|opus|wav|mov)$/i.test(t) && fs.existsSync(t)) {
      filePath = t;
      return;
    }
    const ev = parseProgressLine(t);
    if (ev && opts.onEvent) opts.onEvent(ev);
  };
  proc.stdout.on('data', (d) => d.toString().split(/\r?\n|\r/).forEach(handleLine));
  proc.stderr.on('data', (d) => {
    d.toString().split(/\r?\n|\r/).forEach((l) => { if (l.trim()) lastErrLine = l.trim(); });
  });
  proc.on('error', (e) => opts.onExit(1, null, e.message));
  proc.on('close', (code) => {
    if (code === 0) return opts.onExit(0, filePath, null);
    const m = lastErrLine && /ERROR/i.test(lastErrLine) ? humanizeError(lastErrLine).slice(0, 200) : '下载失败（网络或格式不支持）';
    opts.onExit(code, filePath, m);
  });
  return proc;
}

module.exports = { getInfo, startDownload, resolveYtDlp, resolveFfmpeg, ffmpegLocation, runYtDlp };
