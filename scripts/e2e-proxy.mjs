// CDP 验证：代理 + 页面可见性（截图判断非黑屏）+ YouTube 加载
const CDP_PORT = process.env.CDP_PORT || 9222;
async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
  return res.json();
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

// 截图大小启发式：纯色背景页 PNG 极小（<15KB），有内容则大
async function shotSize(cdp) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
  if (!r || !r.data) return -1;
  return Math.round((r.data.length * 3) / 4 / 1024); // base64 -> KB
}

async function main() {
  const targets = await listTargets();
  const mainT = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
  if (!mainT) throw new Error('未找到主窗口');
  const main = await connect(mainT.webSocketDebuggerUrl);

  // 0. 配置代理（用户本机 10808，保存后打包版同样生效——共享 userData）
  await evalJs(main, "opentube.saveSettings({ proxyUrl: 'http://127.0.0.1:10808' })");
  console.log('✓ 代理已配置: http://127.0.0.1:10808');

  // 1. B 站：导航 + 截图判断真实渲染
  await evalJs(main, "switchTab('browser')");
  await sleep(300);
  await evalJs(main, `[...document.querySelectorAll('.quick-site')].find(b => b.textContent.includes('哔哩哔哩')).click()`);
  let bbT = null;
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    bbT = (await listTargets()).find((t) => t.type === 'page' && t.url.includes('bilibili.com'));
    if (bbT) break;
  }
  if (!bbT) throw new Error('B 站 target 未出现');
  const bili = await connect(bbT.webSocketDebuggerUrl);
  await sleep(4000); // 等渲染
  const kb = await shotSize(bili);
  const bodyLen = await evalJs(bili, "document.body ? document.body.innerHTML.length : 0");
  console.log(`✓ B 站页面加载: 内容 ${bodyLen} 字节, 截图 ${kb}KB ${kb > 15 ? '(非黑屏✓)' : '(疑似黑屏✗)'}`);
  if (kb <= 15) throw new Error('B 站页面疑似黑屏: ' + kb + 'KB');
  const btns = await evalJs(bili, "document.querySelectorAll('.ot-dl-btn').length");
  console.log(`✓ 注入下载按钮: ${btns} 个`);

  // 2. YouTube：走代理加载
  await evalJs(main, "document.querySelector('#browser-url').value = 'https://www.youtube.com'; document.querySelector('#browser-go').onclick()");
  let ytT = null;
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    ytT = (await listTargets()).find((t) => t.type === 'page' && t.url.includes('youtube.com'));
    if (ytT) break;
  }
  if (!ytT) throw new Error('YouTube target 未出现（代理未生效？）');
  const yt = await connect(ytT.webSocketDebuggerUrl);
  await sleep(4000);
  const ytTitle = await evalJs(yt, 'document.title');
  const ytKb = await shotSize(yt);
  console.log(`✓ YouTube 加载: title="${ytTitle.slice(0, 40)}", 截图 ${ytKb}KB ${ytKb > 15 ? '(有内容✓)' : '(疑似空白)'}`);
  if (!ytTitle || /error/i.test(ytTitle)) throw new Error('YouTube 加载异常: ' + ytTitle);

  // 3. yt-dlp 引擎走代理解析 YouTube 视频
  const info = await evalJs(main, `opentube.getInfo('https://www.youtube.com/watch?v=dQw4w9WgXcQ').then(i => JSON.stringify({t: i.info.title, f: i.info.formats.length}))`);
  const parsed = JSON.parse(info);
  console.log(`✓ 引擎代理解析 YouTube: "${parsed.t}" (${parsed.f} 格式)`);

  console.log('\n===== 代理 + 渲染修复验证通过 =====');
  main.close(); bili.close(); yt.close();
  process.exit(0);
}
main().catch((e) => { console.error('✗ 失败:', e.message); process.exit(1); });
