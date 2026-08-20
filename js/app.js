/**
 * 模拟炒股 - 主应用逻辑（异步版本）
 * 所有数据通过 DataEngine API 异步获取
 */
(function (global) {
  'use strict';

  const DE = global.DataEngine;
  const Charts = global.Charts;

  let currentView = 'market';
  let detailStockCode = null;
  let detailStockData = null; // 缓存当前详情股票数据
  let detailChartType = 'minute';
  let tradeType = 'buy';
  let tradeStockCode = null;
  let topbarTimer = null;
  let viewRefreshTimer = null;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n, d = 2) => Number(n).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtVol = (n) => n >= 1e8 ? (n / 1e8).toFixed(2) + '亿' : n >= 1e4 ? (n / 1e4).toFixed(2) + '万' : String(n);

  function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    $('#toastContainer').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2600);
  }

  // 通用确认弹窗：返回 Promise<boolean>
  function showConfirm(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const overlay = $('#confirmModalOverlay');
      const modal = $('#confirmModal');
      const okText = opts.okText || '确定';
      const cancelText = opts.cancelText || '取消';
      const danger = opts.danger ? ' btn-buy' : ' btn-primary';
      modal.innerHTML = `
        ${opts.ico ? `<div class="cm-ico">${opts.ico}</div>` : ''}
        <div class="cm-msg">${esc(message)}</div>
        <div class="cm-actions">
          <button class="btn${danger}" id="cmOk">${esc(okText)}</button>
          <button class="btn" id="cmCancel">${esc(cancelText)}</button>
        </div>`;
      overlay.classList.add('show');
      const close = (result) => {
        overlay.classList.remove('show');
        document.removeEventListener('keydown', onKey);
        overlay.onclick = null;
        resolve(result);
      };
      $('#cmOk').onclick = () => close(true);
      $('#cmCancel').onclick = () => close(false);
      const onKey = (e) => {
        if (e.key === 'Enter') close(true);
        else if (e.key === 'Escape') close(false);
      };
      document.addEventListener('keydown', onKey);
      overlay.onclick = (e) => { if (e.target === overlay) close(false); };
      setTimeout(() => $('#cmOk') && $('#cmOk').focus(), 50);
    });
  }

  // ============ 视图切换 ============
  function showView(view) {
    currentView = view;
    currentSectorName = null; // 离开板块详情时清除
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
    const content = $('#content');
    content.scrollTop = 0;
    content.innerHTML = '<div class="loading" style="padding:40px;text-align:center;color:var(--text-dim)">加载中...</div>';
    const renderers = {
      market: renderMarket, rankings: renderRankings, screener: renderScreener,
      sectors: renderSectors, watchlist: renderWatchlist, portfolio: renderPortfolio,
      orders: renderOrders, deals: renderDeals, account: renderAccount, news: renderNews
    };
    (renderers[view] || renderMarket)();
  }

  // ============ 行情布局配置 ============
  const MODULE_DEFS = [
    { id: 'watchlist', name: '我的自选', defaultW: 'large' },
    { id: 'holdings', name: '我的持仓', defaultW: 'large' },
    { id: 'orders', name: '当前委托', defaultW: 'large' },
    { id: 'indices', name: '市场指数', defaultW: 'large' },
    { id: 'gainers', name: '涨幅榜', defaultW: 'medium' },
    { id: 'losers', name: '跌幅榜', defaultW: 'medium' },
    { id: 'amount', name: '成交额榜', defaultW: 'medium' },
    { id: 'sectors', name: '热门板块', defaultW: 'medium' }
  ];
  const DEFAULT_LAYOUT = MODULE_DEFS.map(m => ({ id: m.id, visible: true, w: m.defaultW || 'medium', collapsed: false }));
  let marketLayout = null; // 异步加载
  function normalizeLayout(saved) {
    if (!saved || !Array.isArray(saved)) return DEFAULT_LAYOUT.map(x => ({ ...x, order: x.order ? [...x.order] : undefined }));
    // 迁移老配置：rankings → gainers/losers/amount/sectors
    const migrated = [];
    saved.forEach(item => {
      if (item.id === 'rankings') {
        ['gainers', 'losers', 'amount', 'sectors'].forEach(id => {
          if (!migrated.find(x => x.id === id)) migrated.push({ id, visible: !!item.visible, w: 'medium', collapsed: false });
        });
      } else {
        migrated.push({
          id: item.id,
          visible: !!item.visible,
          w: item.w || (MODULE_DEFS.find(m => m.id === item.id) || {}).defaultW || 'medium',
          order: Array.isArray(item.order) ? [...item.order] : undefined,
          collapsed: !!item.collapsed
        });
      }
    });
    // 保留迁移后顺序，补充新增的模块
    const result = [];
    migrated.forEach(item => {
      if (MODULE_DEFS.some(m => m.id === item.id) && !result.find(x => x.id === item.id)) {
        result.push({
          id: item.id,
          visible: !!item.visible,
          w: item.w || 'medium',
          order: Array.isArray(item.order) ? [...item.order] : undefined,
          collapsed: !!item.collapsed
        });
      }
    });
    MODULE_DEFS.forEach(m => {
      if (!result.find(x => x.id === m.id)) {
        const def = DEFAULT_LAYOUT.find(d => d.id === m.id) || {};
        result.push({ id: m.id, visible: true, w: m.defaultW || 'medium', order: def.order ? [...def.order] : undefined, collapsed: false });
      }
    });
    return result;
  }
  async function loadMarketLayout() {
    if (marketLayout) return marketLayout;
    try {
      const saved = await DE.getLayout();
      marketLayout = normalizeLayout(saved);
    } catch {
      marketLayout = DEFAULT_LAYOUT.map(x => ({ ...x, order: x.order ? [...x.order] : undefined }));
    }
    return marketLayout;
  }
  async function saveMarketLayout() {
    try { await DE.saveLayout(marketLayout); } catch {}
  }

  // 渲染单个行情模块的 HTML（不含外层 .market-module 包装）
  function renderMarketModule(item, ctx) {
    const id = item.id;
    const w = item.w || 'large';
    const X_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:17px;height:17px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    const hideBtn = `<span class="col-btn" onclick="event.stopPropagation();App.toggleModuleVisible('${id}',false)" title="隐藏模块">${X_SVG}</span>`;
    const sw = `<span class="mod-size" onclick="event.stopPropagation()"><button type="button" class="ms-btn ${w === 'large' ? 'active' : ''}" onclick="App.setModuleSize('${id}','large')">大</button><button type="button" class="ms-btn ${w === 'medium' ? 'active' : ''}" onclick="App.setModuleSize('${id}','medium')">中</button><button type="button" class="ms-btn ${w === 'small' ? 'active' : ''}" onclick="App.setModuleSize('${id}','small')">小</button></span>`;
    switch (id) {
      case 'watchlist': {
        const watchlist = ctx.watchlist;
        if (!watchlist.length) return '';
        return `<div class="panel-header"><span>我的自选</span>${sw}<span class="more" onclick="App.showView('watchlist')">管理自选 ></span>${hideBtn}</div>
          <div class="panel-body">
            <div class="watchlist-carousel" id="watchlistCarousel">
              <div class="wc-track" id="wcTrack">${watchlist.map(s => `<div class="wc-slide" data-code="${s.code}">${renderWatchCard(s)}</div>`).join('')}</div>
              <button class="wc-nav wc-prev" id="wcPrev">‹</button>
              <button class="wc-nav wc-next" id="wcNext">›</button>
              <div class="wc-dots" id="wcDots">${watchlist.map((_, i) => `<span class="wc-dot ${i === 0 ? 'active' : ''}" data-idx="${i}"></span>`).join('')}</div>
            </div>
          </div>`;
      }
      case 'holdings': {
        const holdings = ctx.holdings;
        if (!holdings.length) return '';
        return `<div class="panel-header"><span>我的持仓</span>${sw}<span class="more" onclick="App.showView('portfolio')">全部持仓 ></span>${hideBtn}</div>
          <div class="panel-body" style="padding:0">${holdingsTableMini(holdings, ctx.holdingsData.summary)}</div>`;
      }
      case 'orders': {
        const activeOrders = ctx.activeOrders;
        if (!activeOrders.length) return '';
        return `<div class="panel-header"><span>当前委托</span>${sw}<span class="more" onclick="App.showView('orders')">全部委托 ></span>${hideBtn}</div>
          <div class="panel-body" style="padding:0">${ordersTableMini(activeOrders)}</div>`;
      }
      case 'indices': {
        const indices = ctx.indices;
        const idxItem = marketLayout.find(x => x.id === 'indices') || {};
        const order = idxItem.order || [];
        const sorted = [...indices].sort((a, b) => {
          const ia = order.indexOf(a.code), ib = order.indexOf(b.code);
          return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
        });
        return `<div class="panel-header"><span>市场指数</span>${sw}${hideBtn}</div>
          <div class="panel-body"><div class="index-cards">${sorted.map(idx => `
          <div class="index-card" data-ic="${idx.code}" draggable="true" onclick="App.showView('sectors')">
            <div class="ic-name">${esc(idx.name)}</div>
            <div class="ic-val ${DE.cls(idx.pct)}" data-field="value">${fmt(idx.value)}</div>
            <div class="ic-pct ${DE.cls(idx.pct)}" data-field="pct">${idx.change >= 0 ? '+' : ''}${fmt(idx.change)} (${DE.fmtPct(idx.pct)})</div>
          </div>`).join('')}</div></div>`;
      }
      case 'gainers': {
        const gainers = ctx.gainers;
        return `<div class="panel-header"><span>涨幅榜</span>${sw}<span class="more" onclick="App.showView('rankings')">更多 ></span>${hideBtn}</div><div class="panel-body" style="padding:0">${stockTableMini(gainers)}</div>`;
      }
      case 'losers': {
        const losers = ctx.losers;
        return `<div class="panel-header"><span>跌幅榜</span>${sw}<span class="more" onclick="App.showView('rankings')">更多 ></span>${hideBtn}</div><div class="panel-body" style="padding:0">${stockTableMini(losers)}</div>`;
      }
      case 'amount': {
        const active = ctx.active;
        return `<div class="panel-header"><span>成交额榜</span>${sw}<span class="more" onclick="App.showView('rankings')">更多 ></span>${hideBtn}</div><div class="panel-body" style="padding:0">${stockTableMini(active)}</div>`;
      }
      case 'sectors': {
        const hotSectors = ctx.hotSectors;
        return `<div class="panel-header"><span>热门板块</span>${sw}<span class="more" onclick="App.showView('sectors')">更多 ></span>${hideBtn}</div><div class="panel-body"><div class="sector-grid">${hotSectors.map(sc => `
          <div class="sector-card" data-sector="${sc.name}" onclick="App.showSector('${sc.name}')">
            <div class="sc-name">${esc(sc.name)}</div>
            <div class="sc-pct ${DE.cls(sc.avgPct)}" data-field="avgPct">${DE.fmtPct(sc.avgPct)}</div>
            <div class="sc-info"><span>${sc.count}只</span></div>
          </div>`).join('')}</div></div>`;
      }
    }
    return '';
  }

  // ============ 行情首页 ============
  async function renderMarket() {
    try {
      await loadMarketLayout();
      const [gainers, losers, active, sectors, indices, watchlist, holdingsData, ordersData] = await Promise.all([
        DE.getStocks({ sort: 'pct-desc', limit: 8 }),
        DE.getStocks({ sort: 'pct-asc', limit: 8 }),
        DE.getStocks({ sort: 'amount-desc', limit: 8 }),
        DE.getSectors(),
        DE.getIndices(),
        DE.getWatchlist(),
        DE.getHoldings(),
        DE.getOrders()
      ]);
      const holdings = holdingsData.holdings || [];
      const activeOrders = (ordersData && ordersData.active) || [];
      const hotSectors = sectors.slice(0, 6);
      const ctx = { gainers, losers, active, hotSectors, indices, watchlist, holdings, holdingsData, activeOrders };
      // 按 layout 顺序渲染可见模块
      const modulesHtml = marketLayout.map(item => {
        if (!item.visible) return '';
        const inner = renderMarketModule(item, ctx);
        if (!inner) return ''; // 无数据则不显示
        return `<div class="market-module panel mod-w-${item.w || 'large'}" data-module="${item.id}">${inner}</div>`;
      }).join('');
      $('#content').innerHTML = `<div class="market-modules">${modulesHtml}</div>`;
      renderTopbarIndices(indices);
      // 保存自选股缓存供轮播和切换K线类型使用
      DE._watchlistCache = watchlist;
      // 存入JS对象供快速查找
      watchlist.forEach(s => watchStockData[s.code] = s);
      // 初始化轮播
      if (watchlist.length && marketLayout.find(m => m.id === 'watchlist' && m.visible)) {
        requestAnimationFrame(() => {
          initCarousel();
          watchlist.forEach(s => drawWatchChart(s));
        });
      }
      // 绑定拖拽
      bindModuleDrag();
      bindIndexCardDrag();
    } catch (e) { $('#content').innerHTML = errorHtml(e); }
  }

  // ============ 模块拖拽 ============
  let dragModuleId = null;
  function bindModuleDrag() {
    const modules = document.querySelectorAll('.market-module');
    modules.forEach(m => {
      // 只有标题栏可拖，整个模块作为拖拽影像
      const header = m.querySelector('.panel-header') || (m.dataset.module === 'indices' ? m.querySelector('.index-cards') : m);
      if (header !== m) {
        header.style.cursor = 'grab';
        header.addEventListener('mousedown', () => { m.setAttribute('draggable', 'true'); });
        header.addEventListener('mouseup', () => { m.removeAttribute('draggable'); });
        header.addEventListener('mouseleave', () => { m.removeAttribute('draggable'); });
        // 点击/输入不触发拖拽
        header.addEventListener('click', e => {
          if (e.target.closest('input, button, .more, a')) m.removeAttribute('draggable');
        });
      } else {
        m.style.cursor = 'grab';
      }
      m.addEventListener('dragstart', e => {
        // 指数卡片内部拖拽放行，交给 index-card 自己处理
        if (m.dataset.module === 'indices' && e.target.classList && e.target.classList.contains('index-card')) return;
        // 只允许从标题栏发起的拖拽
        const isFromHeader = e.target === m || m.contains(e.target) && (e.target === header || header.contains(e.target));
        if (!isFromHeader) { e.preventDefault(); return; }
        dragModuleId = m.dataset.module;
        m.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', dragModuleId); } catch (_) {}
      });
      m.addEventListener('dragend', () => {
        m.classList.remove('dragging');
        m.removeAttribute('draggable');
        document.querySelectorAll('.market-module').forEach(x => x.classList.remove('drag-over'));
      });
      m.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (m.dataset.module !== dragModuleId) m.classList.add('drag-over');
      });
      m.addEventListener('dragleave', () => m.classList.remove('drag-over'));
      m.addEventListener('drop', e => {
        e.preventDefault();
        m.classList.remove('drag-over');
        const targetId = m.dataset.module;
        if (!dragModuleId || dragModuleId === targetId) return;
        const fromIdx = marketLayout.findIndex(x => x.id === dragModuleId);
        const toIdx = marketLayout.findIndex(x => x.id === targetId);
        if (fromIdx < 0 || toIdx < 0) return;
        const [moved] = marketLayout.splice(fromIdx, 1);
        marketLayout.splice(toIdx, 0, moved);
        saveMarketLayout();
        renderMarket();
      });
    });
  }
  // 指数卡片内部拖拽排序
  let dragIcCode = null;
  function bindIndexCardDrag() {
    const cards = document.querySelectorAll('.market-module[data-module="indices"] .index-card');
    cards.forEach(card => {
      card.addEventListener('dragstart', e => {
        dragIcCode = card.dataset.ic;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', dragIcCode); } catch (_) {}
        e.stopPropagation();
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        cards.forEach(x => x.classList.remove('drag-over'));
        dragIcCode = null;
      });
      card.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (card.dataset.ic !== dragIcCode) card.classList.add('drag-over');
      });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', e => {
        e.preventDefault();
        card.classList.remove('drag-over');
        const targetCode = card.dataset.ic;
        if (!dragIcCode || dragIcCode === targetCode) return;
        const idxItem = marketLayout.find(x => x.id === 'indices');
        if (!idxItem) return;
        const order = idxItem.order || [];
        const fromIdx = order.indexOf(dragIcCode);
        const toIdx = order.indexOf(targetCode);
        if (fromIdx < 0 && toIdx < 0) {
          // order 为空，用当前 DOM 顺序初始化
          const curCodes = Array.from(cards).map(c => c.dataset.ic);
          const fi = curCodes.indexOf(dragIcCode), ti = curCodes.indexOf(targetCode);
          if (fi < 0 || ti < 0) return;
          const [mv] = curCodes.splice(fi, 1);
          curCodes.splice(ti, 0, mv);
          idxItem.order = curCodes;
        } else {
          if (fromIdx < 0 || toIdx < 0) return;
          const [mv] = order.splice(fromIdx, 1);
          order.splice(toIdx, 0, mv);
        }
        saveMarketLayout();
        renderMarket();
      });
    });
  }

  // ============ 布局设置面板 ============
  let lsDragId = null;
  async function openLayoutSettings() {
    await loadMarketLayout();
    renderLayoutList();
    $('#layoutSettingsOverlay').classList.add('show');
  }
  function closeLayoutSettings() {
    $('#layoutSettingsOverlay').classList.remove('show');
  }
  function renderLayoutList() {
    const list = $('#lsList');
    list.innerHTML = marketLayout.map(item => {
      const def = MODULE_DEFS.find(m => m.id === item.id);
      const w = item.w || 'large';
      const wOpts = [['large', '大'], ['medium', '中'], ['small', '小']];
      const wHtml = wOpts.map(([v, lbl]) => `<button type="button" class="ls-size-btn ${w === v ? 'active' : ''}" onclick="App.setModuleSize('${item.id}','${v}')">${lbl}</button>`).join('');
      return `<div class="ls-item" data-id="${item.id}" draggable="true">
        <span class="ls-handle">⣿</span>
        <label class="ls-label"><input type="checkbox" ${item.visible ? 'checked' : ''} onchange="App.toggleModuleVisible('${item.id}', this.checked)"><span>${def ? def.name : item.id}</span></label>
        <div class="ls-size" onclick="event.stopPropagation()"><span class="ls-size-label">宽</span><div class="ls-size-grp">${wHtml}</div></div>
      </div>`;
    }).join('');
    // 绑定拖拽
    list.querySelectorAll('.ls-item').forEach(item => {
      item.addEventListener('dragstart', e => {
        lsDragId = item.dataset.id;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', lsDragId); } catch (_) {}
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        list.querySelectorAll('.ls-item').forEach(x => x.classList.remove('drag-over'));
      });
      item.addEventListener('dragover', e => {
        e.preventDefault();
        if (item.dataset.id !== lsDragId) item.classList.add('drag-over');
      });
      item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
      item.addEventListener('drop', e => {
        e.preventDefault();
        item.classList.remove('drag-over');
        const targetId = item.dataset.id;
        if (!lsDragId || lsDragId === targetId) return;
        const fromIdx = marketLayout.findIndex(x => x.id === lsDragId);
        const toIdx = marketLayout.findIndex(x => x.id === targetId);
        if (fromIdx < 0 || toIdx < 0) return;
        const [moved] = marketLayout.splice(fromIdx, 1);
        marketLayout.splice(toIdx, 0, moved);
        saveMarketLayout();
        renderLayoutList();
      });
    });
  }
  function setModuleSize(id, w) {
    const item = marketLayout.find(x => x.id === id);
    if (!item) return;
    item.w = w;
    saveMarketLayout();
    renderLayoutList();
    // 当前在行情页时立即重渲染
    if (currentView === 'market') renderMarket();
  }
  function toggleModuleVisible(id, visible) {
    const item = marketLayout.find(x => x.id === id);
    if (!item || item.visible === visible) return;
    item.visible = visible;
    saveMarketLayout();
    renderLayoutList();
    // 当前在行情页，局部 DOM 移除/插入，不用整页重渲
    if (currentView !== 'market') return;
    const modEl = document.querySelector(`.market-module[data-module="${id}"]`);
    if (!visible && modEl) {
      modEl.style.transition = 'opacity .15s, transform .15s';
      modEl.style.opacity = '0';
      modEl.style.transform = 'scale(.98)';
      setTimeout(() => { modEl.remove(); }, 140);
    } else if (visible) {
      renderMarket(); // 插入需要重渲染按序占位
    }
  }
  function toggleModuleCollapse(id) {
    const item = marketLayout.find(x => x.id === id);
    if (!item) return;
    item.collapsed = !item.collapsed;
    saveMarketLayout();
    if (currentView !== 'market') return;
    const modEl = document.querySelector(`.market-module[data-module="${id}"]`);
    if (!modEl) return;
    modEl.classList.toggle('is-collapsed', item.collapsed);
    const colBtn = modEl.querySelector('.col-toggle');
    if (colBtn) {
      colBtn.textContent = item.collapsed ? '›' : '‹';
      colBtn.title = item.collapsed ? '展开' : '折叠';
    }
  }
  function applyLayout() {
    closeLayoutSettings();
    if (currentView === 'market') renderMarket();
  }
  function resetLayout() {
    marketLayout = DEFAULT_LAYOUT.map(x => ({ ...x, order: x.order ? [...x.order] : undefined, collapsed: false }));
    saveMarketLayout();
    renderLayoutList();
  }

  // ============ 自选股轮播 ============
  let carouselIdx = 0, carouselTimer = null;
  function initCarousel() {
    const track = $('#wcTrack');
    if (!track) return;
    const slides = track.querySelectorAll('.wc-slide');
    if (!slides.length) return;
    // 重置
    carouselIdx = 0;
    track.style.transition = 'none';
    track.style.transform = 'translateX(0)';
    // 绑定按钮
    const prev = $('#wcPrev'), next = $('#wcNext');
    if (prev) prev.onclick = () => { goCarousel(carouselIdx - 1); restartCarousel(); };
    if (next) next.onclick = () => { goCarousel(carouselIdx + 1); restartCarousel(); };
    // 绑定圆点
    $$('#wcDots .wc-dot').forEach(d => {
      d.onclick = () => { goCarousel(parseInt(d.dataset.idx)); restartCarousel(); };
    });
    // 绑定鼠标悬停暂停
    const carousel = $('#watchlistCarousel');
    if (carousel) {
      carousel.onmouseenter = () => stopCarousel();
      carousel.onmouseleave = () => startCarousel();
    }
    // 启动自动轮播
    startCarousel();
  }
  function goCarousel(idx) {
    const track = $('#wcTrack');
    if (!track) return;
    const slides = track.querySelectorAll('.wc-slide');
    const total = slides.length;
    if (!total) return;
    carouselIdx = ((idx % total) + total) % total;
    track.style.transition = 'transform .4s cubic-bezier(.4,0,.2,1)';
    track.style.transform = `translateX(-${carouselIdx * 100}%)`;
    // 更新圆点
    $$('#wcDots .wc-dot').forEach((d, i) => d.classList.toggle('active', i === carouselIdx));
    // 重绘当前K线
    const activeSlide = slides[carouselIdx];
    if (activeSlide) {
      const code = activeSlide.dataset.code;
      const stock = DE._watchlistCache && DE._watchlistCache.find(s => s.code === code);
      if (stock) drawWatchChart(stock);
    }
  }
  function startCarousel() {
    stopCarousel();
    carouselTimer = setInterval(() => goCarousel(carouselIdx + 1), 5000);
  }
  function stopCarousel() {
    if (carouselTimer) { clearInterval(carouselTimer); carouselTimer = null; }
  }
  function restartCarousel() { stopCarousel(); startCarousel(); }

  // 渲染单个自选股完整信息卡片（照搬详情页布局）
  function renderWatchCard(s) {
    const m = s.metrics;
    const cls = DE.cls(m.pct);
    const market = s.market === 'SH' ? '上海' : '深圳';
    // 将股票数据存在slide元素上，方便切换时直接读取
    return `<div class="wc-top">
      <div class="wc-info">
        <div class="wc-name"><span style="cursor:pointer;color:var(--text)" onclick="App.openDetail('${s.code}')">${esc(s.name)}</span> <span class="wc-code">${s.code}</span></div>
        <div class="wc-sub">${market} · ${esc(s.sector)}</div>
        <div class="wc-price ${cls}" data-field="price">${fmt(s.price)}</div>
        <div class="wc-change ${cls}" data-field="change">${m.change >= 0 ? '+' : ''}${fmt(m.change)} (${DE.fmtPct(m.pct)})</div>
        <div class="wc-metrics-inline">
          <div class="wmi"><span>今开</span><span class="${DE.cls(s.open - s.preClose)}" data-field="open">${fmt(s.open)}</span></div>
          <div class="wmi"><span>昨收</span><span data-field="preClose">${fmt(s.preClose)}</span></div>
          <div class="wmi"><span>最高</span><span class="up" data-field="high">${fmt(s.high)}</span></div>
          <div class="wmi"><span>最低</span><span class="down" data-field="low">${fmt(s.low)}</span></div>
          <div class="wmi"><span>成交量</span><span data-field="volume">${fmtVol(m.volume)}</span></div>
          <div class="wmi"><span>成交额</span><span data-field="amount">${fmt(m.amount)}亿</span></div>
          <div class="wmi"><span>换手率</span><span data-field="turnover">${fmt(m.turnover)}%</span></div>
          <div class="wmi"><span>振幅</span><span data-field="amplitude">${fmt(m.amplitude)}%</span></div>
          <div class="wmi"><span>市盈率</span><span data-field="pe">${fmt(m.pe)}</span></div>
          <div class="wmi"><span>市净率</span><span data-field="pb">${fmt(m.pb)}</span></div>
          <div class="wmi"><span>总市值</span><span data-field="marketCap">${fmt(m.marketCap)}亿</span></div>
          <div class="wmi"><span>涨停</span><span class="up" data-field="upLimit">${fmt(m.upLimit)}</span></div>
        </div>
        <div class="wc-actions">
          <button class="btn btn-sm btn-buy" onclick="App.openTrade('buy','${s.code}')">买入</button>
          <button class="btn btn-sm btn-sell" onclick="App.openTrade('sell','${s.code}')">卖出</button>
          <button class="btn btn-sm" onclick="App.removeWatch('${s.code}')">移除</button>
        </div>
      </div>
      <div class="wc-chart-area">
        <div class="wc-chart-tabs">
          <span class="wct active" data-type="minute" onclick="App.setWatchChartType('${s.code}','minute')">分时</span>
          <span class="wct" data-type="day" onclick="App.setWatchChartType('${s.code}','day')">日K</span>
          <span class="wct" data-type="week" onclick="App.setWatchChartType('${s.code}','week')">周K</span>
          <span class="wct" data-type="month" onclick="App.setWatchChartType('${s.code}','month')">月K</span>
        </div>
        <div class="wc-chart-wrap"><canvas class="watch-chart" data-chart="${s.code}"></canvas></div>
      </div>
    </div>`;
  }

  // 自选股图表类型状态 & 股票数据缓存
  const watchChartTypes = {};
  const watchStockData = {};

  function setWatchChartType(code, type) {
    watchChartTypes[code] = type;
    const slide = document.querySelector(`.wc-slide[data-code="${code}"]`);
    if (slide) {
      slide.querySelectorAll('.wct').forEach(t => t.classList.toggle('active', t.dataset.type === type));
    }
    const stock = watchStockData[code];
    if (stock) {
      requestAnimationFrame(() => drawWatchChart(stock));
    } else {
      console.warn('No stock data for', code);
    }
  }

  // 绘制自选股图表（分时/日K/周K/月K）
  function drawWatchChart(s) {
    const canvas = document.querySelector(`canvas[data-chart="${s.code}"]`);
    if (!canvas) return;
    const type = watchChartTypes[s.code] || 'minute';
    let drawFn;
    if (type === 'minute') {
      if (!s.minuteData || !s.minuteData.length) return;
      drawFn = (x) => Charts.drawMinuteChart(canvas, s.minuteData, s.preClose, x);
    } else {
      const klines = aggregateKlinesForWatch(s.klines, type);
      if (!klines.length) return;
      drawFn = (x) => Charts.drawKlineChart(canvas, klines, { ma: [5, 10] }, x);
    }
    drawFn(null);
    Charts.bindHover(canvas, drawFn);
  }

  // 聚合K线：日K直接返回，周K合并5根，月K合并22根（复用详情页的aggregateKlines）
  function aggregateKlinesForWatch(klines, type) {
    if (!klines || !klines.length) return [];
    if (type === 'day') return klines;
    const period = type === 'week' ? 5 : 22;
    return aggregateKlines(klines, period);
  }

  // 紧凑版K线绘制
  function stockTableMini(stocks) {
    if (!stocks.length) return '<div class="empty-state"><div class="es-ico">📭</div>暂无数据</div>';
    return `<table class="tbl"><thead><tr><th>名称</th><th>最新价</th><th>涨跌幅</th></tr></thead>
      <tbody>${stocks.map(s => { const m = s.metrics; return `<tr data-code="${s.code}" onclick="App.openDetail('${s.code}')">
        <td><div class="stock-name"><span class="sn-name">${esc(s.name)}</span><span class="sn-code">${s.code}</span></div></td>
        <td class="${DE.cls(m.pct)}" data-field="price">${fmt(s.price)}</td>
        <td class="${DE.cls(m.pct)}" data-field="pct">${DE.fmtPct(m.pct)}</td></tr>`;
      }).join('')}</tbody></table>`;
  }

  // 行情首页持仓 mini（汇总卡片 + 紧凑表）
  function holdingsTableMini(holdings, summary) {
    const totalMV = (summary && summary.marketValue) || holdings.reduce((s, h) => s + (h.marketValue || 0), 0);
    const totalProfit = (summary && summary.totalProfit) || holdings.reduce((s, h) => s + (h.profit || 0), 0);
    const profitPct = totalMV - totalProfit ? (totalProfit / (totalMV - totalProfit) * 100) : 0;
    return `<div class="holdings-mini-cards">
        <div class="hmc-card"><div class="hmc-label">持仓市值</div><div class="hmc-val">${fmt(totalMV)}</div></div>
        <div class="hmc-card"><div class="hmc-label">浮动盈亏</div><div class="hmc-val ${DE.cls(totalProfit)}">${totalProfit >= 0 ? '+' : ''}${fmt(totalProfit)}</div></div>
        <div class="hmc-card"><div class="hmc-label">盈亏比</div><div class="hmc-val ${DE.cls(profitPct)}">${DE.fmtPct(profitPct)}</div></div>
        <div class="hmc-card"><div class="hmc-label">可用资金</div><div class="hmc-val">${fmt(summary && summary.cash || 0)}</div></div>
        <div class="hmc-card"><div class="hmc-label">持仓数</div><div class="hmc-val">${holdings.length}</div></div>
      </div>
      <table class="tbl"><thead><tr><th>名称代码</th><th>持仓</th><th>可用</th><th>成本</th><th>现价</th><th>盈亏</th><th>盈亏比</th><th>操作</th></tr></thead>
      <tbody>${holdings.map(h => `<tr data-code="${h.code}">
        <td onclick="App.openDetail('${h.code}')"><div class="stock-name"><span class="sn-name">${esc(h.name)}</span><span class="sn-code">${h.code}</span></div></td>
        <td>${h.volume + h.frozen}</td>
        <td>${h.available}</td>
        <td>${fmt(h.cost)}</td>
        <td class="${DE.cls(h.profitPct)}" data-field="price">${fmt(h.price)}</td>
        <td class="${DE.cls(h.profit)}" data-field="profit">${h.profit >= 0 ? '+' : ''}${fmt(h.profit)}</td>
        <td class="${DE.cls(h.profitPct)}" data-field="profitPct">${DE.fmtPct(h.profitPct)}</td>
        <td style="text-align:left"><button class="btn btn-sm btn-sell" onclick="event.stopPropagation();App.openTrade('sell','${h.code}')">卖出</button></td>
      </tr>`).join('')}</tbody></table>`;
  }

  function errorHtml(e) {
    return `<div class="empty-state"><div class="es-ico">⚠️</div>加载失败<br><span style="font-size:12px">${esc(e.message)}</span></div>`;
  }

  // 行情首页当前委托 mini 表格
  function ordersTableMini(orders) {
    return `<table class="tbl"><thead><tr><th>时间</th><th>名称代码</th><th>方向</th><th>委托价</th><th>委托量</th><th>已成交</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${orders.map(o => `<tr data-order-id="${o.id}">
        <td>${o.time}</td>
        <td onclick="App.openDetail('${o.code}')"><div class="stock-name"><span class="sn-name">${esc(o.name)}</span><span class="sn-code">${o.code}</span></div></td>
        <td><span class="${o.side === 'buy' ? 'up' : 'down'}">${o.side === 'buy' ? '买入' : '卖出'}</span></td>
        <td>${fmt(o.price)}</td>
        <td>${o.volume}</td>
        <td>${o.filledVolume}</td>
        <td>${o.status}</td>
        <td><button class="btn btn-sm" onclick="App.cancelOrder('${o.id}')">撤单</button></td>
      </tr>`).join('')}</tbody></table>`;
  }

  // ============ 排行榜 ============
  async function renderRankings() {
    try {
      const all = await DE.getStocks({ sort: 'pct-desc', limit: 200 });
      const tabs = [
        { id: 'gainers', name: '涨幅榜', data: [...all].sort((a, b) => b.metrics.pct - a.metrics.pct) },
        { id: 'losers', name: '跌幅榜', data: [...all].sort((a, b) => a.metrics.pct - b.metrics.pct) },
        { id: 'amount', name: '成交额', data: [...all].sort((a, b) => b.metrics.amount - a.metrics.amount) },
        { id: 'turnover', name: '换手率', data: [...all].sort((a, b) => b.metrics.turnover - a.metrics.turnover) },
        { id: 'amplitude', name: '振幅', data: [...all].sort((a, b) => b.metrics.amplitude - a.metrics.amplitude) }
      ];
      $('#content').innerHTML = `
        <div class="panel"><div class="panel-header">沪深A股排行</div><div class="panel-body">
          <div class="tabs" id="rankTabs">${tabs.map((t, i) => `<div class="tab ${i === 0 ? 'active' : ''}" data-rank="${t.id}">${t.name}</div>`).join('')}</div>
          <div id="rankTable">${renderRankTable(tabs[0].data)}</div>
        </div></div>`;
      $$('#rankTabs .tab').forEach(tab => {
        tab.onclick = () => {
          $$('#rankTabs .tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const t = tabs.find(x => x.id === tab.dataset.rank);
          $('#rankTable').innerHTML = renderRankTable(t.data);
        };
      });
    } catch (e) { $('#content').innerHTML = errorHtml(e); }
  }

  function renderRankTable(ranked) {
    return `<table class="tbl"><thead><tr><th>序号</th><th>名称代码</th><th>最新价</th><th>涨跌额</th><th>涨跌幅</th><th>成交量</th><th>成交额</th><th>换手率</th><th>振幅</th></tr></thead>
      <tbody>${ranked.map((s, i) => { const m = s.metrics; return `<tr onclick="App.openDetail('${s.code}')">
        <td>${i + 1}</td>
        <td><div class="stock-name"><span class="sn-name">${esc(s.name)}</span><span class="sn-code">${s.code}</span></div></td>
        <td class="${DE.cls(m.pct)}">${fmt(s.price)}</td>
        <td class="${DE.cls(m.pct)}">${m.change >= 0 ? '+' : ''}${fmt(m.change)}</td>
        <td class="${DE.cls(m.pct)}">${DE.fmtPct(m.pct)}</td>
        <td>${fmtVol(m.volume)}</td><td>${fmt(m.amount)}亿</td>
        <td>${fmt(m.turnover)}%</td><td>${fmt(m.amplitude)}%</td></tr>`;
      }).join('')}</tbody></table>`;
  }

  // ============ 选股器 ============
  function renderScreener() {
    const sectors = ['银行', '证券', '保险', '房地产开发', '白酒概念', '中药', '医疗器械', '新能源', '光伏', '半导体', '消费电子', '人工智能', '汽车整车', '钢铁', '煤炭', '电力', '军工', '家电', '食品加工', '传媒'];
    $('#content').innerHTML = `
      <div class="panel"><div class="panel-header">智能选股</div><div class="panel-body">
        <div class="screener-filters">
          <div class="filter-group"><label>板块</label><select id="fSector"><option value="">全部板块</option>${sectors.map(s => `<option value="${s}">${s}</option>`).join('')}</select></div>
          <div class="filter-group"><label>市场</label><select id="fMarket"><option value="">全部市场</option><option value="SH">沪市</option><option value="SZ">深市</option></select></div>
          <div class="filter-group"><label>股价区间</label><div class="range-inputs"><input type="number" id="fPriceMin" placeholder="最低" step="0.01"><span>-</span><input type="number" id="fPriceMax" placeholder="最高" step="0.01"></div></div>
          <div class="filter-group"><label>涨跌幅区间(%)</label><div class="range-inputs"><input type="number" id="fPctMin" placeholder="最低" step="0.1"><span>-</span><input type="number" id="fPctMax" placeholder="最高" step="0.1"></div></div>
          <div class="filter-group"><label>市盈率区间</label><div class="range-inputs"><input type="number" id="fPeMin" placeholder="最低" step="0.1"><span>-</span><input type="number" id="fPeMax" placeholder="最高" step="0.1"></div></div>
          <div class="filter-group"><label>市净率区间</label><div class="range-inputs"><input type="number" id="fPbMin" placeholder="最低" step="0.1"><span>-</span><input type="number" id="fPbMax" placeholder="最高" step="0.1"></div></div>
          <div class="filter-group"><label>总市值(亿)</label><div class="range-inputs"><input type="number" id="fCapMin" placeholder="最低"><span>-</span><input type="number" id="fCapMax" placeholder="最高"></div></div>
          <div class="filter-group"><label>换手率(%)</label><div class="range-inputs"><input type="number" id="fTurnMin" placeholder="最低" step="0.1"><span>-</span><input type="number" id="fTurnMax" placeholder="最高" step="0.1"></div></div>
          <div class="filter-group"><label>排序</label><select id="fSort">
            <option value="pct-desc">涨跌幅降序</option><option value="pct-asc">涨跌幅升序</option>
            <option value="amount-desc">成交额降序</option><option value="turnover-desc">换手率降序</option>
            <option value="pe-asc">市盈率升序</option><option value="marketCap-desc">市值降序</option>
          </select></div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:14px">
          <button class="btn btn-primary" onclick="App.runScreener()">开始筛选</button>
          <button class="btn" onclick="App.resetScreener()">重置</button>
          <span id="screenerCount" style="align-self:center;color:var(--text-dim);font-size:12px"></span>
        </div>
        <div id="screenerResult"></div>
      </div></div>`;
  }

  async function runScreener() {
    const f = (id) => { const v = $('#' + id).value; return v === '' ? null : parseFloat(v); };
    const sector = $('#fSector').value, market = $('#fMarket').value;
    const pMin = f('fPriceMin'), pMax = f('fPriceMax');
    const pctMin = f('fPctMin'), pctMax = f('fPctMax');
    const peMin = f('fPeMin'), peMax = f('fPeMax');
    const pbMin = f('fPbMin'), pbMax = f('fPbMax');
    const capMin = f('fCapMin'), capMax = f('fCapMax');
    const turnMin = f('fTurnMin'), turnMax = f('fTurnMax');
    const sort = $('#fSort').value;

    $('#screenerCount').textContent = '筛选中...';
    try {
      let result = await DE.getStocks({ sort, limit: 200 });
      if (sector) result = result.filter(s => s.sector === sector);
      if (market) result = result.filter(s => s.market === market);
      if (pMin != null) result = result.filter(s => s.price >= pMin);
      if (pMax != null) result = result.filter(s => s.price <= pMax);
      if (pctMin != null) result = result.filter(s => s.metrics.pct >= pctMin);
      if (pctMax != null) result = result.filter(s => s.metrics.pct <= pctMax);
      if (peMin != null) result = result.filter(s => s.metrics.pe >= peMin);
      if (peMax != null) result = result.filter(s => s.metrics.pe <= peMax);
      if (pbMin != null) result = result.filter(s => s.metrics.pb >= pbMin);
      if (pbMax != null) result = result.filter(s => s.metrics.pb <= pbMax);
      if (capMin != null) result = result.filter(s => s.metrics.marketCap >= capMin);
      if (capMax != null) result = result.filter(s => s.metrics.marketCap <= capMax);
      if (turnMin != null) result = result.filter(s => s.metrics.turnover >= turnMin);
      if (turnMax != null) result = result.filter(s => s.metrics.turnover <= turnMax);

      $('#screenerCount').textContent = `共筛选出 ${result.length} 只股票`;
      $('#screenerResult').innerHTML = result.length ? `<table class="tbl">
        <thead><tr><th>名称代码</th><th>板块</th><th>最新价</th><th>涨跌幅</th><th>成交额</th><th>换手率</th><th>市盈率</th><th>市净率</th><th>总市值</th><th>操作</th></tr></thead>
        <tbody>${result.map(s => { const m = s.metrics; return `<tr>
          <td onclick="App.openDetail('${s.code}')"><div class="stock-name"><span class="sn-name">${esc(s.name)}</span><span class="sn-code">${s.code}</span></div></td>
          <td>${esc(s.sector)}</td><td class="${DE.cls(m.pct)}">${fmt(s.price)}</td>
          <td class="${DE.cls(m.pct)}">${DE.fmtPct(m.pct)}</td><td>${fmt(m.amount)}亿</td>
          <td>${fmt(m.turnover)}%</td><td>${fmt(m.pe)}</td><td>${fmt(m.pb)}</td>
          <td>${fmt(m.marketCap)}亿</td>
          <td><button class="btn btn-sm btn-primary" onclick="event.stopPropagation();App.openTrade('buy','${s.code}')">买入</button></td></tr>`;
        }).join('')}</tbody></table>` : '<div class="empty-state"><div class="es-ico">🔍</div>没有符合条件的股票，请调整筛选条件</div>';
    } catch (e) { $('#screenerResult').innerHTML = errorHtml(e); }
  }

  function resetScreener() {
    $$('#content select, #content input').forEach(el => { el.value = ''; });
    $('#fSort').value = 'pct-desc';
    $('#screenerCount').textContent = '';
    $('#screenerResult').innerHTML = '';
  }

  // ============ 板块 ============
  async function renderSectors() {
    try {
      const sectors = await DE.getSectors();
      $('#content').innerHTML = `
        <div class="section-title">板块行情</div>
        <div class="sector-grid">${sectors.map(sc => `
          <div class="sector-card" data-sector="${sc.name}" onclick="App.showSector('${sc.name}')">
            <div class="sc-name">${esc(sc.name)}</div>
            <div class="sc-pct ${DE.cls(sc.avgPct)}" data-field="avgPct">${DE.fmtPct(sc.avgPct)}</div>
            <div class="sc-info"><span>${sc.count}只</span><span>涨${sc.gainers}跌${sc.count - sc.gainers}</span></div>
          </div>`).join('')}</div>`;
    } catch (e) { $('#content').innerHTML = errorHtml(e); }
  }

  let currentSectorName = null;
  async function showSector(name) {
    currentSectorName = name;
    try {
      const stocks = await DE.getStocks({ sector: name, sort: 'pct-desc' });
      $('#content').innerHTML = `
        <div class="section-title">${esc(name)}板块 <span class="more" onclick="App.showView('sectors')">返回板块列表</span></div>
        <div class="panel"><div class="panel-body" style="padding:0"><table class="tbl">
          <thead><tr><th>名称代码</th><th>最新价</th><th>涨跌幅</th><th>成交额</th><th>换手率</th><th>市盈率</th><th>操作</th></tr></thead>
          <tbody>${stocks.map(s => { const m = s.metrics; return `<tr data-code="${s.code}">
            <td onclick="App.openDetail('${s.code}')"><div class="stock-name"><span class="sn-name">${esc(s.name)}</span><span class="sn-code">${s.code}</span></div></td>
            <td class="${DE.cls(m.pct)}" data-field="price">${fmt(s.price)}</td><td class="${DE.cls(m.pct)}" data-field="pct">${DE.fmtPct(m.pct)}</td>
            <td data-field="amount">${fmt(m.amount)}亿</td><td data-field="turnover">${fmt(m.turnover)}%</td><td>${fmt(m.pe)}</td>
            <td><button class="btn btn-sm btn-primary" onclick="event.stopPropagation();App.openTrade('buy','${s.code}')">买入</button></td></tr>`;
          }).join('')}</tbody>
        </table></div></div>`;
    } catch (e) { $('#content').innerHTML = errorHtml(e); }
  }

  // 板块成分股局部更新
  async function refreshSectorLive() {
    if (!currentSectorName) return;
    const stocks = await DE.getStocks({ sector: currentSectorName, sort: 'pct-desc' });
    stocks.forEach(s => {
      const rows = document.querySelectorAll(`tr[data-code="${s.code}"]`);
      if (!rows.length) return;
      const m = s.metrics;
      const cls = DE.cls(m.pct);
      rows.forEach(row => {
        const priceCell = row.querySelector('[data-field="price"]');
        const pctCell = row.querySelector('[data-field="pct"]');
        const amountCell = row.querySelector('[data-field="amount"]');
        const turnoverCell = row.querySelector('[data-field="turnover"]');
        if (priceCell) { priceCell.textContent = fmt(s.price); priceCell.className = cls; }
        if (pctCell) { pctCell.textContent = DE.fmtPct(m.pct); pctCell.className = cls; }
        if (amountCell) amountCell.textContent = fmt(m.amount) + '亿';
        if (turnoverCell) turnoverCell.textContent = fmt(m.turnover) + '%';
      });
    });
  }

  // ============ 自选股 ============
  async function renderWatchlist() {
    try {
      const list = await DE.getWatchlist();
      $('#content').innerHTML = `
        <div class="panel"><div class="panel-header"><span>我的自选</span><span style="font-size:12px;color:var(--text-dim);font-weight:400">${list.length}只</span></div>
        <div class="panel-body" style="padding:0">
          ${list.length ? `<table class="tbl"><thead><tr><th>名称代码</th><th>最新价</th><th>涨跌幅</th><th>涨跌额</th><th>成交额</th><th>操作</th></tr></thead>
          <tbody>${list.map(s => { const m = s.metrics; return `<tr data-code="${s.code}">
            <td onclick="App.openDetail('${s.code}')"><div class="stock-name"><span class="sn-name">${esc(s.name)}</span><span class="sn-code">${s.code}</span></div></td>
            <td class="${DE.cls(m.pct)}" data-field="price">${fmt(s.price)}</td><td class="${DE.cls(m.pct)}" data-field="pct">${DE.fmtPct(m.pct)}</td>
            <td class="${DE.cls(m.pct)}" data-field="change">${m.change >= 0 ? '+' : ''}${fmt(m.change)}</td>
            <td data-field="amount">${fmt(m.amount)}亿</td>
            <td style="text-align:left">
              <button class="btn btn-sm btn-buy" onclick="event.stopPropagation();App.openTrade('buy','${s.code}')">买</button>
              <button class="btn btn-sm btn-sell" onclick="event.stopPropagation();App.openTrade('sell','${s.code}')">卖</button>
              <button class="btn btn-sm" onclick="event.stopPropagation();App.removeWatch('${s.code}')">移除</button>
            </td></tr>`;
          }).join('')}</tbody></table>` : '<div class="empty-state"><div class="es-ico">⭐</div>暂无自选股<br><span style="font-size:12px">在个股详情页点击"加入自选"添加</span></div>'}
        </div></div>`;
    } catch (e) { $('#content').innerHTML = errorHtml(e); }
  }

  async function toggleWatch(code) {
    try {
      const r = await DE.toggleWatch(code);
      toast(r.added ? '已加入自选' : '已移出自选', r.added ? 'success' : 'info');
      const watchlist = await DE.getWatchlist();
      renderDetailActions(watchlist.some(s => s.code === code));
    } catch (e) { toast(e.message, 'error'); }
  }

  async function removeWatch(code) {
    if (!await showConfirm('确定将该股票移出自选？')) return;
    try {
      await DE.removeWatch(code);
      toast('已移出自选', 'info');
      // 刷新当前视图（而非强制跳到自选页）
      if (currentView === 'market') await refreshMarketLive();
      else if (currentView === 'watchlist') renderWatchlist();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ============ 个股详情 ============
  async function openDetail(code) {
    detailStockCode = code;
    detailChartType = 'minute';
    $('#detailOverlay').classList.add('show');
    $('#detailContent').innerHTML = '<div style="padding:60px;text-align:center;color:var(--text-dim)">加载中...</div>';
    await renderDetail();
  }

  function closeDetail() {
    $('#detailOverlay').classList.remove('show');
    detailStockCode = null;
    detailStockData = null;
  }

  async function renderDetail() {
    try {
      const s = await DE.getStock(detailStockCode);
      if (!s) return;
      detailStockData = s;
      const m = s.metrics;
      const isWatched = false; // 详情页加载时单独查询
      $('#detailContent').innerHTML = `
        <button class="detail-close" onclick="App.closeDetail()">✕</button>
        <div class="detail-top">
          <div class="detail-info">
            <div class="di-name">${esc(s.name)} <span style="font-size:13px;color:var(--text-dim);font-weight:400">${s.code}</span></div>
            <div class="di-code">${s.market === 'SH' ? '上海证券交易所' : '深圳证券交易所'} · ${esc(s.sector)}</div>
            <div class="di-price ${DE.cls(m.pct)}">${fmt(s.price)}</div>
            <div class="di-change ${DE.cls(m.pct)}">${m.change >= 0 ? '+' : ''}${fmt(m.change)} (${DE.fmtPct(m.pct)})</div>
            <div class="di-metrics">
              <div class="m-item"><span class="m-label">今开</span><span class="${DE.cls(s.open - s.preClose)}" data-field="open">${fmt(s.open)}</span></div>
              <div class="m-item"><span class="m-label">昨收</span><span data-field="preClose">${fmt(s.preClose)}</span></div>
              <div class="m-item"><span class="m-label">最高</span><span class="up" data-field="high">${fmt(s.high)}</span></div>
              <div class="m-item"><span class="m-label">最低</span><span class="down" data-field="low">${fmt(s.low)}</span></div>
              <div class="m-item"><span class="m-label">成交量</span><span data-field="volume">${fmtVol(m.volume)}</span></div>
              <div class="m-item"><span class="m-label">成交额</span><span data-field="amount">${fmt(m.amount)}亿</span></div>
              <div class="m-item"><span class="m-label">换手率</span><span data-field="turnover">${fmt(m.turnover)}%</span></div>
              <div class="m-item"><span class="m-label">振幅</span><span data-field="amplitude">${fmt(m.amplitude)}%</span></div>
              <div class="m-item"><span class="m-label">市盈率</span><span data-field="pe">${fmt(m.pe)}</span></div>
              <div class="m-item"><span class="m-label">市净率</span><span data-field="pb">${fmt(m.pb)}</span></div>
              <div class="m-item"><span class="m-label">总市值</span><span data-field="marketCap">${fmt(m.marketCap)}亿</span></div>
              <div class="m-item"><span class="m-label">流通值</span><span data-field="floatMarketCap">${fmt(m.floatMarketCap)}亿</span></div>
              <div class="m-item"><span class="m-label">涨停</span><span class="up" data-field="upLimit">${fmt(m.upLimit)}</span></div>
              <div class="m-item"><span class="m-label">跌停</span><span class="down" data-field="downLimit">${fmt(m.downLimit)}</span></div>
            </div>
            <div class="detail-actions" id="detailActions">${renderDetailActionsHTML(isWatched)}</div>
          </div>
          <div class="chart-area">
            <div class="chart-tabs">
              <div class="chart-tab ${detailChartType === 'minute' ? 'active' : ''}" onclick="App.setChartType('minute')">分时</div>
              <div class="chart-tab ${detailChartType === 'day' ? 'active' : ''}" onclick="App.setChartType('day')">日K</div>
              <div class="chart-tab ${detailChartType === 'week' ? 'active' : ''}" onclick="App.setChartType('week')">周K</div>
              <div class="chart-tab ${detailChartType === 'month' ? 'active' : ''}" onclick="App.setChartType('month')">月K</div>
            </div>
            <div class="chart-canvas-wrap"><canvas class="chart-canvas" id="detailChart"></canvas></div>
          </div>
        </div>
        <div class="detail-bottom">
          <div class="orderbook"><div class="orderbook-title">五档买卖盘</div><div id="orderBookContent"></div></div>
          <div><div class="orderbook-title">成交明细</div><div class="deals-list" id="dealsContent"></div></div>
          <div class="company-info"><div class="orderbook-title">公司信息</div><div id="companyInfoContent"></div></div>
        </div>`;
      renderDetailChart();
      renderOrderBook();
      renderDealsList();
      renderCompanyInfo();
      // 查询自选状态
      const watchlist = await DE.getWatchlist();
      const isW = watchlist.some(s => s.code === detailStockCode);
      renderDetailActions(isW);
    } catch (e) { $('#detailContent').innerHTML = '<div class="empty-state"><div class="es-ico">⚠️</div>' + esc(e.message) + '</div>'; }
  }

  function renderDetailActionsHTML(isWatched) {
    if (!detailStockCode) return '';
    return `<button class="btn btn-buy" onclick="App.openTrade('buy','${detailStockCode}')">买入</button>
      <button class="btn btn-sell" onclick="App.openTrade('sell','${detailStockCode}')">卖出</button>
      <button class="btn ${isWatched ? 'btn-primary' : ''}" onclick="App.toggleWatch('${detailStockCode}')">${isWatched ? '✓ 已自选' : '☆ 加自选'}</button>`;
  }

  function renderDetailActions(isWatched) {
    const el = $('#detailActions');
    if (el) el.innerHTML = renderDetailActionsHTML(isWatched);
  }

  function setChartType(type) { detailChartType = type; renderDetailChart(); }

  function renderDetailChart() {
    const canvas = $('#detailChart');
    if (!canvas || !detailStockData) return;
    const s = detailStockData;
    let drawFn;
    if (detailChartType === 'minute') {
      drawFn = (x) => Charts.drawMinuteChart(canvas, s.minuteData, s.preClose, x);
    } else {
      let klines = s.klines;
      if (detailChartType === 'week') klines = aggregateKlines(s.klines, 5);
      if (detailChartType === 'month') klines = aggregateKlines(s.klines, 22);
      drawFn = (x) => Charts.drawKlineChart(canvas, klines, { ma: [5, 10, 20] }, x);
    }
    drawFn(null);
    Charts.bindHover(canvas, drawFn);
  }

  function aggregateKlines(daily, period) {
    const result = [];
    for (let i = 0; i < daily.length; i += period) {
      const chunk = daily.slice(i, i + period);
      if (!chunk.length) continue;
      const open = chunk[0].open, close = chunk[chunk.length - 1].close;
      const high = Math.max(...chunk.map(k => k.high)), low = Math.min(...chunk.map(k => k.low));
      const volume = chunk.reduce((s, k) => s + k.volume, 0), amount = chunk.reduce((s, k) => s + k.amount, 0);
      result.push({ date: chunk[chunk.length - 1].date, open, close, high, low, volume, amount, pct: Math.round((close - open) / open * 10000) / 100 });
    }
    return result;
  }

  async function renderOrderBook() {
    try {
      const book = await DE.getOrderBook(detailStockCode);
      const s = detailStockData;
      const maxVol = Math.max(...book.asks.map(b => b.volume), ...book.bids.map(b => b.volume), 1);
      const askRows = book.asks.slice().reverse().map((b, i) => `<div class="ob-row">
        <div class="ob-vol-bar" style="width:${(b.volume / maxVol) * 100}%;background:var(--up)"></div>
        <span class="ob-vol" style="color:var(--up)">卖${5 - i}</span>
        <span class="ob-vol" style="color:var(--up)">${fmt(b.price)}</span>
        <span class="ob-vol">${b.volume}</span></div>`).join('');
      const bidRows = book.bids.map((b, i) => `<div class="ob-row">
        <div class="ob-vol-bar" style="width:${(b.volume / maxVol) * 100}%;background:var(--down)"></div>
        <span class="ob-vol" style="color:var(--down)">买${i + 1}</span>
        <span class="ob-vol" style="color:var(--down)">${fmt(b.price)}</span>
        <span class="ob-vol">${b.volume}</span></div>`).join('');
      $('#orderBookContent').innerHTML = askRows + `<div class="ob-row" style="font-weight:600;background:var(--bg3);margin:2px 0"><span>最新</span><span class="${DE.cls(s.price - s.preClose)}">${fmt(s.price)}</span><span></span></div>` + bidRows;
    } catch (e) {}
  }

  async function renderDealsList() {
    try {
      const deals = await DE.getDeals(detailStockCode);
      const s = detailStockData;
      $('#dealsContent').innerHTML = deals.map(d => `<div class="deal-row">
        <span style="color:var(--text-dim)">${d.time}</span>
        <span class="${DE.cls(d.price - s.preClose)}">${fmt(d.price)}</span>
        <span>${d.volume}</span>
        <span class="${d.bs === '买' ? 'up' : 'down'}">${d.bs}</span></div>`).join('');
    } catch (e) {}
  }

  async function renderCompanyInfo() {
    try {
      const info = await DE.getCompany(detailStockCode);
      const s = detailStockData;
      const rows = [
        ['所属行业', info.industry], ['上市日期', info.listingDate], ['董事长', info.chairman],
        ['总经理', info.generalManager], ['注册资本', info.registeredCapital], ['总股本', s.totalShares + '亿股'],
        ['流通股本', s.floatShares + '亿股'], ['营业收入', info.revenue], ['净利润', info.netProfit],
        ['毛利率', info.grossMargin], ['净利率', info.netMargin], ['净资产收益率', info.roe]
      ];
      $('#companyInfoContent').innerHTML = rows.map(r => `<div class="ci-row"><span class="ci-label">${r[0]}</span><span>${r[1]}</span></div>`).join('') +
        `<div class="ci-row" style="display:block;border-bottom:none;margin-top:8px"><span class="ci-label">主营业务</span><p style="margin-top:6px;line-height:1.6">${esc(info.mainBusiness)}</p></div>`;
    } catch (e) {}
  }

  // ============ 交易弹窗 ============
  async function openTrade(type, code) {
    tradeType = type;
    tradeStockCode = code;
    try {
      const s = await DE.getStock(code);
      if (type === 'sell') {
        const { holdings } = await DE.getHoldings();
        const holding = holdings.find(h => h.code === code);
        if (!holding || holding.available <= 0) { toast('没有可卖出的持仓', 'error'); return; }
      }
      $('#tradeModalOverlay').classList.add('show');
      renderTradeModal(s);
    } catch (e) { toast(e.message, 'error'); }
  }

  function closeTrade() { $('#tradeModalOverlay').classList.remove('show'); }

  async function renderTradeModal(s) {
    const m = s.metrics;
    const { holdings, summary } = await DE.getHoldings();
    const holding = holdings.find(h => h.code === tradeStockCode);
    const available = holding ? holding.available : 0;
    const account = await DE.getAccount();
    const canBuyVol = Math.floor(account.cash / s.price / 100) * 100;

    $('#tradeModal').innerHTML = `
      <div class="tm-title"><span>${tradeType === 'buy' ? '买入' : '卖出'} ${esc(s.name)}</span><span style="font-size:12px;color:var(--text-dim)">${s.code} · ${esc(s.sector)}</span></div>
      <div class="trade-tabs">
        <div class="trade-tab buy ${tradeType === 'buy' ? 'active' : ''}" onclick="App.switchTrade('buy')">买入</div>
        <div class="trade-tab sell ${tradeType === 'sell' ? 'active' : ''}" onclick="App.switchTrade('sell')">卖出</div>
      </div>
      <div class="tm-field"><label>委托价格</label>
        <div class="tm-price">
          <button onclick="App.adjPrice(-0.01)" style="width:30px;height:34px;border:1px solid var(--border2);background:var(--bg3);color:var(--text);border-radius:4px;cursor:pointer">-</button>
          <input type="number" id="tradePrice" value="${fmt(s.price)}" step="0.01" style="flex:1;height:34px;background:var(--bg3);border:1px solid var(--border2);border-radius:4px;color:var(--text);padding:0 10px;font-size:14px;text-align:center">
          <button onclick="App.adjPrice(0.01)" style="width:30px;height:34px;border:1px solid var(--border2);background:var(--bg3);color:var(--text);border-radius:4px;cursor:pointer">+</button>
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:4px">涨停 ${fmt(m.upLimit)} / 跌停 ${fmt(m.downLimit)}</div>
      </div>
      <div class="tm-field"><label>委托数量（手，1手=100股）</label>
        <div class="tm-stepper">
          <button onclick="App.adjVol(-1)">-</button>
          <input type="number" id="tradeVol" value="1" min="1" step="1" style="flex:1;height:34px;background:var(--bg3);border:1px solid var(--border2);border-radius:4px;color:var(--text);padding:0 10px;font-size:14px;text-align:center">
          <button onclick="App.adjVol(1)">+</button>
        </div>
        <div class="tm-quick-vol">
          ${tradeType === 'buy'
            ? `<button onclick="App.setVol(${Math.max(Math.floor(canBuyVol / 800), 1)})">1/8</button><button onclick="App.setVol(${Math.max(Math.floor(canBuyVol / 400), 1)})">1/4</button><button onclick="App.setVol(${Math.max(Math.floor(canBuyVol / 200), 1)})">1/2</button><button onclick="App.setVol(${Math.max(Math.floor(canBuyVol / 100), 1)})">全部</button>`
            : `<button onclick="App.setVol(${Math.max(Math.floor(available / 400), 1)})">1/4</button><button onclick="App.setVol(${Math.max(Math.floor(available / 200), 1)})">1/2</button><button onclick="App.setVol(${Math.floor(available / 100)})">全部</button>`}
        </div>
      </div>
      <div class="tm-summary">
        <div class="tm-row"><span>最新价</span><span class="${DE.cls(m.pct)}">${fmt(s.price)}</span></div>
        <div class="tm-row"><span>可用资金</span><span>${fmt(account.cash)} 元</span></div>
        <div class="tm-row"><span>可用持仓</span><span>${available} 股</span></div>
        <div class="tm-row"><span>预计金额</span><span id="estAmount">${fmt(s.price * 100)} 元</span></div>
      </div>
      <div class="tm-actions">
        <button class="btn ${tradeType === 'buy' ? 'btn-buy' : 'btn-sell'}" onclick="App.submitTrade()">${tradeType === 'buy' ? '确认买入' : '确认卖出'}</button>
        <button class="btn" onclick="App.closeTrade()">取消</button>
      </div>`;
    $('#tradePrice').oninput = updateEstAmount;
    $('#tradeVol').oninput = updateEstAmount;
  }

  function switchTrade(type) { tradeType = type; openTrade(type, tradeStockCode); }
  function adjPrice(delta) { const i = $('#tradePrice'); i.value = (parseFloat(i.value || 0) + delta).toFixed(2); updateEstAmount(); }
  function adjVol(delta) { const i = $('#tradeVol'); let v = parseInt(i.value || 0) + delta; if (v < 1) v = 1; i.value = v; updateEstAmount(); }
  function setVol(v) { $('#tradeVol').value = Math.max(1, v); updateEstAmount(); }
  function updateEstAmount() {
    const price = parseFloat($('#tradePrice').value) || 0;
    const vol = parseInt($('#tradeVol').value) || 0;
    const el = $('#estAmount');
    if (el) el.textContent = fmt(price * vol * 100) + ' 元';
  }

  async function submitTrade() {
    const price = parseFloat($('#tradePrice').value);
    const vol = parseInt($('#tradeVol').value);
    if (!price || price <= 0) { toast('请输入有效价格', 'error'); return; }
    if (!vol || vol < 1) { toast('请输入有效数量', 'error'); return; }
    try {
      const r = await DE.submitTrade(tradeType, tradeStockCode, price, vol);
      closeTrade();
      toast(r.msg || '委托已提交', 'success');
      // 立即刷新一次（委托冻结资金）
      updateTopbarAccount(await DE.getAccount());
      // 延迟刷新（等待服务端撮合成交后更新持仓/账户）
      setTimeout(async () => {
        try {
          const account = await DE.getAccount();
          updateTopbarAccount(account);
          // 刷新当前相关视图
          if (currentView === 'portfolio' || currentView === 'orders' || currentView === 'deals' || currentView === 'account') {
            showView(currentView);
          } else if (currentView === 'market') {
            await refreshMarketLive();
          }
        } catch (e) {}
      }, 1200);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function cancelOrder(orderId) {
    if (!await showConfirm('确定撤销此委托？')) return;
    try {
      const r = await DE.cancelOrder(orderId);
      toast(r.msg || '已撤单', 'info');
      // 刷新当前视图（而非强制跳到委托页）
      if (currentView === 'market') await refreshMarketLive();
      else if (currentView === 'portfolio' || currentView === 'orders' || currentView === 'deals' || currentView === 'account') {
        showView(currentView);
      }
    } catch (e) { toast(e.message, 'error'); }
  }

  // ============ 持仓 ============
  async function renderPortfolio() {
    try {
      const { holdings, summary } = await DE.getHoldings();
      $('#content').innerHTML = `
        <div class="portfolio-summary">
          <div class="pos-summary-item"><div class="psi-label">持仓市值</div><div class="psi-val">${fmt(summary.marketValue)}</div></div>
          <div class="pos-summary-item"><div class="psi-label">持仓盈亏</div><div class="psi-val ${DE.cls(summary.totalProfit)}">${summary.totalProfit >= 0 ? '+' : ''}${fmt(summary.totalProfit)}</div></div>
          <div class="pos-summary-item"><div class="psi-label">可用资金</div><div class="psi-val">${fmt(summary.cash)}</div></div>
          <div class="pos-summary-item"><div class="psi-label">冻结资金</div><div class="psi-val">${fmt(summary.frozenCash)}</div></div>
          <div class="pos-summary-item"><div class="psi-label">持仓数量</div><div class="psi-val">${summary.count}</div></div>
        </div>
        <div class="panel"><div class="panel-header">持仓明细</div><div class="panel-body" style="padding:0">
          ${holdings.length ? `<table class="tbl"><thead><tr><th>名称代码</th><th>持仓量</th><th>可用</th><th>成本价</th><th>现价</th><th>市值</th><th>盈亏</th><th>盈亏比</th><th>操作</th></tr></thead>
          <tbody>${holdings.map(h => `<tr data-code="${h.code}">
            <td onclick="App.openDetail('${h.code}')"><div class="stock-name"><span class="sn-name">${esc(h.name)}</span><span class="sn-code">${h.code}</span></div></td>
            <td>${h.volume + h.frozen}</td><td>${h.available}</td><td>${fmt(h.cost)}</td>
            <td class="${DE.cls(h.profitPct)}" data-field="price">${fmt(h.price)}</td><td data-field="marketValue">${fmt(h.marketValue)}</td>
            <td class="${DE.cls(h.profit)}" data-field="profit">${h.profit >= 0 ? '+' : ''}${fmt(h.profit)}</td>
            <td class="${DE.cls(h.profitPct)}" data-field="profitPct">${DE.fmtPct(h.profitPct)}</td>
            <td style="text-align:left"><button class="btn btn-sm btn-sell" onclick="event.stopPropagation();App.openTrade('sell','${h.code}')">卖出</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty-state"><div class="es-ico">💼</div>暂无持仓<br><span style="font-size:12px">去行情页面买入股票开始交易吧</span></div>'}
        </div></div>`;
    } catch (e) { $('#content').innerHTML = errorHtml(e); }
  }

  // ============ 委托 ============
  async function renderOrders() {
    try {
      const { active, all } = await DE.getOrders();
      $('#content').innerHTML = `
        <div class="panel"><div class="panel-header"><span>当前委托</span><span style="font-size:12px;color:var(--text-dim);font-weight:400">${active.length}笔未成交</span></div>
        <div class="panel-body" style="padding:0">
          ${active.length ? `<table class="tbl"><thead><tr><th>委托时间</th><th>名称代码</th><th>方向</th><th>委托价</th><th>委托量</th><th>已成交</th><th>状态</th><th>操作</th></tr></thead>
          <tbody id="activeOrdersBody">${active.map(o => `<tr data-order-id="${o.id}"><td>${o.time}</td>
            <td><div class="stock-name"><span class="sn-name">${esc(o.name)}</span><span class="sn-code">${o.code}</span></div></td>
            <td><span class="${o.side === 'buy' ? 'up' : 'down'}">${o.side === 'buy' ? '买入' : '卖出'}</span></td>
            <td>${fmt(o.price)}</td><td>${o.volume}</td><td data-field="filledVolume">${o.filledVolume}</td><td data-field="status">${o.status}</td>
            <td><button class="btn btn-sm" onclick="App.cancelOrder('${o.id}')">撤单</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty-state"><div class="es-ico">📋</div>暂无未成交委托</div>'}
        </div></div>
        <div class="panel"><div class="panel-header">历史委托</div><div class="panel-body" style="padding:0">
          ${all.length ? `<table class="tbl"><thead><tr><th>委托时间</th><th>名称代码</th><th>方向</th><th>委托价</th><th>委托量</th><th>成交价</th><th>成交量</th><th>状态</th></tr></thead>
          <tbody>${all.map(o => `<tr><td>${o.time}</td>
            <td><div class="stock-name"><span class="sn-name">${esc(o.name)}</span><span class="sn-code">${o.code}</span></div></td>
            <td><span class="${o.side === 'buy' ? 'up' : 'down'}">${o.side === 'buy' ? '买入' : '卖出'}</span></td>
            <td>${fmt(o.price)}</td><td>${o.volume}</td>
            <td>${o.filledPrice ? fmt(o.filledPrice) : '-'}</td><td>${o.filledVolume || 0}</td><td>${o.status}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state"><div class="es-ico">📋</div>暂无委托记录</div>'}
        </div></div>`;
    } catch (e) { $('#content').innerHTML = errorHtml(e); }
  }

  // ============ 成交 ============
  async function renderDeals() {
    try {
      const deals = await DE.getDealsHistory();
      $('#content').innerHTML = `
        <div class="panel"><div class="panel-header">成交记录</div><div class="panel-body" style="padding:0">
          ${deals.length ? `<table class="tbl"><thead><tr><th>成交时间</th><th>名称代码</th><th>方向</th><th>成交价</th><th>成交量</th><th>成交额</th><th>手续费</th></tr></thead>
          <tbody>${deals.map(d => { const fee = Math.round(d.amount * 0.0003 * 100) / 100; return `<tr>
            <td>${d.time}</td>
            <td onclick="App.openDetail('${d.code}')"><div class="stock-name"><span class="sn-name">${esc(d.name)}</span><span class="sn-code">${d.code}</span></div></td>
            <td><span class="${d.side === 'buy' ? 'up' : 'down'}">${d.side === 'buy' ? '买入' : '卖出'}</span></td>
            <td>${fmt(d.price)}</td><td>${d.volume}</td><td>${fmt(d.amount)}</td><td>${fmt(fee)}</td></tr>`;
          }).join('')}</tbody></table>` : '<div class="empty-state"><div class="es-ico">💱</div>暂无成交记录</div>'}
        </div></div>`;
    } catch (e) { $('#content').innerHTML = errorHtml(e); }
  }

  // ============ 账户 ============
  async function renderAccount() {
    try {
      const a = await DE.getAccount();
      $('#content').innerHTML = `
        <div class="account-cards">
          <div class="acct-card"><div class="ac-label">总资产</div><div class="ac-val" data-field="totalAsset">${fmt(a.totalAsset)}</div><div class="ac-sub">初始资金 ${fmt(a.initCash)}</div></div>
          <div class="acct-card"><div class="ac-label">累计盈亏</div><div class="ac-val ${DE.cls(a.profit)}" data-field="profit">${a.profit >= 0 ? '+' : ''}${fmt(a.profit)}</div><div class="ac-sub ${DE.cls(a.profitPct)}" data-field="profitPct">${DE.fmtPct(a.profitPct)}</div></div>
          <div class="acct-card"><div class="ac-label">可用资金</div><div class="ac-val" data-field="cash">${fmt(a.cash)}</div><div class="ac-sub">可立即交易</div></div>
          <div class="acct-card"><div class="ac-label">持仓市值</div><div class="ac-val" data-field="marketValue">${fmt(a.marketValue)}</div><div class="ac-sub">浮动</div></div>
          <div class="acct-card"><div class="ac-label">冻结资金</div><div class="ac-val" data-field="frozenCash">${fmt(a.frozenCash)}</div><div class="ac-sub">委托冻结</div></div>
          <div class="acct-card"><div class="ac-label">资产构成</div><div class="ac-val" style="font-size:14px" data-field="cashRatio">现金 ${a.totalAsset ? (a.cash / a.totalAsset * 100).toFixed(1) : 0}%</div><div class="ac-sub" data-field="stockRatio">股票 ${a.totalAsset ? (a.marketValue / a.totalAsset * 100).toFixed(1) : 0}%</div></div>
          <div class="acct-card"><div class="ac-label">盈亏比例</div><div class="ac-val ${DE.cls(a.profitPct)}" data-field="profitPctVal">${DE.fmtPct(a.profitPct)}</div><div class="ac-sub">累计收益率</div></div>
          <div class="acct-card"><div class="ac-label">交易统计</div><div class="ac-val" style="font-size:14px" data-field="dealsCount">${(a.dealsCount) || 0}笔成交</div><div class="ac-sub" data-field="ordersCount">${(a.ordersCount) || 0}笔委托</div></div>
        </div>
        <div class="panel"><div class="panel-header">账户操作</div><div class="panel-body" style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="App.resetAccount()">重置账户（恢复100万）</button>
          <button class="btn" onclick="App.addCash(1000000)">入金100万</button>
          <button class="btn" onclick="App.showView('portfolio')">查看持仓</button>
          <button class="btn" onclick="App.showView('orders')">查看委托</button>
          <button class="btn" onclick="App.showView('deals')">查看成交</button>
        </div></div>`;
      updateTopbarAccount(a);
    } catch (e) { $('#content').innerHTML = errorHtml(e); }
  }

  async function resetAccount() {
    if (!await showConfirm('确定重置账户？将清空所有资金、持仓和委托记录。', { danger: true, ico: '⚠️' })) return;
    try { await DE.resetAccount(); renderAccount(); toast('账户已重置', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function addCash(amount) {
    try { await DE.addCash(amount); renderAccount(); toast(`已入金 ${amount} 元`, 'success'); }
    catch (e) { toast(e.message, 'error'); }
  }

  // ============ 资讯 ============
  async function renderNews() {
    try {
      const news = await DE.getNews(30);
      $('#content').innerHTML = `
        <div class="panel"><div class="panel-header">市场资讯</div><div class="panel-body" style="padding:0">
          ${news.map(n => `<div class="news-item" onclick="App.openDetail('${n.code}')">
            <div class="ni-time">${n.time}</div>
            <div class="ni-content">${esc(n.content)}</div>
            <div class="ni-tag ${n.type}">${n.type}</div>
          </div>`).join('')}
        </div></div>`;
    } catch (e) { $('#content').innerHTML = errorHtml(e); }
  }

  // ============ 顶栏 ============
  async function renderTopbarIndices(indices) {
    if (!indices) { try { indices = await DE.getIndices(); } catch (e) { return; } }
    $('#indexBar').innerHTML = indices.map(idx => `<div class="index-item" data-code="${idx.code}" onclick="App.showView('sectors')">
      <div class="ii-name">${esc(idx.name)}</div>
      <div class="ii-val ${DE.cls(idx.pct)}">${fmt(idx.value)}</div>
      <div class="ii-pct ${DE.cls(idx.pct)}">${DE.fmtPct(idx.pct)}</div>
    </div>`).join('');
  }

  // 顶栏资讯滚动条
  async function renderNewsTicker() {
    try {
      const news = await DE.getNews(30);
      if (!news.length) { $('#newsTicker').innerHTML = ''; return; }
      const items = news.map(n => `<span class="nt-item" onclick="App.openDetail('${n.code}')">
        <span class="nt-time">${n.time.slice(11)}</span>
        <span class="nt-tag ${n.type}">${n.type}</span>
        <span class="nt-stock">${esc(n.name)}</span>
        <span>${esc(n.content)}</span>
      </span>`).join('');
      // 复制一份实现无缝滚动
      $('#newsTicker').innerHTML = `
        <div class="nt-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h13a2 2 0 012 2v14H6a2 2 0 01-2-2V4zM19 8h2v11a2 2 0 01-2 2"/><path d="M8 8h7M8 12h7M8 16h4"/></svg>实时资讯</div>
        <div class="nt-viewport"><div class="nt-track">${items}${items}</div></div>`;
    } catch (e) {}
  }

  async function updateTopbarAccount(account) {
    if (!account) { try { account = await DE.getAccount(); } catch (e) { return; } }
    const el = $('#accountSummary');
    if (el) el.innerHTML = `<div class="as-label">总资产</div><div class="as-val ${DE.cls(account.profit)}">¥${fmt(account.totalAsset)}</div>`;
  }

  function updateClock() {
    const d = new Date();
    const time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
    const el = $('#clock');
    if (el) el.textContent = time + ' (实时)';
  }

  // ============ 搜索 ============
  function setupSearch() {
    const input = $('#searchInput');
    const results = $('#searchResults');
    let timer = null;
    input.oninput = () => {
      const kw = input.value.trim();
      clearTimeout(timer);
      if (!kw) { results.classList.remove('show'); return; }
      timer = setTimeout(async () => {
        try {
          const matched = await DE.search(kw);
          if (!matched.length) { results.innerHTML = '<div class="sr-item" style="color:var(--text-dim)">未找到相关股票</div>'; results.classList.add('show'); return; }
          results.innerHTML = matched.map(s => { const m = s.metrics; return `<div class="sr-item" onclick="App.openDetail('${s.code}');App.clearSearch()">
            <span class="sr-code">${s.code}</span>
            <span class="sr-name">${esc(s.name)}</span>
            <span class="${DE.cls(m.pct)}">${fmt(s.price)} ${DE.fmtPct(m.pct)}</span>
          </div>`}).join('');
          results.classList.add('show');
        } catch (e) {}
      }, 200);
    };
    document.addEventListener('click', (e) => { if (!e.target.closest('.search-box')) results.classList.remove('show'); });
  }

  function clearSearch() { $('#searchInput').value = ''; $('#searchResults').classList.remove('show'); }

  // ============ 实时刷新（局部更新，不重建DOM） ============
  function startRefresh() {
    // 顶栏刷新（指数+账户，独立区域）
    topbarTimer = setInterval(async () => {
      try {
        const [indices, account] = await Promise.all([DE.getIndices(), DE.getAccount()]);
        updateTopbarIndices(indices);
        updateTopbarAccount(account);
      } catch (e) {}
    }, 3000);

    // 视图局部刷新（不重建DOM，只更新数据）
    viewRefreshTimer = setInterval(async () => {
      // 个股详情打开时，局部更新价格
      if (detailStockCode && $('#detailOverlay').classList.contains('show')) {
        refreshDetailLive();
      }
      // 有弹窗打开时不刷新列表
      if ($('#detailOverlay').classList.contains('show')) return;
      if ($('#tradeModalOverlay').classList.contains('show')) return;
      // 有输入框聚焦时不刷新
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT')) return;
      // 选股器/成交/资讯不自动刷新（数据静态）
      if (['screener', 'deals', 'news'].includes(currentView)) return;

      try {
        if (currentView === 'market') await refreshMarketLive();
        else if (currentView === 'sectors' && currentSectorName) await refreshSectorLive();
        else if (currentView === 'sectors') await refreshSectorsLive();
        else if (currentView === 'watchlist') await refreshWatchlistLive();
        else if (currentView === 'portfolio') await refreshPortfolioLive();
        else if (currentView === 'rankings') await refreshRankingsLive();
        else if (currentView === 'orders') await refreshOrdersLive();
        else if (currentView === 'account') await refreshAccountLive();
      } catch (e) {}
    }, 5000);
  }

  // 局部更新表格行（通用）
  function updateStockRows(stocks) {
    stocks.forEach(s => {
      const rows = document.querySelectorAll(`tr[data-code="${s.code}"]`);
      if (!rows.length) return;
      const m = s.metrics;
      const cls = DE.cls(m.pct);
      rows.forEach(row => {
        const priceCell = row.querySelector('[data-field="price"]');
        const pctCell = row.querySelector('[data-field="pct"]');
        const changeCell = row.querySelector('[data-field="change"]');
        const amountCell = row.querySelector('[data-field="amount"]');
        if (priceCell) { priceCell.textContent = fmt(s.price); priceCell.className = cls; }
        if (pctCell) { pctCell.textContent = DE.fmtPct(m.pct); pctCell.className = cls; }
        if (changeCell) { changeCell.textContent = (m.change >= 0 ? '+' : '') + fmt(m.change); changeCell.className = cls; }
        if (amountCell) { amountCell.textContent = fmt(m.amount) + '亿'; }
      });
    });
  }

  // 行情首页局部更新
  async function refreshMarketLive() {
    await loadMarketLayout();
    const [gainers, losers, active, sectors, indices, watchlist, holdingsData, ordersData] = await Promise.all([
      DE.getStocks({ sort: 'pct-desc', limit: 8 }),
      DE.getStocks({ sort: 'pct-asc', limit: 8 }),
      DE.getStocks({ sort: 'amount-desc', limit: 8 }),
      DE.getSectors(),
      DE.getIndices(),
      DE.getWatchlist(),
      DE.getHoldings(),
      DE.getOrders()
    ]);
    updateStockRows(gainers); updateStockRows(losers); updateStockRows(active);
    // 保存自选股缓存供轮播使用
    DE._watchlistCache = watchlist;
    watchlist.forEach(s => watchStockData[s.code] = s);
    // 更新自选股模块（数量变化时重建，否则局部更新）
    const watchlistModule = document.querySelector('.market-module[data-module="watchlist"]');
    if (watchlist.length) {
      if (!watchlistModule) {
        // 模块不存在（可能被隐藏或移除），若配置可见则整页重建
        if (marketLayout.find(m => m.id === 'watchlist' && m.visible)) { renderMarket(); return; }
      } else {
        const slides = watchlistModule.querySelectorAll('.wc-slide');
        const existingCodes = Array.from(slides).map(el => el.dataset.code);
        const newCodes = watchlist.map(s => s.code);
        if (existingCodes.join(',') !== newCodes.join(',')) { renderMarket(); return; }
        // 局部更新当前显示的卡片
        const activeSlide = slides[carouselIdx];
        if (activeSlide) {
          const code = activeSlide.dataset.code;
          const s = watchlist.find(x => x.code === code);
          if (s) {
            const m = s.metrics;
            const cls = DE.cls(m.pct);
            const upd = (field, val, c) => { const el = activeSlide.querySelector(`[data-field="${field}"]`); if (el) { el.textContent = val; if (c) el.className = c; } };
            upd('price', fmt(s.price), 'wc-price ' + cls);
            upd('change', (m.change >= 0 ? '+' : '') + fmt(m.change) + ' (' + DE.fmtPct(m.pct) + ')', 'wc-change ' + cls);
            upd('open', fmt(s.open), DE.cls(s.open - s.preClose));
            upd('high', fmt(s.high), 'up');
            upd('low', fmt(s.low), 'down');
            upd('volume', fmtVol(m.volume));
            upd('amount', fmt(m.amount) + '亿');
            upd('turnover', fmt(m.turnover) + '%');
            upd('amplitude', fmt(m.amplitude) + '%');
            upd('marketCap', fmt(m.marketCap) + '亿');
            upd('upLimit', fmt(m.upLimit), 'up');
            upd('downLimit', fmt(m.downLimit), 'down');
            requestAnimationFrame(() => drawWatchChart(s));
          }
        }
      }
    } else if (watchlistModule) {
      renderMarket(); return;
    }
    // 更新持仓模块
    const holdings = holdingsData.holdings || [];
    const holdingsModule = document.querySelector('.market-module[data-module="holdings"]');
    if (holdings.length) {
      if (!holdingsModule) {
        if (marketLayout.find(m => m.id === 'holdings' && m.visible)) { renderMarket(); return; }
      } else {
        holdingsModule.querySelector('.panel-body').innerHTML = holdingsTableMini(holdings, holdingsData.summary);
      }
    } else if (holdingsModule) {
      renderMarket(); return;
    }
    // 更新委托模块
    const activeOrders = (ordersData && ordersData.active) || [];
    const ordersModule = document.querySelector('.market-module[data-module="orders"]');
    if (activeOrders.length) {
      if (!ordersModule) {
        if (marketLayout.find(m => m.id === 'orders' && m.visible)) { renderMarket(); return; }
      } else {
        ordersModule.querySelector('.panel-body').innerHTML = ordersTableMini(activeOrders);
      }
    } else if (ordersModule) {
      renderMarket(); return;
    }
    // 更新指数卡片
    indices.forEach(idx => {
      const card = document.querySelector(`.index-card[data-ic="${idx.code}"]`);
      if (!card) return;
      const cls = DE.cls(idx.pct);
      const valCell = card.querySelector('[data-field="value"]');
      const pctCell = card.querySelector('[data-field="pct"]');
      if (valCell) { valCell.textContent = fmt(idx.value); valCell.className = 'ic-val ' + cls; }
      if (pctCell) { pctCell.textContent = (idx.change >= 0 ? '+' : '') + fmt(idx.change) + ' (' + DE.fmtPct(idx.pct) + ')'; pctCell.className = 'ic-pct ' + cls; }
    });
    // 更新热门板块卡片
    sectors.slice(0, 6).forEach(sc => {
      const card = document.querySelector(`.sector-card[data-sector="${sc.name}"]`);
      if (!card) return;
      const pctCell = card.querySelector('[data-field="avgPct"]');
      if (pctCell) { pctCell.textContent = DE.fmtPct(sc.avgPct); pctCell.className = 'sc-pct ' + DE.cls(sc.avgPct); }
    });
  }

  // 板块页局部更新
  async function refreshSectorsLive() {
    const sectors = await DE.getSectors();
    sectors.forEach(sc => {
      const card = document.querySelector(`.sector-card[data-sector="${sc.name}"]`);
      if (!card) return;
      const pctCell = card.querySelector('[data-field="avgPct"]');
      if (pctCell) { pctCell.textContent = DE.fmtPct(sc.avgPct); pctCell.className = 'sc-pct ' + DE.cls(sc.avgPct); }
    });
  }

  // 自选股局部更新
  async function refreshWatchlistLive() {
    const list = await DE.getWatchlist();
    updateStockRows(list);
  }

  // 持仓局部更新
  async function refreshPortfolioLive() {
    const { holdings, summary } = await DE.getHoldings();
    holdings.forEach(h => {
      const row = document.querySelector(`tr[data-code="${h.code}"]`);
      if (!row) return;
      const cls = DE.cls(h.profitPct);
      const priceCell = row.querySelector('[data-field="price"]');
      const mvCell = row.querySelector('[data-field="marketValue"]');
      const profitCell = row.querySelector('[data-field="profit"]');
      const pctCell = row.querySelector('[data-field="profitPct"]');
      if (priceCell) { priceCell.textContent = fmt(h.price); priceCell.className = cls; }
      if (mvCell) mvCell.textContent = fmt(h.marketValue);
      if (profitCell) { profitCell.textContent = (h.profit >= 0 ? '+' : '') + fmt(h.profit); profitCell.className = DE.cls(h.profit); }
      if (pctCell) { pctCell.textContent = DE.fmtPct(h.profitPct); pctCell.className = cls; }
    });
    // 更新汇总卡片
    const items = $$('.pos-summary-item .psi-val');
    if (items.length >= 5) {
      items[0].textContent = fmt(summary.marketValue);
      items[1].textContent = (summary.totalProfit >= 0 ? '+' : '') + fmt(summary.totalProfit);
      items[1].className = 'psi-val ' + DE.cls(summary.totalProfit);
      items[2].textContent = fmt(summary.cash);
      items[3].textContent = fmt(summary.frozenCash);
    }
  }

  // 排行榜局部更新（仅更新文本，不调整排序）
  async function refreshRankingsLive() {
    const all = await DE.getStocks({ sort: 'pct-desc', limit: 200 });
    updateStockRows(all);
  }

  // 委托页局部更新
  async function refreshOrdersLive() {
    const { active } = await DE.getOrders();
    const body = $('#activeOrdersBody');
    if (!body) return;
    // 当前委托数量变化（成交/撤单后减少），重建视图
    const currentRows = body.querySelectorAll('tr[data-order-id]');
    if (currentRows.length !== active.length) {
      renderOrders();
      return;
    }
    // 数量没变，局部更新状态和已成交量
    active.forEach(o => {
      const row = body.querySelector(`tr[data-order-id="${o.id}"]`);
      if (!row) return;
      const statusCell = row.querySelector('[data-field="status"]');
      const filledCell = row.querySelector('[data-field="filledVolume"]');
      if (statusCell) statusCell.textContent = o.status;
      if (filledCell) filledCell.textContent = o.filledVolume;
    });
  }

  // 账户页局部更新
  async function refreshAccountLive() {
    const a = await DE.getAccount();
    const upd = (field, val, cls) => { const el = $(`[data-field="${field}"]`); if (el) { el.textContent = val; if (cls) el.className = el.className.replace(/\b(up|down|flat)\b/g, '').trim() + ' ' + cls; } };
    const updVal = (field, val, cls) => { const el = $(`[data-field="${field}"]`); if (el) { el.textContent = val; if (cls) el.className = cls; } };
    updVal('totalAsset', fmt(a.totalAsset));
    updVal('profit', (a.profit >= 0 ? '+' : '') + fmt(a.profit), 'ac-val ' + DE.cls(a.profit));
    updVal('profitPct', DE.fmtPct(a.profitPct), 'ac-sub ' + DE.cls(a.profitPct));
    updVal('cash', fmt(a.cash));
    updVal('marketValue', fmt(a.marketValue));
    updVal('frozenCash', fmt(a.frozenCash));
    updVal('cashRatio', '现金 ' + (a.totalAsset ? (a.cash / a.totalAsset * 100).toFixed(1) : 0) + '%');
    updVal('stockRatio', '股票 ' + (a.totalAsset ? (a.marketValue / a.totalAsset * 100).toFixed(1) : 0) + '%');
    updVal('profitPctVal', DE.fmtPct(a.profitPct), 'ac-val ' + DE.cls(a.profitPct));
    updVal('dealsCount', (a.dealsCount || 0) + '笔成交');
    updVal('ordersCount', (a.ordersCount || 0) + '笔委托');
  }

  // 顶栏指数局部更新（不重建DOM）
  function updateTopbarIndices(indices) {
    indices.forEach(idx => {
      const item = document.querySelector(`.index-item[data-code="${idx.code}"]`);
      if (!item) return;
      const cls = DE.cls(idx.pct);
      const valEl = item.querySelector('.ii-val');
      const pctEl = item.querySelector('.ii-pct');
      if (valEl) { valEl.textContent = fmt(idx.value); valEl.className = 'ii-val ' + cls; }
      if (pctEl) { pctEl.textContent = DE.fmtPct(idx.pct); pctEl.className = 'ii-pct ' + cls; }
    });
  }

  async function refreshDetailLive() {
    try {
      const s = await DE.getStock(detailStockCode);
      detailStockData = s;
      const m = s.metrics;
      const cls = DE.cls(m.pct);
      // 更新价格和涨跌
      const priceEl = $('.di-price'), changeEl = $('.di-change');
      if (priceEl) { priceEl.textContent = fmt(s.price); priceEl.className = 'di-price ' + cls; }
      if (changeEl) { changeEl.textContent = `${m.change >= 0 ? '+' : ''}${fmt(m.change)} (${DE.fmtPct(m.pct)})`; changeEl.className = 'di-change ' + cls; }
      // 更新指标
      const upd = (field, val, c) => { const el = $(`[data-field="${field}"]`); if (el) { el.textContent = val; if (c) el.className = c; } };
      upd('open', fmt(s.open), DE.cls(s.open - s.preClose));
      upd('high', fmt(s.high), 'up');
      upd('low', fmt(s.low), 'down');
      upd('volume', fmtVol(m.volume));
      upd('amount', fmt(m.amount) + '亿');
      upd('turnover', fmt(m.turnover) + '%');
      upd('amplitude', fmt(m.amplitude) + '%');
      upd('marketCap', fmt(m.marketCap) + '亿');
      upd('floatMarketCap', fmt(m.floatMarketCap) + '亿');
      upd('upLimit', fmt(m.upLimit), 'up');
      upd('downLimit', fmt(m.downLimit), 'down');
      // 重绘图表
      renderDetailChart();
      // 重新渲染五档盘口和成交明细
      renderOrderBook();
      renderDealsList();
    } catch (e) {}
  }

  // ============ 初始化 ============
  async function init() {
    try {
      const [indices, account] = await Promise.all([DE.getIndices(), DE.getAccount()]);
      renderTopbarIndices(indices);
      updateTopbarAccount(account);
    } catch (e) { console.error('初始化失败', e); }
    renderNewsTicker();
    setInterval(renderNewsTicker, 60000);
    showView('market');
    updateClock();
    setInterval(updateClock, 1000);
    setupSearch();
    startRefresh();

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDetail(); closeTrade(); } });
    $('#detailOverlay').addEventListener('click', (e) => { if (e.target.id === 'detailOverlay') closeDetail(); });
    $('#tradeModalOverlay').addEventListener('click', (e) => { if (e.target.id === 'tradeModalOverlay') closeTrade(); });
    window.addEventListener('resize', () => { if (detailStockCode && $('#detailOverlay').classList.contains('show')) renderDetailChart(); });
  }

  global.App = {
    showView, openDetail, closeDetail, setChartType, setWatchChartType,
    toggleWatch, removeWatch,
    openTrade, closeTrade, switchTrade, adjPrice, adjVol, setVol, submitTrade,
    cancelOrder, runScreener, resetScreener, showSector, clearSearch,
    resetAccount, addCash,
    openLayoutSettings, closeLayoutSettings, toggleModuleVisible, setModuleSize, toggleModuleCollapse, applyLayout, resetLayout
  };

  document.addEventListener('DOMContentLoaded', init);

})(window);
