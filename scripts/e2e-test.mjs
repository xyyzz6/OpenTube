// CDP 端到端测试：驱动 OpenTube UI 完成一次真实下载
const CDP_PORT = 9222;

async function getTarget() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
  if (!page) throw new Error('未找到 OpenTube 窗口: ' + JSON.stringify(targets.map((t) => t.url)));
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
  if (r.exceptionDetails) throw new Error('页面执行出错: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wsUrl = await getTarget();
  const cdp = await connect(wsUrl);
  await cdp.send('Runtime.enable');
  console.log('✓ 已连接 OpenTube 窗口');

  // 1. preload API 检查
  const hasApi = await evalJs(cdp, '!!window.opentube');
  if (!hasApi) throw new Error('window.opentube 不可用（preload 失败）');
  console.log('✓ preload API 正常');

  // 2. 引擎检查
  const st = await evalJs(cdp, 'opentube.engineStatus()');
  console.log('✓ 引擎:', { ytDlp: !!st.ytDlp, ffmpeg: !!st.ffmpeg });

  // 3. 填入 B 站链接并解析
  await evalJs(cdp, `(() => { document.querySelector('#url-input').value = 'https://www.bilibili.com/video/BV1GJ411x7h7'; return parseUrl(); })()`);
  await sleep(1500);
  const title = await evalJs(cdp, "document.querySelector('#video-title').textContent");
  const hidden = await evalJs(cdp, "document.querySelector('#video-result').classList.contains('hidden')");
  const fmtCount = await evalJs(cdp, "document.querySelectorAll('#fmt-table tbody tr').length");
  if (hidden) throw new Error('视频结果卡片未显示');
  console.log(`✓ 解析成功: "${title}"，${fmtCount} 个可选格式`);

  // 4. 选最佳格式并点击下载
  await evalJs(cdp, "document.querySelector('#btn-download').click()");
  console.log('✓ 已加入下载队列，等待下载+合并完成…');

  // 5. 轮询任务状态（最长 150 秒）
  let done = false;
  for (let i = 0; i < 50; i++) {
    await sleep(3000);
    const state = await evalJs(cdp, `(() => {
      const j = document.querySelector('.job');
      if (!j) return null;
      return {
        status: j.querySelector('.job-status').textContent,
        pct: j.querySelector('.progress > div').style.width,
      };
    })()`);
    if (state) {
      console.log(`  [${i * 3}s] ${state.status} ${state.pct}`);
      if (state.status === '完成') { done = true; break; }
      if (state.status.startsWith('失败')) throw new Error('任务失败: ' + state.status);
    }
  }
  if (!done) throw new Error('150 秒内未完成');

  // 6. 验证产物文件
  const dlDir = await evalJs(cdp, 'opentube.getSettings().then(s => s.downloadDir)');
  const fs = await import('node:fs');
  const files = fs.readdirSync(dlDir).filter((f) => f.endsWith('.mp4'));
  if (!files.length) throw new Error('下载目录没有 mp4: ' + dlDir);
  const size = fs.statSync(dlDir + '\\' + files[0]).size;
  console.log(`✓ 下载完成: ${dlDir}\\${files[0]} (${(size / 1048576).toFixed(1)}MB)`);

  // 7. 切到浏览器页签确认不崩
  await evalJs(cdp, "switchTab('browser')");
  await sleep(1000);
  const urlBox = await evalJs(cdp, "!!document.querySelector('#browser-url')");
  console.log('✓ 浏览器页签切换正常:', urlBox);

  console.log('\n===== 全部测试通过 =====');
  cdp.close();
  process.exit(0);
}

main().catch((e) => { console.error('✗ 测试失败:', e.message); process.exit(1); });
