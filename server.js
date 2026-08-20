/**
 * 模拟炒股 - Node.js 服务器
 * 提供静态文件服务 + REST API
 * 数据存储在 data/ 目录下的 JSON 文件
 */
const express = require('express');
const path = require('path');
const engine = require('./server/engine');
const trader = require('./server/trader');

const app = express();
const PORT = process.env.PORT || 9527;

app.use(express.json());
app.use(express.static(__dirname));

// ============ 行情数据 API ============

// 股票列表（含实时指标）
app.get('/api/stocks', (req, res) => {
  const { sort, limit, sector, market } = req.query;
  let list = engine.stocks.map(s => ({ ...s, metrics: engine.calcMetrics(s) }));
  if (sector) list = list.filter(s => s.sector === sector);
  if (market) list = list.filter(s => s.market === market);
  if (sort) {
    const [field, dir] = sort.split('-');
    list.sort((a, b) => {
      let va, vb;
      if (field === 'pct') { va = a.metrics.pct; vb = b.metrics.pct; }
      else if (field === 'amount') { va = a.metrics.amount; vb = b.metrics.amount; }
      else if (field === 'turnover') { va = a.metrics.turnover; vb = b.metrics.turnover; }
      else if (field === 'price') { va = a.price; vb = b.price; }
      else { va = a.metrics[field]; vb = b.metrics[field]; }
      return dir === 'asc' ? va - vb : vb - va;
    });
  }
  if (limit) list = list.slice(0, parseInt(limit));
  res.json({ success: true, data: list });
});

// 指数
app.get('/api/indices', (req, res) => {
  res.json({ success: true, data: engine.indices });
});

// 板块列表及统计
app.get('/api/sectors', (req, res) => {
  const sectors = engine.sectors.map(name => {
    const ss = engine.stocks.filter(s => s.sector === name);
    if (!ss.length) return null;
    const avgPct = ss.reduce((sum, s) => sum + engine.calcMetrics(s).pct, 0) / ss.length;
    const totalAmount = ss.reduce((sum, s) => sum + engine.calcMetrics(s).amount, 0);
    const gainers = ss.filter(s => engine.calcMetrics(s).pct > 0).length;
    return { name, avgPct, count: ss.length, totalAmount, gainers };
  }).filter(Boolean).sort((a, b) => b.avgPct - a.avgPct);
  res.json({ success: true, data: sectors });
});

// 个股详情
app.get('/api/stock/:code', (req, res) => {
  const s = engine.getStock(req.params.code);
  if (!s) return res.status(404).json({ success: false, msg: '股票不存在' });
  res.json({ success: true, data: { ...s, metrics: engine.calcMetrics(s) } });
});

// 五档买卖盘
app.get('/api/orderbook/:code', (req, res) => {
  const s = engine.getStock(req.params.code);
  if (!s) return res.status(404).json({ success: false, msg: '股票不存在' });
  res.json({ success: true, data: engine.generateOrderBook(s) });
});

// 成交明细
app.get('/api/deals/:code', (req, res) => {
  const s = engine.getStock(req.params.code);
  if (!s) return res.status(404).json({ success: false, msg: '股票不存在' });
  res.json({ success: true, data: engine.generateDeals(s, 30) });
});

// 公司信息
app.get('/api/company/:code', (req, res) => {
  const s = engine.getStock(req.params.code);
  if (!s) return res.status(404).json({ success: false, msg: '股票不存在' });
  res.json({ success: true, data: engine.generateCompanyInfo(s) });
});

// 资讯
app.get('/api/news', (req, res) => {
  const { count } = req.query;
  const news = engine.generateNews(engine.stocks, parseInt(count) || 30);
  res.json({ success: true, data: news });
});

// 搜索
app.get('/api/search', (req, res) => {
  const kw = (req.query.kw || '').trim();
  if (!kw) return res.json({ success: true, data: [] });
  const list = engine.search(kw).slice(0, 12).map(s => ({ ...s, metrics: engine.calcMetrics(s) }));
  res.json({ success: true, data: list });
});

// ============ 用户数据 API ============

// 行情布局
app.get('/api/layout', (req, res) => {
  res.json({ success: true, data: trader.getLayout() });
});
app.post('/api/layout', (req, res) => {
  const { layout } = req.body;
  trader.saveLayout(layout);
  res.json({ success: true });
});

// 账户
app.get('/api/account', (req, res) => {
  res.json({ success: true, data: trader.calcAccount() });
});
app.post('/api/account/reset', (req, res) => {
  res.json(trader.resetAccount());
});
app.post('/api/account/deposit', (req, res) => {
  const { amount } = req.body;
  res.json(trader.addCash(amount));
});

// 持仓
app.get('/api/holdings', (req, res) => {
  const holdings = trader.getHoldings().filter(h => h.volume + h.frozen > 0);
  const account = trader.calcAccount();
  res.json({ success: true, data: { holdings, summary: {
    marketValue: account.marketValue,
    totalProfit: holdings.reduce((s, h) => s + (h.profit || 0), 0),
    cash: account.cash, frozenCash: account.frozenCash,
    count: holdings.length
  } } });
});

// 委托
app.get('/api/orders', (req, res) => {
  const orders = trader.getOrders();
  const active = orders.filter(o => o.status === '申报中' || o.status === '已申报');
  res.json({ success: true, data: { active, all: orders.slice(0, 50) } });
});

// 成交
app.get('/api/deals-history', (req, res) => {
  res.json({ success: true, data: trader.getDeals() });
});

// 自选股
app.get('/api/watchlist', (req, res) => {
  const list = trader.getWatchlist().map(code => {
    const s = engine.getStock(code);
    if (!s) return null;
    return { ...s, metrics: engine.calcMetrics(s) };
  }).filter(Boolean);
  res.json({ success: true, data: list });
});
app.post('/api/watchlist/toggle', (req, res) => {
  const { code } = req.body;
  res.json({ success: true, data: trader.toggleWatch(code) });
});
app.post('/api/watchlist/remove', (req, res) => {
  const { code } = req.body;
  trader.removeWatch(code);
  res.json({ success: true });
});

// ============ 交易 API ============

// 提交交易
app.post('/api/trade', (req, res) => {
  const { side, code, price, volume } = req.body;
  const result = trader.submitTrade(side, code, price, volume);
  res.json(result);
});

// 撤单
app.post('/api/cancel-order', (req, res) => {
  const { orderId } = req.body;
  res.json(trader.cancelOrder(orderId));
});

// ============ 启动服务 ============
engine.initData();

// 定时波动行情（每2秒）
setInterval(() => {
  engine.tickPrices(engine.stocks);
  engine.tickIndices(engine.indices);
}, 2000);

// 定时持久化行情数据（每10秒，避免频繁写盘）
setInterval(() => {
  engine.persistMarketData();
}, 10000);

app.listen(PORT, () => {
  console.log('========================================');
  console.log('  模拟炒股服务器已启动');
  console.log('  访问地址: http://localhost:' + PORT);
  console.log('  数据存储: ' + path.join(__dirname, '..', '\\sst\\data'));
  console.log('========================================');
});
