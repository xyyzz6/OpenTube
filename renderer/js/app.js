// OpenTube 渲染进程逻辑
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const api = window.opentube;

let currentInfo = null;       // 解析结果 {type:'video'|'playlist', ...}
let selectedFormat = 'bv*+ba/b';
let settings = null;
let activeTab = 'download';

// ---------- 页签切换 ----------
function switchTab(tab) {
  activeTab = tab;
  $('#tab-download').classList.toggle('active', tab === 'download');
  $('#tab-browser').classList.toggle('active', tab === 'browser');
  $('#page-download').classList.toggle('hidden', tab !== 'download');
  $('#page-browser').classList.toggle('hidden', tab !== 'browser');
  if (tab === 'browser') {
    syncBrowserBounds();
    setStartPage(startShown); // 未导航时显示起始页并隐藏内置视图
  } else {
    api.browserVisible(false);
    api.browserBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
}

// ---------- 起始页（未导航时的站点网格，填补空白） ----------
let startShown = true;
function setStartPage(show) {
  startShown = show;
  $('#start-page').classList.toggle('hidden', !show);
  if (activeTab === 'browser') api.browserVisible(!show);
}
function openUrl(u) {
  if (!u) return;
  if (!/^https?:\/\//i.test(u) && !/\.[a-z]{2,}/i.test(u)) {
    u = 'https://www.bing.com/search?q=' + encodeURIComponent(u); // 非网址按搜索处理
  }
  setStartPage(false);
  syncBrowserBounds(); // 视图显示前刷新尺寸，避免沿用旧的 bounds（面板折叠/布局变化后）
  api.browserNavigate(u);
}
$('#tab-download').onclick = () => switchTab('download');
$('#tab-browser').onclick = () => switchTab('browser');
$('#btn-settings').onclick = () => api.openSettings();

function syncBrowserBounds() {
  const rect = $('#browser-container').getBoundingClientRect();
  api.browserBounds({ x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) });
}
window.addEventListener('resize', () => { if (activeTab === 'browser') syncBrowserBounds(); });

// ---------- 链接解析 ----------
async function parseUrl() {
  const url = $('#url-input').value.trim();
  if (!url) return;
  hide($('#parse-error'));
  const btn = $('#btn-parse');
  btn.disabled = true; btn.textContent = '解析中…';
  try {
    currentInfo = await api.getInfo(url);
    if (currentInfo.type === 'playlist') renderPlaylist();
    else renderVideo();
  } catch (e) {
    show($('#parse-error'), '解析失败：' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '解析';
  }
}
$('#btn-parse').onclick = parseUrl;
$('#url-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') parseUrl(); });

function show(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function fmtDuration(sec) {
  if (!sec && sec !== 0) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}

function renderVideo() {
  hide($('#playlist-result'));
  const v = currentInfo;
  $('#video-title').textContent = v.info.title;
  const dur = fmtDuration(v.info.duration);
  $('#video-meta').textContent = [v.info.extractor, dur ? '时长 ' + dur : ''].filter(Boolean).join(' · ');
  const tb = $('#fmt-table');
  tb.innerHTML = '<table><thead><tr><th></th><th>类型</th><th>格式</th><th>分辨率</th><th>帧率</th><th>大小</th><th>备注</th></tr></thead><tbody>' +
    v.info.formats.map((f, i) =>
      `<tr data-id="${f.id}"><td><input type="radio" name="frow" /></td><td>${f.kind === 'video' ? '视频' : '音频'}</td><td>${f.ext}</td><td>${f.res}</td><td>${f.fps}</td><td>${f.size}</td><td>${f.note}</td></tr>`
    ).join('') + '</tbody></table>';
  tb.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.onclick = () => {
      tb.querySelectorAll('tr').forEach((r) => r.classList.remove('sel'));
      tr.classList.add('sel');
      tr.querySelector('input').checked = true;
      selectedFormat = tr.dataset.id;
    };
  });
  show2($('#video-result'));
}
function show2(el) { el.classList.remove('hidden'); }

