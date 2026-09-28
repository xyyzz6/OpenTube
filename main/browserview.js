// 内置浏览器：WebContentsView 管理 + 页面注入（嗅探 video 标签 + 视频卡片下载按钮）
const { WebContentsView } = require('electron');
const path = require('path');
const sniffer = require('./sniffer');

// 页面注入脚本：给视频卡片链接和 <video> 挂「下载」按钮（幂等），并收集 video 直链
// 命中 yt-dlp 支持的站点页链接 → 点击下载该页面视频；<video> → 下载当前页
const INJECT_SCRIPT = `(() => {
  const PAT = /(bilibili\\.com\\/video\\/|youtube\\.com\\/watch|youtu\\.be\\/|douyin\\.com\\/(video|note)\\/|ixigua\\.com\\/\\d{6}|tiktok\\.com\\/.+\\/video\\/|weibo\\.com\\/tv\\/show|v\\.weibo\\.com|kuaishou\\.com\\/short-video\\/|music\\.163\\.com\\/song\\?id=|vimeo\\.com\\/\\d{6,})/;
  let added = 0; const tagUrls = [];
  // 持续追踪「用户眼前的视频 id」：注入脚本每 2.5s 才跑一次；更关键的是滚动切换时
  // 上一条视频往往仍在播放（!paused 会命中旧视频），因此改为按「屏幕中央 + 面积」评分，
  // 「正在播放」只做小幅加权，绝不主导判定
  if (!window.__otTrackerInstalled) {
    window.__otTrackerInstalled = true;
    window.__otActiveVideoId = '';
    window.__otActiveVideoAt = 0;
    const RE_ID = /\\/(?:video|note)\\/(\\d{15,})/;
    const isId = (s) => !!s && /^\\d{15,}$/.test(s);
    const idOfVideo = (v) => {
      let el = v;
      for (let i = 0; i < 12 && el; i++) {
        const av = el.getAttribute && el.getAttribute('data-e2e-vid');
        if (isId(av)) return av;
        if (i >= 1 && i <= 4 && el.querySelector) {
          // 无 data-e2e-vid 时从就近的详情页链接取 aweme_id（要求尺寸与本视频相近，避免串到别的条目）
          const a = el.querySelector('a[href*="/video/"],a[href*="/note/"]');
          const m = (a && a.href) ? a.href.match(RE_ID) : null;
          if (m) {
            try {
              const ir = a.getBoundingClientRect(), vr = v.getBoundingClientRect();
              if (ir.width <= Math.max(vr.width * 1.6, 320) && ir.height <= Math.max(vr.height * 1.6, 320)) return m[1];
            } catch (_) { return m[1]; }
          }
        }
        el = el.parentElement;
      }
      return '';
    };
    // 判定依据是「几何位置」（用户眼前画面），平台自报的激活屏只做加权与兜底：
    // 滚动切换时激活屏标记会滞后，若直接信任它就会下载到滑走的上一条视频
    const inActiveBox = (v) => {
      try {
        const box = v.closest('[data-e2e="feed-active-video"]');
        if (!box) return false;
        const br = box.getBoundingClientRect();
        return br.width > 0 && br.height > 0 && br.bottom > 40 && br.top < window.innerHeight - 40;
      } catch (_) { return false; }
    };
    window.__otResolveActiveId = () => {
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      let best = '', bestScore = 0;
      document.querySelectorAll('video').forEach((v) => {
        try {
          const r = v.getBoundingClientRect();
          if (r.width < 80 || r.height < 80) return;
          if (r.bottom <= 0 || r.top >= window.innerHeight) return;
          if (r.right <= 0 || r.left >= window.innerWidth) return;
          const id = idOfVideo(v);
          if (!id) return;
          const dx = Math.abs(r.left + r.width / 2 - cx) / window.innerWidth;
          const dy = Math.abs(r.top + r.height / 2 - cy) / window.innerHeight;
          let score = r.width * r.height * (1 - Math.min(0.6, dx + dy));
          if (!v.paused && v.readyState >= 2 && v.currentTime > 0.15) score *= 1.12; // 小幅加权
          if (inActiveBox(v)) score *= 1.25; // 平台标记的激活屏，同样只是加权
          if (score > bestScore) { bestScore = score; best = id; }
        } catch (_) {}
      });
      if (best) return best;
      // 兜底：几何评分拿不到 id 时，才使用平台自报的激活屏（且必须在视口内）
      try {
        const act = document.querySelector('[data-e2e="feed-active-video"]');
        if (act) {
          const ar = act.getBoundingClientRect();
          if (ar.width > 0 && ar.height > 0 && ar.bottom > 40 && ar.top < window.innerHeight - 40) {
            const av = act.getAttribute('data-e2e-vid');
            if (isId(av)) return av;
            const m = (act.querySelector('a[href*="/video/"],a[href*="/note/"]') || {}).href;
            const mm = m ? m.match(RE_ID) : null;
            if (mm) return mm[1];
          }
        }
      } catch (_) {}
      return '';
    };
    const refresh = () => {
      try {
        const id = window.__otResolveActiveId();
        if (id) { window.__otActiveVideoId = id; window.__otActiveVideoAt = Date.now(); }
      } catch (_) {}
    };
    setInterval(refresh, 200);
    // 滚动与播放事件即时刷新（比轮询更及时）
    window.addEventListener('scroll', () => { refresh(); setTimeout(refresh, 120); setTimeout(refresh, 300); }, true);
    window.__otHookVideos = () => {
      document.querySelectorAll('video').forEach((v) => {
        if (v.__otHooked) return;
        v.__otHooked = 1;
        ['playing', 'timeupdate'].forEach((ev) => v.addEventListener(ev, refresh, true));
      });
    };
  }
  if (window.__otHookVideos) window.__otHookVideos();
  const mkBtn = (host, url) => {
    // 幂等且目标可动态更新：视频源就绪后（如抖音 Feed 从 blob 变直链）自动改写
    const exist = host.querySelector(':scope > .ot-dl-btn');
    if (exist) { if (exist.dataset.otUrl !== url) exist.dataset.otUrl = url; return exist; }
    try {
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      const b = document.createElement('button');
      b.textContent = '下载';
      b.className = 'ot-dl-btn';
      b.dataset.otUrl = url;
      b.style.cssText = 'position:absolute;top:6px;right:6px;z-index:2147483647;background:#0071e3;color:#fff;border:none;border-radius:6px;padding:4px 11px;font:600 12px/1.6 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.28)';
      b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        let target = b.dataset.otUrl || '';
        if (b.dataset.otPlayer === '1') {
          // 播放器按钮：点击瞬间优先用常驻追踪器解析「眼前的视频」，
          // 避免刷视频中 dataset 停留在旧目标导致下错视频
          target = '';
          try { if (typeof window.__otResolveActiveId === 'function') { const live = window.__otResolveActiveId(); if (live) target = 'https://www.douyin.com/video/' + live; } } catch (_) {}
          if (!target) {
            try { const cached = window.__otActiveVideoId; if (cached) target = 'https://www.douyin.com/video/' + cached; } catch (_) {}
          }
          if (!target) {
          try {
            const cands = [];
            const inHost = b.parentElement && b.parentElement.querySelector('video');
            if (inHost) cands.push(inHost);
            const playing = [...document.querySelectorAll('video')]
              .filter((x) => !x.paused && x.currentSrc && x.currentTime > 0.15)
              .sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height; })[0];
            if (playing) cands.push(playing);
            for (const el of cands) {
              let p = el.parentElement;
              for (let i = 0; i < 10 && p && !target; i++) {
                const av = p.getAttribute && p.getAttribute('data-e2e-vid');
                if (av && /^\\d{15,}$/.test(av)) target = 'https://www.douyin.com/video/' + av;
                p = p.parentElement;
              }
              if (target) break;
            }
            if (!target) {
              const active = document.querySelector('[data-e2e="feed-active-video"]');
              const av = active && active.getAttribute('data-e2e-vid');
              if (av && /^\\d{15,}$/.test(av)) target = 'https://www.douyin.com/video/' + av;
            }
          } catch (_) {}
          }
          if (!target) target = b.dataset.otUrl || '__ot_player__'; // 现场解析失败回退到原目标
        } else if (!target) {
          target = document.URL;
        }
        if (window.opentubePage) window.opentubePage.download(target);
        b.textContent = '已加入✓';
        setTimeout(() => { b.textContent = '下载'; }, 1500);
      }, true);
      host.appendChild(b);
      added++;
      return b;
    } catch (_) { return null; }
  };
  // 尺寸下限：避免把按钮挂到未布局(0x0)或过小的宿主上
  const bigEnough = (r) => r.width >= 120 && r.height >= 60;
  // 1) 视频卡片：只挂在「含图片且尺寸正常」的缩略图链接上
  //    同一张卡片上的标题/作者等纯文字链接会被跳过，避免按钮压到标题文字
  document.querySelectorAll('a[href]').forEach((a) => {
    try {
      if (a.dataset.otNo || a.dataset.otDone) return;
      if (!PAT.test(a.href)) { a.dataset.otNo = '1'; return; }
      if (!a.querySelector('img')) return;           // 纯文字链接，跳过
      if (!bigEnough(a.getBoundingClientRect())) return; // 尚未布局，下次轮询再试
      a.dataset.otDone = '1';
      mkBtn(a, a.href);
    } catch (_) {}
  });
  // 播放器按钮宿主选择：最近链接或与视频尺寸相近的祖先
  const attachPlayerBtn = (v, url) => {
    const vr = v.getBoundingClientRect();
    let host = v.closest('a[href]');
    if (!host) {
      let el = v.parentElement;
      for (let i = 0; i < 3 && el; i++) {
        const r = el.getBoundingClientRect();
        if (bigEnough(r) && r.width <= Math.max(vr.width * 1.6, 320)) { host = el; break; }
        el = el.parentElement;
      }
    }
    if (host && bigEnough(host.getBoundingClientRect())) {
      const b = mkBtn(host, url);
      if (b) b.dataset.otPlayer = '1'; // 点击时现场重新解析，保证对应眼前视频
    }
  };
  document.querySelectorAll('video').forEach((v) => {
    try {
      const s = v.currentSrc || v.src;
      // 目标优先级：详情页链接 > data-e2e-vid（抖音 Feed 的 aweme_id）> http 直链 > 页面详情页 > 哨兵
      // 注意抖音网页是音视频分离流，直链只有画面没声音，必须走详情页让 yt-dlp 合并
      let url = null;
      let el = v.parentElement;
      for (let i = 0; i < 6 && el && !url; i++) {
        for (const a of el.querySelectorAll('a[href]')) {
          if (PAT.test(a.href)) { url = a.href.split('?')[0]; break; }
        }
        el = el.parentElement;
      }
      if (!url) {
        el = v.parentElement;
        for (let i = 0; i < 10 && el; i++) {
          const vid = el.getAttribute && el.getAttribute('data-e2e-vid');
          if (vid && /^\\d{15,}$/.test(vid)) { url = 'https://www.douyin.com/video/' + vid; break; }
          el = el.parentElement;
        }
      }
      if (url) { attachPlayerBtn(v, url); return; }
      if (s && /^https:/i.test(s)) { tagUrls.push(s); attachPlayerBtn(v, s); return; } // 保留签名查询串
      if (PAT.test(document.URL)) { attachPlayerBtn(v, document.URL.split('?')[0]); return; }
      attachPlayerBtn(v, '__ot_player__'); // 主进程从嗅探结果解析最新媒体直链
    } catch (_) {}
  });
  return JSON.stringify({ added, tagUrls });
})()`;

