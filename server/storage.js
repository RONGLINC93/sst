/**
 * JSON 文件存储层
 * 负责所有数据的持久化读写，数据存储在 data/ 目录下的 JSON 文件中
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// 确保数据目录存在
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 同步读取 JSON 文件，不存在则返回默认值
function readJSON(file, def) {
  ensureDir();
  const fp = path.join(DATA_DIR, file);
  if (!fs.existsSync(fp)) return def;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    console.error('读取 JSON 失败:', file, e.message);
    return def;
  }
}

// 同步写入 JSON 文件
function writeJSON(file, data) {
  ensureDir();
  const fp = path.join(DATA_DIR, file);
  try {
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('写入 JSON 失败:', file, e.message);
  }
}

// 异步读取（用于非阻塞场景）
async function readJSONAsync(file, def) {
  ensureDir();
  const fp = path.join(DATA_DIR, file);
  try {
    await fs.promises.access(fp);
    const content = await fs.promises.readFile(fp, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    return def;
  }
}

// 异步写入
async function writeJSONAsync(file, data) {
  ensureDir();
  const fp = path.join(DATA_DIR, file);
  await fs.promises.writeFile(fp, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = { readJSON, writeJSON, readJSONAsync, writeJSONAsync, DATA_DIR };
