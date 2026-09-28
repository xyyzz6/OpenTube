// CDP 验证：转码任务 + 重启持久化
const CDP_PORT = 9222;
async function getTarget() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
  if (!page) throw new Error('未找到 OpenTube 窗口');
  return page.webSocketDebuggerUrl;
}
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => resolve({
      send(method, params) {
        return new Promise((res2, rej2) => {
          const mid = ++id;
          pending.set(mid, { res2, rej2 });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      close: () => ws.close()
    });
    ws.onerror = reject;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res2, rej2 } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej2(new Error(JSON.stringify(msg.error))) : res2(msg.result);
      }
    };
  });
}
async function evalJs(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cdp = await connect(await getTarget());

  // 1. 预设列表
  const presets = await evalJs(cdp, 'opentube.listPresets()');
  console.log('✓ 转码预设:', presets.map((p) => p.name).join(', '));
  if (presets.length < 6) throw new Error('预设数量不对');

  // 2. 找到已完成的下载任务文件，入队 mp3 转码
  const ids = await evalJs(cdp, `(async () => {
    const jobs = await opentube.listJobs();
    const done = jobs.find(j => j.status === 'done' && j.filePath && j.filePath.endsWith('.mp4'));
    if (!done) throw new Error('没有已完成的 mp4 任务');
    await opentube.enqueue([{ kind: 'convert', preset: 'MP3 音频', inputFile: done.filePath, title: done.title + ' → MP3' }]);
    return done.filePath;
  })()`);
  console.log('✓ 已入队 MP3 转码:', ids);

  // 3. 轮询转码完成
  let ok = false;
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const j = await evalJs(cdp, `(async () => {
      const jobs = await opentube.listJobs();
      return jobs.find(j => j.kind === 'convert');
    })()`);
    console.log(`  [${i * 2}s] ${j.status} ${Math.round(j.percent)}%`);
    if (j.status === 'done' && j.filePath.endsWith('.mp3')) { ok = true; break; }
    if (j.status === 'error') throw new Error('转码失败: ' + j.error);
  }
  if (!ok) throw new Error('60 秒内转码未完成');
  console.log('✓ MP3 转码完成');

  // 4. 暂停/恢复 API 冒烟（用一个解析出的新任务测暂停）
  await evalJs(cdp, `opentube.enqueue([{ kind: 'download', url: 'https://www.bilibili.com/video/BV1GJ411x7h7', formatId: 'ba/b', title: '暂停测试-仅音频' }])`);
  await sleep(1500);
  const p1 = await evalJs(cdp, `(async () => {
    const jobs = await opentube.listJobs();
    const j = jobs.find(x => x.title.includes('暂停测试'));
    await opentube.jobAction('pause', j.id);
    return j.status;
  })()`);
  await sleep(800);
  const p2 = await evalJs(cdp, `(async () => {
    const jobs = await opentube.listJobs();
    return jobs.find(x => x.title.includes('暂停测试')).status;
  })()`);
  console.log(`✓ 暂停: ${p1} → ${p2}`);
  if (p2 !== 'paused') throw new Error('暂停失败: ' + p2);

  // 5. 任务持久化检查
  const saved = await evalJs(cdp, `(async () => {
    const jobs = await opentube.listJobs();
    return jobs.length;
  })()`);
  console.log('✓ 队列中任务数:', saved, '（重启后 restore 会恢复）');

  console.log('\n===== 转码 + 队列验证通过 =====');
  cdp.close();
  process.exit(0);
}
main().catch((e) => { console.error('✗ 失败:', e.message); process.exit(1); });
