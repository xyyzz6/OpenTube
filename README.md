# OpenTube

免费开源的视频下载器 —— 内置浏览器 + 视频嗅探 + 批量下载，基于 Electron 与 yt-dlp。

打开软件里的浏览器逛视频网站，页面里的视频会被自动嗅探出来，点一下就能下载；支持批量勾选、格式过滤、音视频自动合并，也支持按预设转码。

## 功能特性

- **内置浏览器**：地址栏 + 前进/后退/刷新/主页，常用视频站点（哔哩哔哩、YouTube、抖音、微博、TikTok、X、Instagram、西瓜视频、Vimeo、Dailymotion）一键直达
- **站点快捷方式可自定义**：添加/编辑/删除快捷方式，图标支持字符、emoji、颜色或自定义图片
- **自动嗅探**：浏览网页时自动捕获页面中的视频/音频直链（含 m3u8、mpd、webm、mp4 等格式），侧边栏实时列出
- **批量下载**：嗅探列表支持全选/反选、按格式过滤，勾选后一键批量入队
- **页面下载按钮**：视频卡片/播放器上直接注入「下载」按钮，点击即下载眼前那个视频（抖音 Feed 滑动切换也能正确对应当前视频）
- **下载管理**：正在下载 / 已下载分组显示，进度、速度一目了然
- **音视频合并**：内置 yt-dlp + ffmpeg，分离流（如抖音）自动下载并合并为带声音的完整视频
- **格式转码**：mp4 / mkv / mp3 / HEVC / Android / iPhone 预设一键转码
- **隐私**：内置浏览器使用独立会话（persist:opentube-browser），可配置代理

## 下载安装

前往 [Releases](https://github.com/xyyzz6/OpenTube/releases) 下载：

| 文件 | 说明 |
| --- | --- |
| `OpenTube-Setup-x.x.x.exe` | 安装版，双击安装 |
| `OpenTube-x.x.x-win-portable.zip` | 免安装版，解压后运行 `OpenTube.exe` |

## 从源码运行

要求：Windows 10 及以上、Node.js 18+

```bash
git clone https://github.com/xyyzz6/OpenTube.git
cd OpenTube
npm install
npm run bootstrap   # 下载 yt-dlp.exe 到 bin/（国内可先设置 OPENTUBE_GH_MIRROR 镜像）
npm start
```

ffmpeg（可选，用于转码与合并）：下载后放到 `bin/ffmpeg.exe`，下载地址见 bootstrap 输出提示。

## 打包

```bash
npm run dist
```

产物在 `dist/`：NSIS 安装版 + `win-unpacked/` 免安装版。

## 免责声明

本项目仅供个人学习、研究与保存**允许下载**的内容使用。使用时请：

- 遵守目标网站的服务条款与当地法律法规；
- **不要**用于下载或破解受 DRM（数字版权管理）保护的内容 —— 项目不包含、也不会添加任何 DRM 破解功能；
- 尊重内容创作者的版权。

## 技术栈

Electron 33 · WebContentsView 内置浏览器 · yt-dlp · ffmpeg · 原生 JavaScript（无框架）

## License

[MIT](./LICENSE)
