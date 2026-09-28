// CDP 验证：Cookie 导出链路
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

  // 1. 切到浏览器页签，访问百度（会种下真实 Cookie 到内置浏览器会话）
  await evalJs(cdp, "switchTab('browser')");
  await evalJs(cdp, "document.querySelector('#browser-url').value = 'https://www.baidu.com'; document.querySelector('#browser-go').onclick()");
  await sleep(6000); // 等页面加载、Cookie 落盘

  // 2. 触发 getInfo（主进程先导出 Cookie 再调 yt-dlp；百度无提取器，解析失败无所谓，导出已发生）
  await evalJs(cdp, "switchTab('download')");
  await evalJs(cdp, "document.querySelector('#url-input').value = 'https://www.baidu.com/'; parseUrl().catch(()=>{})");
  await sleep(5000);

  console.log('✓ 已触发 Cookie 导出（主进程日志应有 [opentube] cookies 行）');
  cdp.close();
  process.exit(0);
}
main().catch((e) => { console.error('✗ 失败:', e.message); process.exit(1); });
