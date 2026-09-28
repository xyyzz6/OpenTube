// 引导脚本：下载 yt-dlp.exe 到项目 bin/（ffmpeg 优先复用本机已有的）
// 用法：npm run bootstrap
// 国内网络可先设置镜像环境变量：set OPENTUBE_GH_MIRROR=https://ghproxy.net
const fs = require('fs');
const path = require('path');
const https = require('https');

const BIN = path.join(__dirname, '..', 'bin');
const YTDLP_URLS = [
  (m) => `${m || 'https://github.com'}/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe`,
  (m) => `${m || 'https://github.com'}/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe`
];

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('重定向过多'));
    const req = https.get(url, { headers: { 'User-Agent': 'OpenTube/0.1' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' - ' + url));
      }
      const file = fs.createWriteStream(dest);
      let got = 0, total = +(res.headers['content-length'] || 0), lastPct = -1;
      res.on('data', (c) => {
        got += c.length;
        if (total) {
          const pct = Math.floor((got / total) * 100);
          if (pct !== lastPct) { lastPct = pct; process.stdout.write(`\r下载中 ${pct}% (${(got / 1048576).toFixed(1)}MB)`); }
        }
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); console.log('\n完成: ' + dest); resolve(); });
      file.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('连接超时')));
  });
}

async function main() {
  fs.mkdirSync(BIN, { recursive: true });
  const ytDlp = path.join(BIN, 'yt-dlp.exe');
  const mirror = process.env.OPENTUBE_GH_MIRROR || '';

  if (fs.existsSync(ytDlp)) {
    console.log('yt-dlp.exe 已存在: ' + ytDlp);
  } else {
    let ok = false;
    for (const mk of YTDLP_URLS) {
      try {
        await download(mk(mirror), ytDlp);
        ok = true;
        break;
      } catch (e) {
        console.error('尝试失败: ' + e.message);
      }
    }
    if (!ok) {
      console.error('\nyt-dlp.exe 下载失败。请手动下载并放到 bin/yt-dlp.exe：');
      console.error('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe');
      process.exit(1);
    }
  }

  // ffmpeg：本机已有就直接复制，否则提示手动下载
  const ffmpeg = path.join(BIN, 'ffmpeg.exe');
  if (fs.existsSync(ffmpeg)) {
    console.log('ffmpeg.exe 已存在: ' + ffmpeg);
  } else {
    const known = 'e:\\boki\\抖音直播录屏工具\\tools\\ffmpeg.exe';
    if (fs.existsSync(known)) {
      fs.copyFileSync(known, ffmpeg);
      console.log('已从本机复制 ffmpeg.exe: ' + known + ' -> ' + ffmpeg);
    } else {
      console.log('\n未找到 ffmpeg.exe（可选，用于转码与音视频合并）。');
      console.log('请下载并放到 bin/ffmpeg.exe：https://www.gyan.dev/ffmpeg/builds/');
    }
  }
  console.log('\n引导完成，运行 npm start 启动 OpenTube');
}

main().catch((e) => { console.error(e); process.exit(1); });
