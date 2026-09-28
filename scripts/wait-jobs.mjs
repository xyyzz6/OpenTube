// 等待队列任务全部终结（done/error/canceled）
const CDP_PORT = 9222;
async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
  const t = targets.find((x) => x.type === 'page' && x.url.includes('index.html'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const m = ++id; pending.set(m, { res, rej });
    ws.send(JSON.stringify({ id: m, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  let done = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const r = await send('Runtime.evaluate', {
      expression: '(async()=>{const j=await opentube.listJobs();return JSON.stringify(j.map(x=>({s:x.status,p:Math.round(x.percent),f:x.filePath})))})()',
      returnByValue: true, awaitPromise: true
    });
    const jobs = JSON.parse(r.result.value);
    console.log(`[${i * 3}s]`, jobs.map((j) => `${j.s} ${j.p}%`).join(' | '));
    if (jobs.length && jobs.every((j) => ['done', 'error', 'canceled'].includes(j.s))) { done = true; break; }
  }
  ws.close();
  process.exit(done ? 0 : 1);
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
