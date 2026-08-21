/**
 * 模拟炒股 - 前端数据 API 层
 * 所有数据通过 fetch 请求 Node.js 后端，不再使用 localStorage
 * 数据持久化由服务端 JSON 文件负责
 */
(function (global) {
  'use strict';

  const API = '/api';

  // 通用请求
  async function request(path, options) {
    const opts = options || {};
    opts.headers = opts.headers || {};
    if (opts.body && typeof opts.body === 'object') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(API + path, opts);
    if (!res.ok) throw new Error('请求失败: ' + res.status);
    const json = await res.json();
    if (json.success === false) throw new Error(json.msg || '操作失败');
    return json;
  }

  // ============ 行情数据 ============
  async function getStocks(params) {
    const qs = new URLSearchParams(params || {}).toString();
    const r = await request('/stocks' + (qs ? '?' + qs : ''));
    return r.data;
  }

  async function getIndices() {
    const r = await request('/indices');
    return r.data;
  }

  async function getSectors() {
    const r = await request('/sectors');
    return r.data;
  }

  async function getStock(code) {
    const r = await request('/stock/' + code);
    return r.data;
  }

  async function getOrderBook(code) {
    const r = await request('/orderbook/' + code);
    return r.data;
  }

  async function getDeals(code) {
    const r = await request('/deals/' + code);
    return r.data;
  }

  async function getCompany(code) {
    const r = await request('/company/' + code);
    return r.data;
  }

  async function getNews(count) {
    const r = await request('/news' + (count ? '?count=' + count : ''));
    return r.data;
  }

  async function search(kw) {
    const r = await request('/search?kw=' + encodeURIComponent(kw));
    return r.data;
  }

  // ============ 用户数据 ============
  async function getAccount() {
    const r = await request('/account');
    return r.data;
  }

  async function getHoldings() {
    const r = await request('/holdings');
    return r.data;
  }

  async function getOrders() {
    const r = await request('/orders');
    return r.data;
  }

  async function getDealsHistory() {
    const r = await request('/deals-history');
    return r.data;
  }

  async function getWatchlist() {
    const r = await request('/watchlist');
    return r.data;
  }

  // ============ 交易操作 ============
  async function submitTrade(side, code, price, volume) {
    const r = await request('/trade', { method: 'POST', body: { side, code, price, volume } });
    return r;
  }

  async function cancelOrder(orderId) {
    const r = await request('/cancel-order', { method: 'POST', body: { orderId } });
    return r;
  }

  async function toggleWatch(code) {
    const r = await request('/watchlist/toggle', { method: 'POST', body: { code } });
    return r.data;
  }

  async function removeWatch(code) {
    const r = await request('/watchlist/remove', { method: 'POST', body: { code } });
    return r;
  }

  async function resetAccount() {
    const r = await request('/account/reset', { method: 'POST' });
    return r;
  }

  async function addCash(amount) {
    const r = await request('/account/deposit', { method: 'POST', body: { amount } });
    return r;
  }

  // 行情布局
  async function getLayout() {
    const r = await request('/layout');
    return r.data;
  }
  async function saveLayout(layout) {
    await request('/layout', { method: 'POST', body: { layout } });
  }

  // 侧边栏导航顺序
  async function getNavOrder() {
    const r = await request('/nav-order');
    return r.data;
  }
  async function saveNavOrder(order) {
    await request('/nav-order', { method: 'POST', body: { order } });
  }

  // 侧边栏导航隐藏
  async function getNavHidden() {
    const r = await request('/nav-hidden');
    return r.data;
  }
  async function saveNavHidden(hidden) {
    await request('/nav-hidden', { method: 'POST', body: { hidden } });
  }

  // 工具函数（前端需要的格式化）
  const round2 = (n) => Math.round(n * 100) / 100;
  const fmtPct = (pct) => (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
  const cls = (pct) => pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';

  // 公开 API
  global.DataEngine = {
    // 行情
    getStocks, getIndices, getSectors, getStock, getOrderBook,
    getDeals, getCompany, getNews, search,
    // 用户数据
    getAccount, getHoldings, getOrders, getDealsHistory, getWatchlist,
    // 交易
    submitTrade, cancelOrder, toggleWatch, removeWatch, resetAccount, addCash,
    // 布局
    getLayout, saveLayout,
    getNavOrder, saveNavOrder,
    getNavHidden, saveNavHidden,
    // 工具
    round2, fmtPct, cls
  };

})(window);
