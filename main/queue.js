// 下载/转码任务队列：并发控制、暂停恢复、持久化
const fs = require('fs');
const { getSettings, loadJSON, saveJSON } = require('./store');
const engine = require('./engine');
const ffmpegMod = require('./ffmpeg');

let nextId = 1;
const jobs = new Map(); // id -> job
let mainWindow = null;
let saveTimer = null;

function snapshot() {
  // 剥离 proc（ChildProcess 无法 IPC 序列化，也不能写入 JSON）
  return [...jobs.values()]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(({ proc, ...rest }) => rest);
}

function notify() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('jobs', snapshot());
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveJSON('jobs.json', snapshot()), 500);
}

function restore() {
  const saved = loadJSON('jobs.json', []);
  for (const j of saved) {
    // 上次运行中的任务恢复为暂停（进程已随退出结束）
    if (j.status === 'active' || j.status === 'pending') j.status = 'paused';
    if (j.proc) delete j.proc;
    jobs.set(j.id, j);
    if (j.id >= nextId) nextId = j.id + 1;
  }
}

function enqueue(tasks) {
  const created = [];
  for (const t of tasks) {
    const job = {
      id: nextId++,
      kind: t.kind || 'download',      // download | convert
      url: t.url || '',
      referer: t.referer || '',
      formatId: t.formatId || '',
      title: t.title || t.url || '任务',
      preset: t.preset || '',
      inputFile: t.inputFile || '',
      outputDir: t.outputDir || getSettings().downloadDir,
      status: 'pending',
      percent: 0,
      speed: '',
      eta: '',
      phase: '',
      error: '',
      filePath: '',
      createdAt: Date.now()
    };
    jobs.set(job.id, job);
    created.push(job);
  }
  notify();
  tick();
  return created.map((j) => j.id);
}

function activeCount() {
  return [...jobs.values()].filter((j) => j.status === 'active').length;
}

function tick() {
  const max = getSettings().maxConcurrent || 3;
  for (const job of jobs.values()) {
    if (activeCount() >= max) break;
    if (job.status === 'pending') start(job);
  }
}

function start(job) {
  job.status = 'active';
  job.error = '';
  if (job.kind === 'convert') startConvert(job);
  else startDownloadJob(job);
  notify();
}

async function startDownloadJob(job) {
  fs.mkdirSync(job.outputDir, { recursive: true });
  const proc = await engine.startDownload({
    url: job.url,
    formatId: job.formatId,
    outputDir: job.outputDir,
    referer: job.referer,
    onEvent: (ev) => {
      if (ev.phase) job.phase = ev.phase;
      if (ev.percent !== undefined) {
        job.percent = ev.percent;
        job.speed = ev.speed || '';
        job.eta = ev.eta || '';
        job.phase = '';
      }
      notify();
    },
    onExit: (code, filePath, errMsg) => {
      if (jobs.get(job.id) !== job) return; // 已被移除
      if (job.status === 'paused') return;  // 暂停触发的 kill
      if (job.status === 'canceled') return;
      if (code === 0) {
        job.status = 'done';
        job.percent = 100;
        job.phase = '';
        if (filePath) job.filePath = filePath;
      } else {
        job.status = 'error';
        job.error = errMsg || '下载失败';
      }
      notify();
      tick();
    }
  });
  // await 期间任务可能已被暂停/取消：直接杀掉刚启动的进程
  if (job.status !== 'active') { if (proc) { try { proc.kill(); } catch (_) {} } return; }
  job.proc = proc;
}

function startConvert(job) {
  ffmpegMod.convert(job, (ev) => {
    if (ev.percent !== undefined) { job.percent = ev.percent; job.phase = '转码中'; }
    if (ev.phase) job.phase = ev.phase;
    notify();
  }, (code, filePath, errMsg) => {
    if (job.status === 'paused' || job.status === 'canceled') return;
    if (code === 0) {
      job.status = 'done'; job.percent = 100; job.phase = '';
      if (filePath) job.filePath = filePath;
    } else {
      job.status = 'error'; job.error = errMsg || '转码失败';
    }
    notify();
    tick();
  });
}

function pause(id) {
  const job = jobs.get(id);
  if (!job || job.status !== 'active') return;
  job.status = 'paused';
  job.phase = ''; job.speed = ''; job.eta = '';
  if (job.proc) { try { job.proc.kill(); } catch (_) {} }
  notify();
  tick();
}

function resume(id) {
  const job = jobs.get(id);
  if (!job || (job.status !== 'paused' && job.status !== 'error')) return;
  job.status = 'pending';
  notify();
  tick();
}

function cancel(id) {
  const job = jobs.get(id);
  if (!job) return;
  if (job.status === 'active' && job.proc) {
    job.status = 'canceled';
    try { job.proc.kill(); } catch (_) {}
  }
  job.status = 'canceled';
  notify();
  tick();
}

function remove(id) {
  const job = jobs.get(id);
  if (!job) return;
  if (job.status === 'active' && job.proc) { try { job.proc.kill(); } catch (_) {} }
  jobs.delete(id);
  notify();
  tick();
}

module.exports = { init(win) { mainWindow = win; restore(); }, enqueue, pause, resume, cancel, remove, snapshot, tick };
