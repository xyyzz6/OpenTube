// 分步验证：每步独立 try/catch + 超时保护，避免单点挂起
const CDP_PORT = process.env.CDP_PORT || 9222;
const withTimeout = (p, ms, label) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error(label + ' 超时 ' + ms + 'ms')), ms))
]);

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
      close: () => { try { ws.close(); } catch (_) {} }
    });
    ws.onerror = (e) => reject(new Error('ws error'));
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
const evalJs = async (cdp, expr) => {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const targets = () => fetch(`http://127.0.0.1:${CDP_PORT}/json`).then((r) => r.json());
  const mainT = (await targets()).find((t) => t.type === 'page' && t.url.includes('index.html'));
  const main = await connect(mainT.webSocketDebuggerUrl);

  // 1. B 站可见性验证（未加载则先导航）
  await withTimeout(evalJs(main, "switchTab('browser')"), 5000, 'switchTab');
  await withTimeout(evalJs(main, "document.querySelector('#browser-url').value = 'https://www.bilibili.com'; document.querySelector('#browser-go').onclick()"), 5000, 'nav bili');
  let biliT = null;
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    biliT = (await targets()).find((t) => t.type === 'page' && t.url.includes('bilibili.com'));
    if (biliT) break;
  }
  if (!biliT) { console.log('BILI_MISSING'); process.exit(2); }
  const bili = await withTimeout(connect(biliT.webSocketDebuggerUrl), 8000, 'connect bili');
  const bodyLen = await withTimeout(evalJs(bili, 'document.body ? document.body.innerHTML.length : 0'), 8000, 'eval bili');
  console.log(`STEP1_BILI_BODY=${bodyLen}`);

  // 2. 截图（先 enable Page 域）
  try {
    await withTimeout(bili.send('Page.enable', {}), 5000, 'Page.enable');
    const shot = await withTimeout(bili.send('Page.captureScreenshot', { format: 'png' }), 8000, 'screenshot');
    const kb = Math.round((shot.data.length * 3) / 4 / 1024);
    console.log(`STEP2_SHOT_KB=${kb}`);
  } catch (e) {
    console.log('STEP2_SHOT_FAIL=' + e.message);
  }

  // 3. 注入按钮数
  const btns = await withTimeout(evalJs(bili, "document.querySelectorAll('.ot-dl-btn').length"), 8000, 'btns');
  console.log(`STEP3_BTNS=${btns}`);

  // 4. YouTube 走代理加载
  await withTimeout(evalJs(main, "switchTab('browser')"), 5000, 'switchTab');
  await withTimeout(evalJs(main, "document.querySelector('#browser-url').value = 'https://www.youtube.com'; document.querySelector('#browser-go').onclick()"), 5000, 'nav yt');
  let ytT = null;
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    ytT = (await targets()).find((t) => t.type === 'page' && t.url.includes('youtube.com'));
    if (ytT) break;
  }
  if (!ytT) { console.log('STEP4_YT_MISSING'); process.exit(3); }
  const yt = await withTimeout(connect(ytT.webSocketDebuggerUrl), 8000, 'connect yt');
  const ytTitle = await withTimeout(evalJs(yt, 'document.title'), 8000, 'yt title');
  console.log(`STEP4_YT_TITLE=${ytTitle}`);

  // 5. 引擎代理解析 YouTube（含 Cookie 导出路径，放宽超时）
  const info = await withTimeout(evalJs(main, `opentube.getInfo('https://www.youtube.com/watch?v=dQw4w9WgXcQ').then(i => JSON.stringify({t: i.info.title.slice(0,50), f: i.info.formats.length}))`), 150000, 'getInfo yt');
  console.log(`STEP5_ENGINE=${info}`);

  console.log('ALL_STEPS_DONE');
  process.exit(0);
}
main().catch((e) => { console.error('FAIL: ' + e.message); process.exit(1); });
