// 打印队列任务详情（含错误）
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
  const r = await send('Runtime.evaluate', {
    expression: '(async()=>JSON.stringify(await opentube.listJobs()))()',
    returnByValue: true, awaitPromise: true
  });
  console.log(r.result.value);
  ws.close();
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
