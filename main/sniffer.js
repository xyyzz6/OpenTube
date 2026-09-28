// 被动嗅探：拦截内置浏览器的媒体请求（m3u8/mpd/mp4 等）
const MEDIA_EXT = /\.(m3u8|mpd|mp4|webm|flv|ts|m4a|mp3|aac|mov|opus)(\?|#|$)/i;
const MEDIA_CT = /(mpegurl|dash\+xml|video\/|audio\/|application\/octet-stream)/i;
// 明显不是媒体的网络噪声：站点 API / 埋点 / protobuf（octet-stream 会被误判，需按 URL 排除）
const NOISE_URL = /(\/aweme\/v1\/web\/|device_platform=webapp|\.so(\?|#|$)|\/dm\/web\/|applog|\/monitor\/|acrawler|bdturing|\/passsport|\/service\/|\/passport\/|\/captcha\/|\/log\/|byteeffecttos\.com)/i;
const MAX_ITEMS = 60;

class Sniffer {
  constructor() {
    this.items = [];       // 捕获的媒体 {url, ext, contentType, pageUrl, size, ts}
    this.listeners = new Set();
    this.attachedSession = null;
  }

  onItem(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  attach(session) {
    if (this.attachedSession === session) return;
    this.detach();
    this.attachedSession = session;
    const record = (details) => {
      const url = details.url || '';
      if (!/^https?:/i.test(url)) return;
      const ct = this.headerValue(details.responseHeaders, 'content-type');
      // 排除页面/接口类响应，避免嗅探列表噪声
      if (ct && /json|javascript|text\/html|text\/plain|^image\//i.test(ct)) return;
      const hit = MEDIA_EXT.test(url) || (ct && MEDIA_CT.test(ct));
      if (!hit) return;
      // API/埋点噪声（octet-stream 的接口响应）：按 URL 特征排除
      if (this.isNoise(url)) return;
      // ts 分片太多，只保留前几条
      if (/\.ts(\?|#|$)/i.test(url) && this.items.filter((i) => i.ext === 'ts').length >= 3) return;
      const ext = (url.match(MEDIA_EXT) || [])[1] || (ct && ct.includes('mpegurl') ? 'm3u8' : '') || 'bin';
      // 相同 URL 去重
      if (this.items.some((i) => i.url === url)) return;
      const item = {
        url,
        ext,
        contentType: ct || '',
        pageUrl: details.referrer || details.frame?.url || '',
        size: this.headerValue(details.responseHeaders, 'content-length') || '',
        ts: Date.now()
      };
      this.addItem(item);
    };
    this._onComplete = (details) => record(details);
    session.webRequest.onCompleted({ urls: ['*://*/*'] }, this._onComplete);
  }

  detach() {
    if (this.attachedSession) {
      try { this.attachedSession.webRequest.onCompleted({ urls: [] }, null); } catch (_) {}
      this.attachedSession = null;
    }
  }

  addItem(item) {
    if (this.items.some((i) => i.url === item.url)) return false;
    this.items.unshift(item);
    if (this.items.length > MAX_ITEMS) this.items.pop();
    for (const cb of this.listeners) cb(item);
    return true;
  }

  headerValue(headers, name) {
    if (!headers) return '';
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
    return key ? String(headers[key][0] || '') : '';
  }

  isNoise(url) { return NOISE_URL.test(url); }

  clear() { this.items = []; }

  list() { return this.items; }

  // 页面内 <video> 标签扫描脚本（由 browserview 轮询执行）
  static get SCAN_SCRIPT() {
    return `(() => {
      const out = [];
      try {
        document.querySelectorAll('video,video source,audio,audio source').forEach((el) => {
          const s = el.currentSrc || el.src || el.getAttribute('src');
          if (s && /^https?:/i.test(s)) out.push({ url: s, source: 'tag' });
        });
      } catch (_) {}
      return JSON.stringify(out);
    })()`;
  }
}

module.exports = new Sniffer();