function renderPlaylist() {
  hide($('#video-result'));
  const p = currentInfo;
  $('#pl-title').textContent = p.title;
  $('#pl-meta').textContent = `共 ${p.count} 个视频`;
  $('#pl-count').textContent = '';
  const list = $('#pl-list');
  list.innerHTML = p.entries.map((e, i) =>
    `<label class="pl-item"><input type="checkbox" checked data-i="${i}" /><span class="t">${i + 1}. ${e.title}</span></label>`
  ).join('');
  list.querySelectorAll('input').forEach((c) => c.onchange = updatePlCount);
  updatePlCount();
  show2($('#playlist-result'));
}
function updatePlCount() {
  const n = $$('#pl-list input:checked').length;
  $('#pl-count').textContent = `已选 ${n} / ${currentInfo.entries.length}`;
}
$('#pl-all').onclick = () => { $$('#pl-list input').forEach((c) => c.checked = true); updatePlCount(); };
$('#pl-none').onclick = () => { $$('#pl-list input').forEach((c) => c.checked = false); updatePlCount(); };

$('#btn-download').onclick = async () => {
  if (!currentInfo) return;
  const fmt = $('input[name="fmt"]:checked')?.value || selectedFormat;
  const formatId = fmt === 'bv*+ba/b' || fmt === 'ba/b' ? fmt : selectedFormat;
  await api.enqueue([{ kind: 'download', url: currentInfo.info.webpage_url || $('#url-input').value.trim(), formatId, title: currentInfo.info.title }]);
  $('#video-result').classList.add('hidden');
};

$('#btn-pl-download').onclick = async () => {
  const idx = $$('#pl-list input:checked').map((c) => +c.dataset.i);
  const tasks = idx.map((i) => ({ kind: 'download', url: currentInfo.entries[i].url, formatId: 'bv*+ba/b', title: currentInfo.entries[i].title }));
  if (tasks.length) await api.enqueue(tasks);
  $('#playlist-result').classList.add('hidden');
};

// ---------- 任务列表 ----------
function statusText(j) {
  if (j.status === 'active') return j.phase || '下载中';
  if (j.status === 'pending') return '排队中';
  if (j.status === 'paused') return '已暂停';
  if (j.status === 'done') return '完成';
  if (j.status === 'canceled') return '已取消';
  if (j.status === 'error') return '失败: ' + (j.error || '');
  return j.status;
}

function buildJobCard(j) {
  const div = document.createElement('div');
  div.className = 'job';
  const pct = j.kind === 'convert' || j.percent ? Math.round(j.percent) : 0;
  div.innerHTML = `
    <div class="job-thumb"><svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor"><path d="M5 3.5v9l8-4.5z"/></svg></div>
    <div class="job-main">
      <div class="job-row1">
        <span class="job-title">${escapeHtml(j.title)}</span>
        <span class="job-status ${j.status}">${statusText(j)}</span>
      </div>
      <div class="progress"><div style="width:${j.status === 'done' ? 100 : pct}%"></div></div>
      <div class="job-row2">
        <span>${j.kind === 'convert' ? '转码 ' + j.preset : escapeHtml(j.url).slice(0, 80)}</span>
        <span>${j.speed || ''}</span><span>${j.eta ? '剩余 ' + j.eta : ''}</span>
        <div class="job-actions"></div>
      </div>
    </div>`;
  const actions = div.querySelector('.job-actions');
  const addBtn = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label; b.onclick = fn; actions.appendChild(b);
  };
  if (j.status === 'active') addBtn('暂停', () => api.jobAction('pause', j.id));
  if (j.status === 'paused' || j.status === 'error') addBtn('继续', () => api.jobAction('resume', j.id));
  if (['active', 'pending', 'paused'].includes(j.status)) addBtn('取消', () => api.jobAction('cancel', j.id));
  if (j.status === 'done' && j.kind === 'download') addBtn('转码', () => openConvertModal(j));
  if (j.status === 'done' && j.filePath) addBtn('打开位置', () => api.showItem(j.filePath));
  if (!['active', 'pending'].includes(j.status)) addBtn('移除', () => api.jobAction('remove', j.id));
  return div;
}

