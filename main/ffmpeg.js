// ffmpeg 转码：预设驱动、进度解析
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const engine = require('./engine');

function loadPresets() {
  const dir = path.join(__dirname, '..', 'presets');
  const presets = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { presets.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch (_) {}
  }
  return presets;
}

function convert(job, onEvent, onExit) {
  const ffmpeg = engine.resolveFfmpeg();
  if (!ffmpeg) { onExit(1, null, '未找到 ffmpeg.exe，请在设置中指定或运行 npm run bootstrap'); return null; }
  const preset = loadPresets().find((p) => p.name === job.preset);
  if (!preset) { onExit(1, null, '未找到预设 ' + job.preset); return null; }

  const outBase = job.inputFile.replace(/\.[^.]+$/, '');
  const output = outBase + '.' + preset.ext;
  const args = ['-y', '-i', job.inputFile, ...preset.args, output];

  let reported = false;
  let duration = 0; // 从 ffmpeg 输出的 Duration 行获取
  let stderrBuf = '';
  const proc = spawn(ffmpeg, args, { windowsHide: true });
  proc.stderr.on('data', (d) => {
    stderrBuf += d.toString();
    const lines = stderrBuf.split(/\r?\n|\r/);
    stderrBuf = lines.pop();
    for (const line of lines) {
      const dm = line.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (dm && !duration) duration = (+dm[1]) * 3600 + (+dm[2]) * 60 + parseFloat(dm[3]);
      const m = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && duration > 0) {
        const sec = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
        reported = true;
        onEvent({ percent: Math.min(99, (sec / duration) * 100) });
      }
    }
  });
  if (!reported) onEvent({ phase: '转码中' });
  proc.on('error', (e) => onExit(1, null, e.message));
  proc.on('close', (code) => {
    if (code === 0 && fs.existsSync(output)) onExit(0, output, null);
    else onExit(code, null, 'ffmpeg 退出码 ' + code);
  });
  return proc;
}

module.exports = { loadPresets, convert };
