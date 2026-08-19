#!/usr/bin/env node
/**
 * 拉取脚本：pull + 显示最近提交
 * 用法：node pull.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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

function run(cmd, label) {
  console.log(`\n\x1b[36m[${label}]\x1b[0m ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: __dirname });
  } catch (e) {
    console.error(`\x1b[31m[失败]\x1b[0m ${label}`);
    process.exit(1);
  }
}

run(`git pull ${REPO_URL} main`, '1/2 拉取最新');
run('git log -n 5 --oneline', '2/2 最近提交');

console.log('\n\x1b[32m完成。\x1b[0m');
