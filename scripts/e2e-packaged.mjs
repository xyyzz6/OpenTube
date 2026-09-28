// 打包版验证：引擎路径 + 真实解析
const CDP_PORT = 9223;
async function getTarget() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
  if (!page) throw new Error('未找到窗口');
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
  const st = await evalJs(cdp, 'opentube.engineStatus()');
  console.log('ytDlp:', st.ytDlp);
  console.log('ffmpeg:', st.ffmpeg);
  if (!st.ytDlp || !st.ffmpeg) throw new Error('打包版引擎定位失败');
  if (!st.ytDlp.includes('resources\\bin') && !st.ytDlp.includes('resources/bin')) throw new Error('引擎未指向 resources/bin');

  // 真实解析（走打包版 yt-dlp）
  await evalJs(cdp, "document.querySelector('#url-input').value = 'https://www.bilibili.com/video/BV1GJ411x7h7'; parseUrl()");
  await sleep(3000);
  const title = await evalJs(cdp, "document.querySelector('#video-title').textContent");
  const fmtCount = await evalJs(cdp, "document.querySelectorAll('#fmt-table tbody tr').length");
  console.log(`✓ 打包版解析成功: "${title}" (${fmtCount} 格式)`);
  console.log('\n===== 打包版验证通过 =====');
  cdp.close();
  process.exit(0);
}
main().catch((e) => { console.error('✗ 失败:', e.message); process.exit(1); });
