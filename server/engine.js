/**
 * 股票数据引擎 - 服务端版本
 * 生成A股股票池、K线、分时、指数、板块、资讯
 * 启动时生成并持久化到 JSON 文件，运行时定时波动价格
 */
const storage = require('./storage');

// 工具函数
const rnd = (min, max) => Math.random() * (max - min) + min;
const rndInt = (min, max) => Math.floor(rnd(min, max + 1));
const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const pick = (arr) => arr[rndInt(0, arr.length - 1)];
const fmtPct = (pct) => (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';

// 板块
const SECTORS = [
  '银行', '证券', '保险', '房地产开发', '白酒概念', '中药',
  '医疗器械', '新能源', '光伏', '半导体', '消费电子', '人工智能',
  '汽车整车', '钢铁', '煤炭', '电力', '军工', '家电', '食品加工', '传媒'
];

const NAME_POOL = [
  ['贵州', '茅台镇', '五粮', '剑南', '泸州', '汾', '古井', '洋河', '水井', '舍得'],
  ['工商', '建设', '农业', '中国', '交通', '招商', '兴业', '民生', '浦发', '光大'],
  ['中信', '海通', '国泰', '华泰', '广发', '东方', '银河', '国信', '申万', '招商证'],
  ['比亚迪', '宁德', '隆基', '通威', '阳光', '晶澳', '天合', '亿纬', '恩捷', '汇川'],
  ['北方', '中航', '航发', '中船', '中国', '航天', '洪都', '中兵', '光电', '长城'],
  ['京东方', 'TCL', '立讯', '歌尔', '蓝思', '领益', '工业', '传音', '环旭', '闻泰'],
  ['恒瑞', '药明', '迈瑞', '爱尔', '片仔', '云南', '同仁', '华润', '复星', '华海'],
  ['万科', '保利', '招商蛇', '金地', '绿地', '华夏', '新城', '华侨城', '荣盛', '中南'],
  ['美的', '格力', '海尔', '老板', '苏泊尔', '九阳', '小熊', '飞科', '科沃斯', '莱克'],
  ['海天', '伊利', '蒙牛', '双汇', '安井', '千禾', '中炬', '涪陵', '三全', '克明']
];

function generateStocks() {
  const stocks = [];
  let codeIdx = 0;

  NAME_POOL.forEach((names, sectorIdx) => {
    const sector = SECTORS[sectorIdx % SECTORS.length];
    names.forEach((n) => {
      codeIdx++;
      let prefix, market;
      if (sectorIdx === 0) { prefix = '600' + String(200 + codeIdx).padStart(3, '0'); market = 'SH'; }
      else if (sectorIdx === 1) { prefix = '600' + String(300 + codeIdx).padStart(3, '0'); market = 'SH'; }
      else if (sectorIdx === 2) { prefix = '600' + String(400 + codeIdx).padStart(3, '0'); market = 'SH'; }
      else if (sectorIdx === 3) { prefix = '300' + String(100 + codeIdx).padStart(3, '0'); market = 'SZ'; }
      else if (sectorIdx === 4) { prefix = '600' + String(500 + codeIdx).padStart(3, '0'); market = 'SH'; }
      else if (sectorIdx === 5) { prefix = '002' + String(100 + codeIdx).padStart(3, '0'); market = 'SZ'; }
      else if (sectorIdx === 6) { prefix = '300' + String(200 + codeIdx).padStart(3, '0'); market = 'SZ'; }
      else if (sectorIdx === 7) { prefix = '000' + String(100 + codeIdx).padStart(3, '0'); market = 'SZ'; }
      else if (sectorIdx === 8) { prefix = '000' + String(200 + codeIdx).padStart(3, '0'); market = 'SZ'; }
      else { prefix = '603' + String(100 + codeIdx).padStart(3, '0'); market = 'SH'; }

      const name = n + (sectorIdx === 0 ? '业' : sectorIdx === 1 ? '银行' : sectorIdx === 2 ? '证券' : '股份');
      const basePrice = round2(rnd(5, 800));
      const totalShares = round2(rnd(1, 200));
      const floatShares = round2(totalShares * rnd(0.3, 0.95));

      stocks.push({
        code: prefix, market, name, sector,
        basePrice, price: basePrice, preClose: basePrice,
        open: basePrice, high: basePrice, low: basePrice,
        totalShares, floatShares,
        klines: [], minuteData: []
      });
    });
  });
  return stocks;
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function minuteIndexToTime(idx) {
  let hour, minute;
  if (idx < 120) {
    const total = 30 + idx;
    hour = 9 + Math.floor(total / 60);
    minute = total % 60;
  } else {
    const m = idx - 120;
    hour = 13 + Math.floor(m / 60);
    minute = m % 60;
  }
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function generateKlines(stock, days = 120) {
  const klines = [];
  let price = stock.basePrice * rnd(0.6, 0.9);
  let trend = rnd(-0.001, 0.001);

  for (let i = days; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const day = date.getDay();
    if (day === 0 || day === 6) continue;

    const volatility = rnd(0.008, 0.035);
    const change = trend + (Math.random() - 0.5) * volatility;
    let open = price;
    let close = round2(open * (1 + change));
    const limit = (stock.code.startsWith('300') || stock.code.startsWith('688')) ? 0.2 : 0.1;
    close = clamp(close, open * (1 - limit), open * (1 + limit));

    const high = round2(Math.max(open, close) * (1 + Math.random() * volatility * 0.6));
    const low = round2(Math.min(open, close) * (1 - Math.random() * volatility * 0.6));
    const volume = Math.round(rnd(stock.floatShares * 0.001, stock.floatShares * 0.08) * 1e8);
    const amount = round2(volume * (high + low) / 2 / 1e8);
    const turnover = round2(volume / 1e8 / stock.floatShares * 100);
    if (Math.random() < 0.08) trend = rnd(-0.003, 0.003);

    klines.push({
      date: formatDate(date), open: round2(open), close, high, low,
      volume, amount, turnover, pct: round2((close - open) / open * 100)
    });
    price = close;
  }

  if (klines.length > 0) {
    const last = klines[klines.length - 1];
    stock.preClose = klines.length > 1 ? klines[klines.length - 2].close : last.open;
    stock.open = last.open; stock.high = last.high; stock.low = last.low; stock.price = last.close;
  }
  stock.klines = klines;
  return klines;
}

function generateMinuteData(stock) {
  const data = [];
  const basePrice = stock.preClose;
  let price = stock.open;
  const totalVol = stock.floatShares * 1e8 * rnd(0.01, 0.06);
  let accVol = 0;

  for (let i = 0; i < 240; i++) {
    const time = minuteIndexToTime(i);
    const volatility = rnd(0.0005, 0.003);
    const change = (Math.random() - 0.5) * volatility;
    price = round2(price * (1 + change));
    const limit = (stock.code.startsWith('300') || stock.code.startsWith('688')) ? 0.2 : 0.1;
    price = clamp(price, basePrice * (1 - limit), basePrice * (1 + limit));
    const vol = Math.round(totalVol / 240 * rnd(0.3, 2.5));
    accVol += vol;
    data.push({
      time, price, avgPrice: round2((stock.open + price) / 2 + rnd(-0.2, 0.2)),
      volume: vol, amount: round2(vol * price / 1e4), accVol
    });
  }
  stock.minuteData = data;
  if (data.length > 0) {
    stock.price = data[data.length - 1].price;
    stock.high = Math.max(...data.map(d => d.price));
    stock.low = Math.min(...data.map(d => d.price));
  }
  return data;
}

function generateIndices(stocks) {
  return [
    { code: '000001', name: '上证指数', market: 'SH', baseVal: 3300 },
    { code: '399001', name: '深证成指', market: 'SZ', baseVal: 10500 },
    { code: '399006', name: '创业板指', market: 'SZ', baseVal: 2100 },
    { code: '000300', name: '沪深300', market: 'SH', baseVal: 3900 },
    { code: '000688', name: '科创50', market: 'SH', baseVal: 980 },
    { code: '000016', name: '上证50', market: 'SH', baseVal: 2650 }
  ].map(idx => {
    const value = round2(idx.baseVal * rnd(0.92, 1.08));
    const preClose = round2(value * rnd(0.97, 1.03));
    const pct = round2((value - preClose) / preClose * 100);
    return { ...idx, value, preClose, change: round2(value - preClose), pct };
  });
}

// 实时价格波动（服务端定时调用）
function tickPrices(stocks) {
  stocks.forEach(stock => {
    const volatility = rnd(0.0005, 0.004);
    const change = (Math.random() - 0.5) * volatility * 2;
    let newPrice = round2(stock.price * (1 + change));
    const limit = (stock.code.startsWith('300') || stock.code.startsWith('688')) ? 0.2 : 0.1;
    newPrice = clamp(newPrice, stock.preClose * (1 - limit), stock.preClose * (1 + limit));
    stock.price = newPrice;
    stock.high = Math.max(stock.high, newPrice);
    stock.low = Math.min(stock.low, newPrice);

    if (stock.minuteData.length > 0) {
      stock.minuteData[stock.minuteData.length - 1].price = newPrice;
    }
    if (stock.klines.length > 0) {
      const lastK = stock.klines[stock.klines.length - 1];
      lastK.close = newPrice;
      lastK.high = Math.max(lastK.high, newPrice);
      lastK.low = Math.min(lastK.low, newPrice);
      lastK.pct = round2((newPrice - lastK.open) / lastK.open * 100);
    }
  });
}

function tickIndices(indices) {
  indices.forEach(idx => {
    const change = (Math.random() - 0.5) * idx.value * 0.0008;
    idx.value = round2(idx.value + change);
    idx.change = round2(idx.value - idx.preClose);
    idx.pct = round2(idx.change / idx.preClose * 100);
  });
}

// 计算指标
function calcMetrics(stock) {
  const change = round2(stock.price - stock.preClose);
  const pct = round2(change / stock.preClose * 100);
  const amount = round2(stock.price * stock.floatShares * rnd(0.005, 0.05) / 10);
  const volume = Math.round(amount * 1e8 / stock.price);
  const turnover = round2(volume / 1e8 / stock.floatShares * 100);
  const marketCap = round2(stock.price * stock.totalShares);
  const floatMarketCap = round2(stock.price * stock.floatShares);
  const pe = round2(rnd(8, 80));
  const pb = round2(rnd(0.8, 12));
  const limit = (stock.code.startsWith('300') || stock.code.startsWith('688')) ? 0.2 : 0.1;
  const upLimit = round2(stock.preClose * (1 + limit));
  const downLimit = round2(stock.preClose * (1 - limit));
  return {
    change, pct, amount, volume, turnover, marketCap, floatMarketCap,
    pe, pb, upLimit, downLimit, amplitude: round2((stock.high - stock.low) / stock.preClose * 100)
  };
}

function generateOrderBook(stock) {
  const book = { asks: [], bids: [] };
  const spread = stock.price * 0.001;
  for (let i = 0; i < 5; i++) {
    book.asks.push({ price: round2(stock.price + spread * (i + 1)), volume: rndInt(1, 5000) * 100 });
    book.bids.push({ price: round2(stock.price - spread * (i + 1)), volume: rndInt(1, 5000) * 100 });
  }
  return book;
}

function generateDeals(stock, count = 30) {
  const deals = [];
  for (let i = 0; i < count; i++) {
    const bs = Math.random() > 0.5 ? '买' : '卖';
    const price = round2(stock.price * (1 + (Math.random() - 0.5) * 0.002));
    const vol = rndInt(1, 100) * 100;
    const now = new Date();
    now.setSeconds(now.getSeconds() - (count - i) * rndInt(3, 15));
    deals.push({
      time: String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0'),
      price, volume: vol, bs
    });
  }
  return deals;
}

const INDUSTRIES = { '银行': '货币金融服务', '证券': '资本市场服务', '白酒概念': '酒制造业', '新能源': '电气机械制造业' };

function generateCompanyInfo(stock) {
  return {
    industry: INDUSTRIES[stock.sector] || '通用制造业',
    listingDate: (2010 + rndInt(0, 13)) + '-' + String(rndInt(1, 12)).padStart(2, '0') + '-' + String(rndInt(1, 28)).padStart(2, '0'),
    chairman: pick(['张明', '李华', '王强', '刘伟', '陈刚', '赵勇', '孙杰', '周涛']),
    generalManager: pick(['吴军', '郑波', '冯雷', '杨光', '朱辉', '秦峰']),
    registeredCapital: stock.totalShares + '亿元',
    mainBusiness: '主营业务涵盖' + stock.sector + '相关产品的研发、生产与销售，是国内领先的' + stock.sector + '企业之一。',
    revenue: round2(rnd(10, 5000)) + '亿',
    netProfit: round2(rnd(1, 800)) + '亿',
    grossMargin: round2(rnd(15, 75)) + '%',
    netMargin: round2(rnd(5, 40)) + '%',
    roe: round2(rnd(3, 30)) + '%'
  };
}

const NEWS_TEMPLATES = [
  '${name}发布${year}年${quarter}度业绩报告，净利润同比增长${pct}%',
  '${name}获得${amount}亿元重大合同订单',
  '${name}拟以${amount}亿元回购公司股份',
  '${name}控股股东解除质押${pct}%股份',
  '${name}${sector}板块异动，主力资金净流入${amount}亿',
  '${name}新增概念题材：${concept}',
  '${name}召开${year}年第一次临时股东大会',
  '机构调研${name}，看好${sector}行业前景'
];
const CONCEPTS = ['人工智能', '元宇宙', '数字经济', '碳中和', '东数西算', 'Web3.0', '机器人', '算力', '低空经济', '固态电池'];

function generateNews(stocks, count = 15) {
  const news = [];
  for (let i = 0; i < count; i++) {
    const stock = pick(stocks);
    const tpl = pick(NEWS_TEMPLATES);
    const now = new Date();
    now.setMinutes(now.getMinutes() - i * rndInt(5, 30));
    const content = tpl
      .replace('${name}', stock.name).replace('${year}', String(now.getFullYear()))
      .replace('${quarter}', pick(['第一', '第二', '第三', '第四']))
      .replace('${pct}', rndInt(-30, 80)).replace('${amount}', rndInt(1, 50))
      .replace('${pct}', rndInt(5, 50)).replace('${sector}', stock.sector)
      .replace('${concept}', pick(CONCEPTS));
    news.push({
      time: formatDate(now) + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'),
      code: stock.code, name: stock.name,
      content, type: pick(['公告', '资讯', '研报', '异动'])
    });
  }
  return news;
}

// ============ 数据管理器 ============
// 行情数据（stocks/indices/news）存内存，定时波动并持久化
// 用户数据（account/holdings/orders/deals/watchlist）直接读写 JSON 文件

// 使用对象包装，避免重新赋值导致引用失效
const data = { stocks: [], indices: [], news: [] };

function initData() {
  // 尝试加载已持久化的行情数据，否则重新生成
  const saved = storage.readJSON('stocks.json', null);
  if (saved && saved.stocks && saved.stocks.length) {
    data.stocks = saved.stocks;
    data.indices = saved.indices || generateIndices(data.stocks);
    data.news = saved.news || generateNews(data.stocks, 30);
    console.log(`已加载行情数据：${data.stocks.length}只股票，${data.indices.length}个指数`);
  } else {
    console.log('首次启动，生成模拟行情数据...');
    data.stocks = generateStocks();
    data.stocks.forEach(s => { generateKlines(s); generateMinuteData(s); });
    data.indices = generateIndices(data.stocks);
    data.news = generateNews(data.stocks, 30);
    persistMarketData();
    console.log(`已生成 ${data.stocks.length} 只股票、${data.indices.length} 个指数`);
  }

  // 初始化用户数据（如果不存在）
  initUserData();
}

function persistMarketData() {
  storage.writeJSON('stocks.json', {
    stocks: data.stocks, indices: data.indices, news: data.news,
    savedAt: new Date().toISOString()
  });
}

function initUserData() {
  const account = storage.readJSON('account.json', null);
  if (!account) {
    storage.writeJSON('account.json', {
      cash: 1000000, initCash: 1000000, totalAsset: 1000000,
      marketValue: 0, frozenCash: 0, profit: 0, profitPct: 0
    });
  }
  if (!storage.readJSON('holdings.json', null)) storage.writeJSON('holdings.json', []);
  if (!storage.readJSON('orders.json', null)) storage.writeJSON('orders.json', []);
  if (!storage.readJSON('deals.json', null)) storage.writeJSON('deals.json', []);
  if (!storage.readJSON('watchlist.json', null)) storage.writeJSON('watchlist.json', []);
}

module.exports = {
  get stocks() { return data.stocks; },
  get indices() { return data.indices; },
  get news() { return data.news; },
  sectors: SECTORS,
  tickPrices, tickIndices, calcMetrics, generateOrderBook, generateDeals,
  generateCompanyInfo, generateNews, generateMinuteData,
  initData, persistMarketData,
  getStock: (code) => data.stocks.find(s => s.code === code),
  search: (kw) => data.stocks.filter(s => s.name.includes(kw) || s.code.includes(kw)),
  round2, fmtPct, pick
};
