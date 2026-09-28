// 设置与数据持久化
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DATA_DIR = () => path.join(app.getPath('userData'), 'data');

function ensureDir() {
  try { fs.mkdirSync(DATA_DIR(), { recursive: true }); } catch (_) {}
}

function loadJSON(name, def) {
  ensureDir();
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR(), name), 'utf8'));
  } catch (_) {
    return def;
  }
}

function saveJSON(name, obj) {
  ensureDir();
  try {
    fs.writeFileSync(path.join(DATA_DIR(), name), JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('saveJSON failed', name, e.message);
  }
}

const DEFAULT_SETTINGS = {
  downloadDir: path.join(app.getPath('videos'), 'OpenTube'),
  maxConcurrent: 3,
  ytDlpPath: '',
  ffmpegPath: '',
  proxyUrl: ''
};

function getSettings() {
  const saved = loadJSON('settings.json', {});
  return Object.assign({}, DEFAULT_SETTINGS, saved);
}

function saveSettings(patch) {
  const merged = Object.assign(getSettings(), patch || {});
  saveJSON('settings.json', merged);
  return merged;
}

module.exports = { getSettings, saveSettings, loadJSON, saveJSON, DATA_DIR };
