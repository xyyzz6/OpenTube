// CDP 验证：快捷站点 + 批量嗅探下载
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

  // 1. 快捷站点渲染
  const siteCount = await evalJs(cdp, "document.querySelectorAll('.quick-site').length");
  if (siteCount < 8) throw new Error('快捷站点数量不足: ' + siteCount);
  const siteNames = await evalJs(cdp, "[...document.querySelectorAll('.quick-site span')].map(e=>e.textContent).join(',')");
  console.log(`✓ ${siteCount} 个快捷站点: ${siteNames}`);

  // 2. 切到浏览器页签，点「哔哩哔哩」图标
  await evalJs(cdp, "switchTab('browser')");
  await sleep(400);
  await evalJs(cdp, `[...document.querySelectorAll('.quick-site')].find(b => b.textContent.includes('哔哩哔哩')).click()`);
  console.log('✓ 已点击 B 站图标，等待页面加载…');

  // 3. 等待页面加载并捕获嗅探（B 站首页有自动播放的推荐视频）
  let sniffed = false;
  for (let i = 0; i < 25; i++) {
    await sleep(2000);
    const count = await evalJs(cdp, '(async () => (await opentube.sniffList()).length)()');
    const shown = await evalJs(cdp, "document.querySelectorAll('.sniff-item').length");
    if (i % 4 === 0) console.log(`  [${i * 2}s] 捕获 ${count} 个，显示 ${shown} 个`);
    if (shown > 0) { sniffed = true; break; }
  }

  if (sniffed) {
    // 4. 过滤选项检查
    const filterOpts = await evalJs(cdp, "[...document.querySelectorAll('#sniff-filter option')].map(o=>o.value).join(',')");
    console.log('✓ 格式过滤选项:', filterOpts);

    // 5. 全选 → 批量下载
    await evalJs(cdp, "document.querySelector('#sniff-sel-all').click()");
    await sleep(300);
    const countText = await evalJs(cdp, "document.querySelector('#sniff-count').textContent");
    console.log('✓ 全选后:', countText);
    await evalJs(cdp, "document.querySelector('#sniff-download').click()");
    await sleep(1000);

    // 6. 自动切回下载页，任务已入队
    const jobs = await evalJs(cdp, '(async () => (await opentube.listJobs()).length)()');
    console.log(`✓ 批量下载已入队 ${jobs} 个任务（自动切回下载页）`);
    if (jobs < 1) throw new Error('批量下载未入队');
  } else {
    // B 站首页没触发嗅探，用稳定的直链页面兜底验证机制
    console.log('⚠ B 站首页未捕获到媒体，用直链页面兜底验证批量机制');
    await evalJs(cdp, "document.querySelector('#browser-url').value = 'https://www.runoob.com/try/demo_source/movie.mp4'; document.querySelector('#browser-go').onclick()");
    for (let i = 0; i < 12; i++) {
      await sleep(2000);
      const shown = await evalJs(cdp, "document.querySelectorAll('.sniff-item').length");
      if (shown > 0) break;
    }
    const shown = await evalJs(cdp, "document.querySelectorAll('.sniff-item').length");
    if (!shown) throw new Error('嗅探面板无条目');
    console.log(`✓ 嗅探到 ${shown} 个媒体`);
    await evalJs(cdp, "document.querySelector('#sniff-sel-all').click()");
    await evalJs(cdp, "document.querySelector('#sniff-download').click()");
    await sleep(1000);
    const jobs = await evalJs(cdp, '(async () => (await opentube.listJobs()).length)()');
    console.log(`✓ 批量下载已入队 ${jobs} 个任务`);
    if (jobs < 1) throw new Error('批量下载未入队');
  }

  console.log('\n===== 快捷站点 + 批量嗅探验证通过 =====');
  cdp.close();
  process.exit(0);
}
main().catch((e) => { console.error('✗ 失败:', e.message); process.exit(1); });
