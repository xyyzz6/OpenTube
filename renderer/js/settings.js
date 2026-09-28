const $ = (s) => document.querySelector(s);
const api = window.opentube;

api.getSettings().then((s) => {
  $('#download-dir').value = s.downloadDir || '';
  $('#max-concurrent').value = s.maxConcurrent || 3;
  $('#yt-dlp-path').value = s.ytDlpPath || '';
  $('#ffmpeg-path').value = s.ffmpegPath || '';
  $('#proxy-url').value = s.proxyUrl || '';
});

$('#choose-dir').onclick = async () => {
  const d = await api.chooseDir();
  if (d) $('#download-dir').value = d;
};
$('#choose-ytdlp').onclick = async () => {
  const f = await api.chooseFile();
  if (f) $('#yt-dlp-path').value = f;
};
$('#choose-ffmpeg').onclick = async () => {
  const f = await api.chooseFile();
  if (f) $('#ffmpeg-path').value = f;
};

$('#btn-save').onclick = async () => {
  await api.saveSettings({
    downloadDir: $('#download-dir').value.trim(),
    maxConcurrent: Math.max(1, Math.min(8, +$('#max-concurrent').value || 3)),
    ytDlpPath: $('#yt-dlp-path').value.trim(),
    ffmpegPath: $('#ffmpeg-path').value.trim(),
    proxyUrl: $('#proxy-url').value.trim()
  });
  $('#status').textContent = '已保存';
  setTimeout(() => { $('#status').textContent = ''; }, 2000);
};

$('#btn-update').onclick = async () => {
  $('#status').textContent = '正在更新 yt-dlp…';
  const msg = await api.updateYtDlp();
  $('#status').textContent = msg;
};
