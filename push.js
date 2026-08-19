#!/usr/bin/env node
/**
 * 推送脚本：commit + push
 * 用法：
 *   node push.js              # 默认 commit message
 *   node push.js "修复某 bug" # 自定义 commit message
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 读取 .env 中的 GITHUB_TOKEN
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.error('\x1b[31m[错误]\x1b[0m 未找到 .env 文件');
  process.exit(1);
}
const envContent = fs.readFileSync(envPath, 'utf8');
const tokenMatch = envContent.match(/GITHUB_TOKEN=(.+)/);
if (!tokenMatch) {
  console.error('\x1b[31m[错误]\x1b[0m .env 中未找到 GITHUB_TOKEN');
  process.exit(1);
}
const TOKEN = tokenMatch[1].trim();
const REPO_URL = `https://${TOKEN}@github.com/RONGLINC93/sst.git`;

// commit message
const argMsg = process.argv[2];
const msg = argMsg || `chore: update ${new Date().toLocaleString('zh-CN')}`;

function run(cmd, label) {
  console.log(`\n\x1b[36m[${label}]\x1b[0m ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: __dirname });
  } catch (e) {
    console.error(`\x1b[31m[失败]\x1b[0m ${label}`);
    process.exit(1);
  }
}

run('git add .', '1/3 添加文件');
run(`git commit -m "${msg.replace(/"/g, '\\"')}"`, '2/3 提交：' + msg);
run(`git push ${REPO_URL} main`, '3/3 推送');

console.log('\n\x1b[32m完成。\x1b[0m');