class BrowserPane {
  constructor() {
    this.view = null;
    this.hostWindow = null;
    this.pollTimer = null;
    this.lastBounds = null; // 视图创建前记录的尺寸，创建后立即应用
  }

  ensure(mainWindow) {
    if (this.view) return this.view;
    this.view = new WebContentsView({
      webPreferences: {
        partition: 'persist:opentube-browser',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(__dirname, 'preload-page.js')
      }
    });
    this.view.setBackgroundColor('#ffffff');
    // WebContentsView 必须挂到窗口内容视图才会参与布局与渲染，否则尺寸恒为 0x0（表现为黑屏）
    this.hostWindow = mainWindow;
    mainWindow.contentView.addChildView(this.view);
    if (this.lastBounds) this.view.setBounds(this.lastBounds); // 否则视图 0x0 全黑
    mainBound(mainWindow, this);
    // 拦截会在新窗口打开的链接，改为当前视图导航；私有协议（如 bytedance://）直接拒绝
    this.view.webContents.setWindowOpenHandler(({ url }) => {
      if (!/^https?:\/\//i.test(url)) {
        console.log('[browserview] blocked window.open external scheme:', url.slice(0, 120));
        return { action: 'deny' };
      }
      this.view.webContents.loadURL(url);
      return { action: 'deny' };
    });
    // 拦截页面跳转私有协议（抖音等站点用 bytedance:// 等唤起本机 App）：
    // 取消跳转，避免 Windows 弹「获取打开此 'bytedance' 链接的应用」选择框
    this.view.webContents.on('will-navigate', (e, url) => {
      if (!/^https?:\/\//i.test(url)) {
        e.preventDefault();
        console.log('[browserview] blocked external scheme navigation:', url.slice(0, 120));
      }
    });
    this.view.webContents.on('did-navigate', () => mainNotifyUrl(this.view.webContents.getURL()));
    this.view.webContents.on('did-navigate-in-page', () => mainNotifyUrl(this.view.webContents.getURL()));
    this.startPolling();
    return this.view;
  }

