/**
 * 交易逻辑处理器
 * 处理买入/卖出委托、撮合成交、持仓更新、账户计算
 * 所有数据持久化到 JSON 文件
 */
const storage = require('./storage');
const engine = require('./engine');

const nowStr = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
};

// 读取用户数据
function getAccount() { return storage.readJSON('account.json', { cash: 1000000, initCash: 1000000 }); }
function getHoldings() { return storage.readJSON('holdings.json', []); }
function getOrders() { return storage.readJSON('orders.json', []); }
function getDeals() { return storage.readJSON('deals.json', []); }
function getWatchlist() { return storage.readJSON('watchlist.json', []); }

function saveAccount(a) { storage.writeJSON('account.json', a); }
function saveHoldings(h) { storage.writeJSON('holdings.json', h); }
function saveOrders(o) { storage.writeJSON('orders.json', o); }
function saveDeals(d) { storage.writeJSON('deals.json', d); }
function saveWatchlist(w) { storage.writeJSON('watchlist.json', w); }

// 账户计算（含持仓市值、盈亏）
function calcAccount() {
  const account = getAccount();
  const holdings = getHoldings();
  let marketValue = 0;
  holdings.forEach(h => {
    if (h.volume + h.frozen <= 0) return;
    const s = engine.getStock(h.code);
    if (s) {
      h.price = s.price;
      h.marketValue = Math.round(s.price * (h.volume + h.frozen) * 100) / 100;
      h.profit = Math.round((s.price - h.cost) * (h.volume + h.frozen) * 100) / 100;
      h.profitPct = Math.round((s.price / h.cost - 1) * 10000) / 100;
      marketValue += h.marketValue;
    }
  });
  account.marketValue = Math.round(marketValue * 100) / 100;
  account.totalAsset = Math.round((account.cash + marketValue + account.frozenCash) * 100) / 100;
  account.profit = Math.round((account.totalAsset - account.initCash) * 100) / 100;
  account.profitPct = Math.round((account.totalAsset / account.initCash - 1) * 10000) / 100;
  saveAccount(account);
  saveHoldings(holdings);
  return account;
}

// 提交交易委托
function submitTrade(side, code, price, volume) {
  const s = engine.getStock(code);
  if (!s) return { success: false, msg: '股票不存在' };
  if (!price || price <= 0) return { success: false, msg: '请输入有效价格' };
  if (!volume || volume < 1) return { success: false, msg: '请输入有效数量' };

  const shares = volume * 100;
  const account = getAccount();
  const holdings = getHoldings();
  const orders = getOrders();

  if (side === 'buy') {
    const amount = Math.round(price * shares * 100) / 100;
    if (amount > account.cash) return { success: false, msg: '资金不足' };
    account.cash = Math.round((account.cash - amount) * 100) / 100;
    account.frozenCash = Math.round((account.frozenCash + amount) * 100) / 100;
  } else {
    const holding = holdings.find(h => h.code === code);
    if (!holding || holding.available < shares) return { success: false, msg: '可卖持仓不足' };
    holding.available -= shares;
    holding.frozen += shares;
  }

  const order = {
    id: 'ORD' + Date.now(),
    code, name: s.name, side, price,
    volume: shares, filledVolume: 0,
    status: '申报中', time: nowStr(), type: '限价'
  };
  orders.unshift(order);
  saveOrders(orders);
  saveHoldings(holdings);
  calcAccount(); // 更新 totalAsset

  // 模撮合（服务端延迟成交）
  setTimeout(() => matchOrder(order.id), 300 + Math.random() * 500);
  return { success: true, msg: `${side === 'buy' ? '买入' : '卖出'}委托已提交`, orderId: order.id };
}

// 撮合成交
function matchOrder(orderId) {
  const orders = getOrders();
  const order = orders.find(o => o.id === orderId);
  if (!order || order.status === '已成交' || order.status === '已撤单') return;

  const s = engine.getStock(order.code);
  if (!s) return;
  const canFill = order.side === 'buy' ? order.price >= s.price : order.price <= s.price;
  if (!canFill) {
    order.status = '已申报';
    saveOrders(orders);
    return;
  }

  const fillPrice = s.price;
  const fillAmount = Math.round(fillPrice * order.volume * 100) / 100;
  order.filledPrice = fillPrice;
  order.filledVolume = order.volume;
  order.status = '已成交';
  order.dealTime = nowStr();

  const account = getAccount();
  const holdings = getHoldings();
  const deals = getDeals();

  if (order.side === 'buy') {
    account.frozenCash = Math.round((account.frozenCash - order.price * order.volume) * 100) / 100;
    const diff = Math.round((order.price - fillPrice) * order.volume * 100) / 100;
    if (diff > 0) account.cash = Math.round((account.cash + diff) * 100) / 100;
    updateHolding(holdings, order.code, order.name, order.volume, fillPrice, 'buy');
  } else {
    const holding = holdings.find(h => h.code === order.code);
    if (holding) holding.frozen -= order.volume;
    updateHolding(holdings, order.code, order.name, order.volume, fillPrice, 'sell');
    account.cash = Math.round((account.cash + fillAmount) * 100) / 100;
  }

  deals.unshift({
    id: 'DEL' + Date.now(), orderId: order.id,
    code: order.code, name: order.name, side: order.side,
    price: fillPrice, volume: order.volume, amount: fillAmount, time: order.dealTime
  });
  if (deals.length > 200) deals.length = 200;

  saveOrders(orders);
  saveDeals(deals);
  saveHoldings(holdings);
  saveAccount(account);
  calcAccount();
}