// ---------- 任务列表：正在下载 / 已下载 页签 ----------
let lastJobs = [];
let jobView = 'active'; // 'active' | 'done'

function setJobView(v) {
  jobView = v;
  $('#job-seg-active').classList.toggle('active', v === 'active');
  $('#job-seg-done').classList.toggle('active', v === 'done');
  renderJobs(lastJobs);
}
$('#job-seg-active').onclick = () => setJobView('active');
$('#job-seg-done').onclick = () => setJobView('done');

function renderJobs(jobs) {
  lastJobs = jobs;
  const list = $('#jobs-list');
  list.innerHTML = '';
  const isActive = (j) => ['active', 'pending', 'paused'].includes(j.status);
  const nActive = jobs.filter(isActive).length;
  const nDone = jobs.length - nActive;
  $('#job-seg-active').textContent = nActive ? `正在下载（${nActive}）` : '正在下载';
  $('#job-seg-done').textContent = nDone ? `已下载（${nDone}）` : '已下载';
  const items = jobView === 'active' ? jobs.filter(isActive) : jobs.filter((j) => !isActive(j));
  if (!items.length) {
    list.innerHTML = `<div class="jobs-empty">${jobView === 'active'
      ? '暂无正在下载的任务，已完成的任务请切换到「已下载」查看'
      : '暂无已下载的任务'}</div>`;
    return;
  }
  for (const j of items) list.appendChild(buildJobCard(j));
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

api.on('jobs', renderJobs);
api.listJobs().then(renderJobs);

// ---------- 转码弹窗 ----------
let convertJob = null;
async function openConvertModal(job) {
  convertJob = job;
  const presets = await api.listPresets();
  const names = presets.map((p) => `<button data-p="${p.name}">${p.name}</button>`).join('');
  let modal = $('#convert-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'convert-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:99';
    modal.innerHTML = `<div class="card" style="width:320px">
      <div class="video-title">选择转码预设</div>
      <div id="preset-btns" style="display:flex;flex-wrap:wrap;gap:8px">${names}</div>
      <div class="card-actions"><button class="ghost" id="convert-cancel">取消</button></div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#convert-cancel').onclick = () => modal.remove();
  } else {
    modal.querySelector('#preset-btns').innerHTML = names;
    modal.style.display = 'flex';
  }
  modal.querySelectorAll('#preset-btns button').forEach((b) => {
    b.className = 'ghost';
    b.onclick = async () => {
      await api.enqueue([{ kind: 'convert', preset: b.dataset.p, inputFile: convertJob.filePath, title: convertJob.title + ' → ' + b.dataset.p }]);
      modal.remove();
    };
  });
}

// ---------- 浏览器页签 ----------
$('#browser-go').onclick = () => openUrl($('#browser-url').value.trim());
$('#browser-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#browser-go').onclick(); });
$('#browser-home').onclick = () => { $('#browser-url').value = ''; setStartPage(true); };
$('#browser-back').onclick = () => api.browserBack();
$('#browser-forward').onclick = () => api.browserForward();
$('#browser-refresh').onclick = () => api.browserReload();
$('#browser-clear').onclick = async () => { await api.sniffClear(); sniffSelected.clear(); renderSniff(); };
api.on('browser:url', (u) => { $('#browser-url').value = u; setStartPage(false); });

// ---------- 嗅探面板显示 / 隐藏 ----------
function setSniffPanel(hidden) {
  $('#sniff-panel').classList.toggle('hidden', hidden);
  $('#sniff-toggle').classList.toggle('active', hidden);
  try { localStorage.setItem('sniffPanelHidden', hidden ? '1' : '0'); } catch (_) {}
  if (activeTab === 'browser') syncBrowserBounds(); // 面板宽度变化后立即同步内置视图尺寸
}
$('#sniff-toggle').onclick = () => setSniffPanel(!$('#sniff-panel').classList.contains('hidden'));
$('#sniff-collapse').onclick = () => setSniffPanel(true);
setSniffPanel((() => { try { return localStorage.getItem('sniffPanelHidden') === '1'; } catch (_) { return false; } })());

// ---------- 「可下载链接」徽章 ----------
// 计数 = 嗅探列表（网络捕获 + 页面 video 直链）；browser:buttons 仅作刷新+脉冲信号
async function refreshBadge(pulse = false) {
  const items = await api.sniffList();
  const b = $('#dl-badge');
  const n = items.length;
  if (!n) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  b.textContent = `可下载链接 (${n})`;
  if (pulse) {
    b.classList.remove('pulse');
    void b.offsetWidth; // 重启动画
    b.classList.add('pulse');
  }
}
$('#dl-badge').onclick = () => {
  // 面板常驻，闪烁嗅探列表提示用户查看
  const list = $('#sniff-list');
  list.classList.remove('pulse');
  void list.offsetWidth;
  list.classList.add('pulse');
};
api.on('browser:buttons', () => refreshBadge(true));
api.on('sniffed', () => refreshBadge());

// ---------- 常用站点快捷方式（可自定义） ----------
// 字母头像本地渲染（Google favicon 服务在国内被墙，不可用）
const DEFAULT_SITES = [
  { name: '哔哩哔哩', url: 'https://www.bilibili.com', color: '#fb7299' },
  { name: 'YouTube', url: 'https://www.youtube.com', color: '#ff0000' },
  { name: '抖音', url: 'https://www.douyin.com', color: '#333333' },
  { name: '微博视频', url: 'https://weibo.com', color: '#e6162d' },
  { name: 'TikTok', url: 'https://www.tiktok.com', color: '#25f4ee' },
  { name: 'X(Twitter)', url: 'https://x.com', color: '#1d9bf0' },
  { name: 'Instagram', url: 'https://www.instagram.com', color: '#e1306c' },
  { name: '西瓜视频', url: 'https://www.ixigua.com', color: '#f04142' },
  { name: 'Vimeo', url: 'https://vimeo.com', color: '#1ab7ea' },
  { name: 'Dailymotion', url: 'https://www.dailymotion.com', color: '#0066dc' }
];
const SITES_KEY = 'customSites';

function loadSites() {
  try {
    const arr = JSON.parse(localStorage.getItem(SITES_KEY) || 'null');
    if (Array.isArray(arr)) {
      return arr.filter((s) => s && typeof s.name === 'string' && typeof s.url === 'string' && s.name && s.url);
    }
  } catch (_) {}
  return DEFAULT_SITES.map((s) => ({ ...s }));
}
function saveSites(list) { try { localStorage.setItem(SITES_KEY, JSON.stringify(list)); } catch (_) {} }

function normalizeSiteUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  return u;
}

// 图标渲染优先级：自定义图片 > 自定义字符/emoji > 名称首字 + 颜色
function siteIconHtml(s) {
  if (s.img) return `<img class="site-img" src="${escapeHtml(s.img)}" alt="">`;
  const t = (typeof s.icon === 'string' ? s.icon.trim() : '');
  const ch = t ? [...t].slice(0, 2).join('') : (s.name[0] || '站');
  return `<span class="site-avatar" style="color:${escapeHtml(s.color || '#0071e3')}">${escapeHtml(ch)}</span>`;
}

function renderQuickSites() {
  const box = $('#quick-sites');
  const sites = loadSites();
  box.innerHTML = '';
  sites.forEach((s, i) => {
    const tile = document.createElement('div');
    tile.className = 'quick-site';
    tile.innerHTML = `
      <span class="site-icon-wrap">${siteIconHtml(s)}
        <span class="site-mini edit" title="编辑">✎</span>
        <span class="site-mini del" title="删除">×</span>
      </span>
      <span class="site-name">${escapeHtml(s.name)}</span>`;
    tile.onclick = (e) => {
      if (e.target.closest('.site-mini')) return;
      $('#browser-url').value = s.url;
      openUrl(s.url);
    };
    tile.querySelector('.site-mini.edit').onclick = (e) => { e.stopPropagation(); openSiteDialog(i); };
    tile.querySelector('.site-mini.del').onclick = (e) => {
      e.stopPropagation();
      const list = loadSites();
      list.splice(i, 1);
      saveSites(list);
      renderQuickSites();
    };
    box.appendChild(tile);
  });
  // 「添加」磁贴
  const add = document.createElement('div');
  add.className = 'quick-site site-add';
  add.innerHTML = `<span class="site-icon-wrap"><span class="site-avatar">+</span></span><span class="site-name">添加</span>`;
  add.onclick = () => openSiteDialog(-1);
  box.appendChild(add);
}
renderQuickSites();

// 恢复默认站点（两步确认，避免误点）
$('#sites-reset').onclick = () => {
  const btn = $('#sites-reset');
  if (btn.dataset.arm !== '1') {
    btn.dataset.arm = '1';
    btn.textContent = '再点一次确认恢复默认';
    setTimeout(() => { btn.dataset.arm = ''; btn.textContent = '恢复默认站点'; }, 2500);
    return;
  }
  btn.dataset.arm = '';
  btn.textContent = '恢复默认站点';
  try { localStorage.removeItem(SITES_KEY); } catch (_) {}
  renderQuickSites();
};

// ---------- 站点编辑弹窗（名称/网址/图标字符/颜色/图片，实时预览） ----------
const SITE_COLORS = ['#fb7299', '#ff0000', '#333333', '#e6162d', '#25f4ee', '#1d9bf0', '#e1306c', '#f04142', '#1ab7ea', '#0066dc', '#34c759', '#ff9500', '#af52de', '#0071e3'];
function openSiteDialog(idx) {
  const editing = idx >= 0;
  const list = loadSites();
  const base = editing ? { ...list[idx] } : { name: '', url: '', color: '#0071e3', icon: '', img: '' };
  let img = base.img && !/^https?:/i.test(base.img) ? base.img : ''; // 上传图片的 dataURL
  $('#site-modal') && $('#site-modal').remove();
  const modal = document.createElement('div');
  modal.id = 'site-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99';
  modal.innerHTML = `
    <div class="card site-dialog">
      <div class="video-title">${editing ? '编辑站点' : '添加站点'}</div>
      <div class="site-preview" id="site-preview"></div>
      <div class="site-row"><label>名称</label><input id="site-name" class="site-inp" placeholder="如 哔哩哔哩" value="${escapeHtml(base.name)}"></div>
      <div class="site-row"><label>网址</label><input id="site-url" class="site-inp" placeholder="www.example.com" value="${escapeHtml(base.url)}"></div>
      <div class="site-row"><label>图标</label><input id="site-icon" class="site-inp" placeholder="留空用名称首字，可输入 emoji" value="${escapeHtml(base.icon || '')}"></div>
      <div class="site-row"><label>颜色</label><span id="site-swatches">
        ${SITE_COLORS.map((c) => `<span class="swatch${c === base.color ? ' on' : ''}" data-c="${c}" style="background:${c}"></span>`).join('')}
        <input type="color" id="site-color" value="${escapeHtml(base.color || '#0071e3')}" title="自定义颜色">
      </span></div>
      <div class="site-row"><label>图片</label><span class="site-img-ops">
        <button class="ghost small" id="site-img-file-btn" type="button">上传图片</button>
        <input id="site-img-url" class="site-inp" style="flex:1;min-width:0" placeholder="或粘贴图片网址（可选）" value="${escapeHtml(/^https?:/i.test(base.img || '') ? base.img : '')}">
        <button class="ghost small" id="site-img-clear" type="button">清除</button>
      </span></div>
      <input type="file" id="site-img-file" accept="image/*" hidden>
      <div class="card-actions">
        ${editing ? '<button class="ghost danger" id="site-del" type="button">删除</button>' : ''}
        <span style="flex:1"></span>
        <button class="ghost" id="site-cancel" type="button">取消</button>
        <button class="primary" id="site-save" type="button">保存</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const preview = () => {
    const name = $('#site-name').value.trim();
    const icon = $('#site-icon').value.trim();
    const imgUrl = $('#site-img-url').value.trim();
    const src = img || (/^https?:/i.test(imgUrl) ? imgUrl : '');
    $('#site-preview').innerHTML = src
      ? `<img class="site-img" src="${escapeHtml(src)}" alt="">`
      : `<span class="site-avatar" style="color:${escapeHtml($('#site-color').value)}">${escapeHtml((icon ? [...icon].slice(0, 2).join('') : (name[0] || '站')))}</span>`;
  };
  ['#site-name', '#site-icon', '#site-img-url'].forEach((s2) => $(s2).addEventListener('input', preview));
  $('#site-color').addEventListener('input', () => {
    modal.querySelectorAll('.swatch.on').forEach((x) => x.classList.remove('on'));
    preview();
  });
  modal.querySelectorAll('.swatch').forEach((sw) => {
    sw.onclick = () => {
      modal.querySelectorAll('.swatch.on').forEach((x) => x.classList.remove('on'));
      sw.classList.add('on');
      $('#site-color').value = sw.dataset.c;
      preview();
    };
  });
  $('#site-img-file-btn').onclick = () => $('#site-img-file').click();
  $('#site-img-file').onchange = () => {
    const f = $('#site-img-file').files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      // 压缩为 96×96 圆形头像用的方形封面图，控制 localStorage 体积
      const im = new Image();
      im.onload = () => {
        try {
          const N = 96;
          const c = document.createElement('canvas');
          c.width = N; c.height = N;
          const ctx = c.getContext('2d');
          const scale = Math.max(N / im.width, N / im.height);
          ctx.drawImage(im, (N - im.width * scale) / 2, (N - im.height * scale) / 2, im.width * scale, im.height * scale);
          img = c.toDataURL('image/png');
        } catch (_) { img = String(rd.result); }
        $('#site-img-url').value = '';
        preview();
      };
      im.onerror = () => { img = String(rd.result); preview(); };
      im.src = String(rd.result);
    };
    rd.readAsDataURL(f);
  };
  $('#site-img-clear').onclick = () => { img = ''; $('#site-img-url').value = ''; $('#site-img-file').value = ''; preview(); };
  $('#site-cancel').onclick = () => modal.remove();
  const delBtn = modal.querySelector('#site-del');
  if (delBtn) delBtn.onclick = () => {
    if (delBtn.dataset.arm !== '1') { delBtn.dataset.arm = '1'; delBtn.textContent = '确认删除'; return; }
    list.splice(idx, 1);
    saveSites(list);
    modal.remove();
    renderQuickSites();
  };
  $('#site-save').onclick = () => {
    const url = normalizeSiteUrl($('#site-url').value);
    if (!url) { $('#site-url').focus(); return; }
    let name = $('#site-name').value.trim();
    if (!name) { try { name = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { name = '站点'; } }
    const icon = $('#site-icon').value.trim();
    const imgUrl = $('#site-img-url').value.trim();
    const imgSrc = img || (/^https?:/i.test(imgUrl) ? imgUrl : '');
    const entry = { name, url, color: $('#site-color').value, icon: icon && icon !== name[0] ? icon : '', img: imgSrc };
    if (editing) list[idx] = entry; else list.push(entry);
    saveSites(list);
    modal.remove();
    renderQuickSites();
  };
  preview();
}

// ---------- 嗅探面板（批量版） ----------
let sniffItems = [];        // 完整捕获列表
const sniffSelected = new Set(); // 选中的 url 集合

function extFilter() { return $('#sniff-filter').value; }

function refreshFilterOptions() {
  const sel = $('#sniff-filter');
  const cur = sel.value;
  const exts = [...new Set(sniffItems.map((i) => i.ext).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">全部格式</option>' + exts.map((e) => `<option value="${e}">${e}</option>`).join('');
  sel.value = exts.includes(cur) ? cur : '';
}

function visibleItems() {
  const f = extFilter();
  return f ? sniffItems.filter((i) => i.ext === f) : sniffItems;
}

async function renderSniff() {
  sniffItems = await api.sniffList();
  // 保持选中状态（只保留仍存在的）
  const urls = new Set(sniffItems.map((i) => i.url));
  for (const u of [...sniffSelected]) if (!urls.has(u)) sniffSelected.delete(u);
  refreshFilterOptions();

  const shown = visibleItems();
  const list = $('#sniff-list');
  list.innerHTML = '';
  if (!shown.length) {
    list.innerHTML = '<div class="sniff-empty">浏览网页时，页面中的视频会自动出现在这里，可勾选后批量下载。</div>';
    updateSniffCount();
    return;
  }
  for (const it of shown) {
    const div = document.createElement('div');
    div.className = 'sniff-item';
    const checked = sniffSelected.has(it.url) ? 'checked' : '';
    div.innerHTML = `
      <input type="checkbox" ${checked} />
      <div class="body">
        <div class="row"><span class="badge">${escapeHtml(it.ext)}</span>${it.source === 'tag' ? '<span class="muted">页面视频</span>' : ''}</div>
        <div class="u">${escapeHtml(it.url)}</div>
        <div class="row"><span class="muted">${it.size ? '大小 ' + it.size : ''}</span><button>下载</button></div>
      </div>`;
    div.querySelector('input').onchange = (e) => {
      e.target.checked ? sniffSelected.add(it.url) : sniffSelected.delete(it.url);
      updateSniffCount();
    };
    div.querySelector('button').onclick = () => {
      api.enqueue([{ kind: 'download', url: it.url, formatId: 'bv*+ba/b', title: '嗅探媒体', referer: it.pageUrl }]);
    };
    list.appendChild(div);
  }
  updateSniffCount();
}

function updateSniffCount() {
  const shown = visibleItems();
  const sel = shown.filter((i) => sniffSelected.has(i.url)).length;
  $('#sniff-count').textContent = `共 ${sniffItems.length} 个 · 当前显示 ${shown.length} · 已选 ${sel}`;
}

$('#sniff-filter').onchange = renderSniff;
$('#sniff-sel-all').onclick = () => { visibleItems().forEach((i) => sniffSelected.add(i.url)); renderSniff(); };
$('#sniff-sel-none').onclick = () => { visibleItems().forEach((i) => sniffSelected.delete(i.url)); renderSniff(); };
$('#sniff-clear').onclick = async () => { await api.sniffClear(); sniffSelected.clear(); renderSniff(); };

$('#sniff-download').onclick = async () => {
  const tasks = visibleItems()
    .filter((i) => sniffSelected.has(i.url))
    .map((i) => ({ kind: 'download', url: i.url, formatId: 'bv*+ba/b', title: '嗅探媒体 ' + i.ext, referer: i.pageUrl }));
  if (!tasks.length) {
    $('#sniff-count').textContent = '请先勾选要下载的媒体';
    return;
  }
  await api.enqueue(tasks);
  sniffSelected.clear();
  renderSniff();
  // 自动切回下载页查看进度
  switchTab('download');
};

api.on('sniffed', () => { if (activeTab === 'browser') renderSniff(); });
api.sniffList().then((items) => { if (items.length) { sniffItems = items; renderSniff(); } });

// ---------- 初始化 ----------
api.getSettings().then((s) => {
  settings = s;
  if (!s.downloadDir) return;
}).then(() => api.engineStatus()).then((st) => {
  if (!st.ytDlp) {
    show($('#parse-error'), '未找到 yt-dlp 引擎：请运行 npm run bootstrap 下载，或在设置中手动指定路径。');
  }
});