  navigate(mainWindow, url) {
    const view = this.ensure(mainWindow);
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    view.webContents.loadURL(url);
  }

  back() { if (this.view) this.view.webContents.navigationHistory.goBack(); }

  forward() { if (this.view) this.view.webContents.navigationHistory.goForward(); }

  reload() { if (this.view) this.view.webContents.reload(); }

  setBounds(rect) { this.lastBounds = rect; if (this.view) this.view.setBounds(rect); }

  setVisible(v) { if (this.view) this.view.setVisible(v); }

  currentPageUrl() {
    if (!this.view || this.view.webContents.isDestroyed()) return '';
    try { return this.view.webContents.getURL(); } catch (_) { return ''; }
  }

  destroy() {
    this.stopPolling();
    if (this.view && this.hostWindow && !this.hostWindow.isDestroyed()) {
      try { this.hostWindow.contentView.removeChildView(this.view); } catch (_) {}
    }
    this.hostWindow = null;
    this.view = null;
  }

  startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(async () => {
      if (!this.view || this.view.webContents.isDestroyed()) return;
      try {
        const json = await this.view.webContents.executeJavaScript(INJECT_SCRIPT, true);
        const { added, tagUrls } = JSON.parse(json || '{}');
        for (const u of tagUrls || []) {
          sniffer.addItem({
            url: u,
            ext: (u.match(/\.(mp4|webm|m3u8|mpd|mov|flv)(\?|#|$)/i) || [])[1] || 'bin',
            contentType: '',
            pageUrl: this.view.webContents.getURL(),
            size: '',
            ts: Date.now(),
            source: 'tag'
          });
        }
        if (added > 0) mainNotifyAdded(added);
        if (!this._pollTicks || this._pollTicks % 20 === 0) console.log('[browserview] poll tick #' + (this._pollTicks = (this._pollTicks || 0) + 1));
      } catch (e) {
        if (this._pollErrCount) this._pollErrCount++;
        else { this._pollErrCount = 1; console.log('[browserview] poll error:', e && e.message); }
      }
    }, 2500);
  }

  stopPolling() { if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; } }
}

// 模块内引用由 main.js 注入（避免循环依赖）
let hooks = { bound: null, notifyUrl: null, notifyAdded: null };
function mainBound(win, pane) { if (hooks.bound) hooks.bound(win, pane); }
function mainNotifyUrl(url) { if (hooks.notifyUrl) hooks.notifyUrl(url); }
function mainNotifyAdded(n) { if (hooks.notifyAdded) hooks.notifyAdded(n); }
function setHooks(h) { hooks = h; }

module.exports = { BrowserPane: new BrowserPane(), setHooks };