function updateHolding(holdings, code, name, vol, price, side) {
  let h = holdings.find(x => x.code === code);
  if (side === 'buy') {
    if (h) {
      const totalCost = h.cost * (h.volume + h.frozen) + price * vol;
      h.volume += vol;
      h.cost = totalCost / (h.volume + h.frozen);
      h.available += vol;
    } else {
      holdings.push({ code, name, volume: vol, available: vol, frozen: 0, cost: price });
    }
  } else {
    if (h) {
      h.volume -= vol;
      if (h.volume <= 0 && h.frozen <= 0) {
        const idx = holdings.findIndex(x => x.code === code);
        if (idx >= 0) holdings.splice(idx, 1);
      }
    }
  }
}

// 撤单
function cancelOrder(orderId) {
  const orders = getOrders();
  const order = orders.find(o => o.id === orderId);
  if (!order || order.status === '已成交' || order.status === '已撤单') return { success: false, msg: '委托不可撤单' };

  const account = getAccount();
  const holdings = getHoldings();
  if (order.side === 'buy') {
    const remainVol = order.volume - order.filledVolume;
    account.frozenCash = Math.round((account.frozenCash - remainVol * order.price) * 100) / 100;
    account.cash = Math.round((account.cash + remainVol * order.price) * 100) / 100;
  } else {
    const holding = holdings.find(h => h.code === order.code);
    if (holding) {
      const remainVol = order.volume - order.filledVolume;
      holding.frozen -= remainVol;
      holding.available += remainVol;
    }
  }
  order.status = '已撤单';
  saveOrders(orders);
  saveAccount(account);
  saveHoldings(holdings);
  calcAccount();
  return { success: true, msg: '委托已撤单' };
}

// 自选股
function toggleWatch(code) {
  const list = getWatchlist();
  const idx = list.indexOf(code);
  if (idx >= 0) { list.splice(idx, 1); saveWatchlist(list); return { added: false }; }
  list.push(code); saveWatchlist(list);
  return { added: true };
}
function removeWatch(code) {
  let list = getWatchlist();
  list = list.filter(c => c !== code);
  saveWatchlist(list);
}

// 账户操作
function resetAccount() {
  const account = { cash: 1000000, initCash: 1000000, totalAsset: 1000000, marketValue: 0, frozenCash: 0, profit: 0, profitPct: 0 };
  saveAccount(account);
  saveHoldings([]); saveOrders([]); saveDeals([]);
  return { success: true };
}
function addCash(amount) {
  const account = getAccount();
  account.cash = Math.round((account.cash + amount) * 100) / 100;
  account.initCash = Math.round((account.initCash + amount) * 100) / 100;
  saveAccount(account);
  calcAccount();
  return { success: true };
}

// ============ 行情布局 ============
function getLayout() {
  return storage.readJSON('layout.json', null);
}
function saveLayout(layout) {
  storage.writeJSON('layout.json', layout);
}

// ============ 侧边栏导航顺序 ============
function getNavOrder() {
  return storage.readJSON('nav-order.json', null);
}
function saveNavOrder(order) {
  storage.writeJSON('nav-order.json', order);
}

// ============ 侧边栏导航隐藏 ============
function getNavHidden() {
  return storage.readJSON('nav-hidden.json', null);
}
function saveNavHidden(hidden) {
  storage.writeJSON('nav-hidden.json', hidden);
}

module.exports = {
  getAccount, getHoldings, getOrders, getDeals, getWatchlist,
  calcAccount, submitTrade, cancelOrder,
  toggleWatch, removeWatch, resetAccount, addCash,
  getLayout, saveLayout,
  getNavOrder, saveNavOrder,
  getNavHidden, saveNavHidden
};
