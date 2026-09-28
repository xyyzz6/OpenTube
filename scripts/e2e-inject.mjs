// CDP 验证：页面注入下载按钮 + 点击入队 + 徽章
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

async function main() {
  // 主窗口
  const targets = await listTargets();
  const mainT = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
  if (!mainT) throw new Error('未找到主窗口');
  const main = await connect(mainT.webSocketDebuggerUrl);

  // 1. 切到浏览器页签，点 B 站图标
  await evalJs(main, "switchTab('browser')");
  await sleep(300);
  await evalJs(main, `[...document.querySelectorAll('.quick-site')].find(b => b.textContent.includes('哔哩哔哩')).click()`);

  // 2. 找到 B 站页面 target（WebContentsView）
  let bilibiliT = null;
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    const ts = await listTargets();
    bilibiliT = ts.find((t) => t.type === 'page' && t.url.includes('bilibili.com'));
    if (bilibiliT) break;
  }
  if (!bilibiliT) throw new Error('B 站页面 target 未找到');
  const page = await connect(bilibiliT.webSocketDebuggerUrl);
  console.log('✓ B 站页面已加载:', bilibiliT.url.slice(0, 60));

  // 3. 等待注入按钮出现
  let btnCount = 0;
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    btnCount = await evalJs(page, "document.querySelectorAll('.ot-dl-btn').length") || 0;
    if (btnCount > 0) break;
  }
  if (!btnCount) throw new Error('页面上没有注入任何下载按钮');
  console.log(`✓ 页面注入了 ${btnCount} 个「下载」按钮`);

  // 4. 点击卡片按钮（a > .ot-dl-btn，排除 <video> 预览的按钮）→ 入队真实视频页
  const beforeJobs = await evalJs(main, '(async () => (await opentube.listJobs()).length)()');
  const cardBtns = await evalJs(page, "document.querySelectorAll('a > .ot-dl-btn').length") || 0;
  if (!cardBtns) throw new Error('没有卡片下载按钮（只有 video 预览按钮）');
  const clickedHref = await evalJs(page, `(() => { const b = document.querySelector('a > .ot-dl-btn'); const a = b.closest('a'); b.click(); return a.href; })()`);
  console.log(`✓ 点击卡片按钮（${cardBtns} 个卡片按钮）: ${clickedHref.slice(0, 60)}`);
  await sleep(1500);
  const afterJobs = await evalJs(main, '(async () => (await opentube.listJobs()).length)()');
  console.log(`✓ 点击下载按钮: 任务 ${beforeJobs} → ${afterJobs}`);
  if (afterJobs <= beforeJobs) throw new Error('点击按钮未入队任务');
  if (!clickedHref.includes('/video/')) throw new Error('点击的不是视频页链接: ' + clickedHref);

  // 5. 徽章显示
  const badge = await evalJs(main, `(() => { const b = document.querySelector('#dl-badge'); return b.classList.contains('hidden') ? 'hidden' : b.textContent; })()`);
  console.log('✓ 工具栏徽章:', badge);
  if (badge === 'hidden') throw new Error('徽章未显示');

  console.log('\n===== 注入按钮 + 徽章验证通过 =====');
  main.close(); page.close();
  process.exit(0);
}
main().catch((e) => { console.error('✗ 失败:', e.message); process.exit(1); });
