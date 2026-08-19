/**
 * 模拟炒股 - 图表渲染模块（Canvas）
 * 支持分时图、K线图、成交量柱状图
 */
(function (global) {
  'use strict';

  // 颜色主题（A股：红涨绿跌，配合现代深色主题）
  const COLOR = {
    up: '#f43f5e', upFill: 'rgba(244,63,94,0.15)',
    down: '#10b981', downFill: 'rgba(16,185,129,0.15)',
    flat: '#64748b',
    text: '#e2e8f0', textDim: '#64748b', grid: 'rgba(148,163,184,0.1)',
    bg: 'rgba(10,14,26,0.6)', avg: '#fbbf24', vol: '#6366f1'
  };

  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, w: rect.width, h: rect.height };
  }

  function getColor(val, ref) {
    if (val > ref) return COLOR.up;
    if (val < ref) return COLOR.down;
    return COLOR.flat;
  }

  // ============ 分时图 ============
  function drawMinuteChart(canvas, minuteData, preClose, cursorX) {
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    if (!minuteData.length) return;

    const padL = 24, padR = 46, padT = 15, padB = 28;
    const cw = w - padL - padR, ch = h - padT - padB;
    const volH = Math.max(ch * 0.22, 18);
    const priceH = ch - volH - 4;
    if (priceH < 10) return;

    const prices = minuteData.map(d => d.price);
    const avgPrices = minuteData.map(d => d.avgPrice);
    let maxP = Math.max(...prices, ...avgPrices, preClose);
    let minP = Math.min(...prices, ...avgPrices, preClose);
    const span = Math.max((maxP - minP) * 0.08, preClose * 0.003);
    maxP += span; minP -= span;
    const range = maxP - minP;

    const xOf = (i) => padL + (i / (minuteData.length - 1)) * cw;
    const yOf = (p) => padT + (1 - (p - minP) / range) * priceH;

    // 网格
    drawGrid(ctx, padL, padT, cw, priceH, 4);

    // 昨收虚线
    const yPre = yOf(preClose);
    ctx.strokeStyle = COLOR.textDim;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    line(ctx, padL, yPre, padL + cw, yPre);
    ctx.setLineDash([]);

    // 价格区域填充
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(prices[0]));
    prices.forEach((p, i) => ctx.lineTo(xOf(i), yOf(p)));
    ctx.lineTo(xOf(prices.length - 1), padT + priceH);
    ctx.lineTo(xOf(0), padT + priceH);
    ctx.closePath();
    ctx.fillStyle = prices[prices.length - 1] >= preClose ? COLOR.upFill : COLOR.downFill;
    ctx.fill();

    // 均价线
    ctx.strokeStyle = COLOR.avg;
    ctx.lineWidth = 1;
    ctx.beginPath();
    avgPrices.forEach((p, i) => {
      const x = xOf(i), y = yOf(p);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 价格线
    ctx.strokeStyle = getColor(prices[prices.length - 1], preClose);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    prices.forEach((p, i) => {
      const x = xOf(i), y = yOf(p);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 成交量
    const vols = minuteData.map(d => d.volume);
    const maxVol = Math.max(...vols);
    const volTop = padT + priceH + 8;
    const volYBase = volTop + volH;
    vols.forEach((v, i) => {
      const x = padL + (i / minuteData.length) * cw;
      const bh = (v / maxVol) * volH;
      ctx.fillStyle = minuteData[i].price >= preClose ? COLOR.up : COLOR.down;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(x, volYBase - bh, cw / minuteData.length - 0.5, bh);
    });
    ctx.globalAlpha = 1;

    // 价格刻度
    ctx.fillStyle = COLOR.text;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const p = maxP - (range / 4) * i;
      const y = padT + (priceH / 4) * i;
      ctx.fillStyle = getColor(p, preClose);
      ctx.fillText(p.toFixed(2), padL + cw + 4, y + 4);
    }

    // 时间刻度
    ctx.fillStyle = COLOR.textDim;
    ctx.textAlign = 'center';
    const times = ['09:30', '10:30', '11:30/13:00', '14:00', '15:00'];
    times.forEach((t, i) => {
      const x = padL + (cw / 4) * i;
      ctx.font = '11px sans-serif';
      ctx.fillText(t, x, h - padB + 14);
    });

    // 十字光标
    if (cursorX != null && cursorX >= padL && cursorX <= padL + cw) {
      const ci = Math.max(0, Math.min(minuteData.length - 1,
        Math.round((cursorX - padL) / cw * (minuteData.length - 1))));
      const d = minuteData[ci];
      const px = xOf(ci), py = yOf(d.price);
      drawCrosshair(ctx, padL, padT, cw, priceH, padR, px, py, d.price, preClose);
      drawTooltip(ctx,
        [d.time || '',
         '价: ' + d.price.toFixed(2),
         '均: ' + (d.avgPrice != null ? d.avgPrice.toFixed(2) : '--'),
         '量: ' + formatVol(d.volume)],
        px, py, w, h, padT);
    }
  }

  // ============ K线图 ============
  function drawKlineChart(canvas, klines, options, cursorX) {
    options = options || {};
    const maPeriods = options.ma || [5, 10, 20];
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    if (!klines.length) return;

    const padL = 24, padR = 46, padT = 6, padB = 30;
    const cw = w - padL - padR, ch = h - padT - padB;
    const volH = Math.max(ch * 0.22, 20);
    const priceH = ch - volH - 4;
    if (priceH < 10) return;

    // 可见范围（默认显示最近80根）
    const visibleCount = Math.min(klines.length, 80);
    const start = klines.length - visibleCount;
    const visible = klines.slice(start);

    let maxP = Math.max(...visible.map(k => k.high));
    let minP = Math.min(...visible.map(k => k.low));
    const span = (maxP - minP) * 0.08;
    maxP += span; minP -= span;
    const range = maxP - minP || 1;

    const barW = cw / visible.length;
    const barGap = barW * 0.2;
    const candleW = barW - barGap;
    const xOf = (i) => padL + i * barW + barW / 2;
    const yOf = (p) => padT + (1 - (p - minP) / range) * priceH;

    // 网格
    drawGrid(ctx, padL, padT, cw, priceH, 4);

    // K线
    visible.forEach((k, i) => {
      const x = xOf(i);
      const isUp = k.close >= k.open;
      const color = isUp ? COLOR.up : COLOR.down;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;

      // 影线
      line(ctx, x, yOf(k.high), x, yOf(k.low));
      // 实体
      const yOpen = yOf(k.open), yClose = yOf(k.close);
      const top = Math.min(yOpen, yClose);
      const bh = Math.max(Math.abs(yClose - yOpen), 1);
      ctx.fillRect(x - candleW / 2, top, candleW, bh);
    });

    // 均线
    maPeriods.forEach((period, idx) => {
      const maColors = ['#fbbf24', '#a78bfa', '#06b6d4', '#f472b6'];
      const ma = calcMA(klines, period);
      ctx.strokeStyle = maColors[idx % maColors.length];
      ctx.lineWidth = 1;
      ctx.beginPath();
      let started = false;
      for (let i = start; i < klines.length; i++) {
        if (ma[i] == null) continue;
        const x = xOf(i - start), y = yOf(ma[i]);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });

    // 成交量
    const vols = visible.map(k => k.volume);
    const maxVol = Math.max(...vols) || 1;
    const volTop = padT + priceH + 4;
    const volYBase = volTop + volH;
    visible.forEach((k, i) => {
      const x = xOf(i);
      const bh = (k.volume / maxVol) * volH;
      ctx.fillStyle = k.close >= k.open ? COLOR.up : COLOR.down;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(x - candleW / 2, volYBase - bh, candleW, bh);
    });
    ctx.globalAlpha = 1;

    // 价格刻度
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const p = maxP - (range / 4) * i;
      const y = padT + (priceH / 4) * i;
      ctx.fillStyle = COLOR.text;
      ctx.fillText(p.toFixed(2), padL + cw + 4, y + 4);
    }

    // 时间刻度
    ctx.fillStyle = COLOR.textDim;
    ctx.textAlign = 'center';
    ctx.font = '11px sans-serif';
    const tickCount = 5;
    for (let i = 0; i <= tickCount; i++) {
      const idx = Math.floor((visible.length - 1) * i / tickCount);
      const x = xOf(idx);
      const d = visible[idx];
      if (d) ctx.fillText(d.date.slice(5), x, h - padB + 14);
    }

    // 均线图例
    ctx.textAlign = 'left';
    ctx.font = '11px sans-serif';
    maPeriods.forEach((p, idx) => {
      const maColors = ['#fbbf24', '#a78bfa', '#06b6d4', '#f472b6'];
      const ma = calcMA(klines, p);
      const lastMa = ma[klines.length - 1];
      ctx.fillStyle = maColors[idx];
      ctx.fillText('MA' + p + (lastMa ? ':' + lastMa.toFixed(2) : ''), padL + 4 + idx * 75, padT + 12);
    });

    // 十字光标
    if (cursorX != null && cursorX >= padL && cursorX <= padL + cw) {
      const ci = Math.max(0, Math.min(visible.length - 1,
        Math.round((cursorX - padL - barW / 2) / barW)));
      const k = visible[ci];
      const px = xOf(ci), py = yOf(k.close);
      drawCrosshair(ctx, padL, padT, cw, priceH, padR, px, py, k.close, k.open);
      const chg = k.close - k.open;
      const chgPct = k.pct != null ? k.pct : (k.open ? +((chg / k.open * 100).toFixed(2)) : 0);
      const chgSign = chg >= 0 ? '+' : '';
      drawTooltip(ctx,
        [k.date || '',
         '开: ' + k.open.toFixed(2),
         '高: ' + k.high.toFixed(2),
         '低: ' + k.low.toFixed(2),
         '收: ' + k.close.toFixed(2),
         '涨跌: ' + chgSign + chg.toFixed(2) + ' (' + chgSign + chgPct.toFixed(2) + '%)',
         '量: ' + formatVol(k.volume)],
        px, py, w, h, padT);
    }
  }

  function calcMA(klines, period) {
    const ma = [];
    for (let i = 0; i < klines.length; i++) {
      if (i < period - 1) { ma.push(null); continue; }
      let sum = 0;
      for (let j = 0; j < period; j++) sum += klines[i - j].close;
      ma.push(Math.round(sum / period * 100) / 100);
    }
    return ma;
  }

  // ============ 辅助函数 ============
  function drawGrid(ctx, x, y, w, h, rows) {
    ctx.strokeStyle = COLOR.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= rows; i++) {
      const yy = y + (h / rows) * i;
      line(ctx, x, yy, x + w, yy);
    }
    for (let i = 0; i <= 4; i++) {
      const xx = x + (w / 4) * i;
      line(ctx, xx, y, xx, y + h);
    }
  }

  function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // 十字光标：竖线 + 横线 + 右侧价格标签
  function drawCrosshair(ctx, padL, padT, cw, priceH, padR, px, py, price, ref) {
    ctx.save();
    ctx.strokeStyle = COLOR.textDim;
    ctx.fillStyle = getColor(price, ref);
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    line(ctx, px, padT, px, padT + priceH);
    line(ctx, padL, py, padL + cw, py);
    ctx.setLineDash([]);
    // 价格标签（覆盖右侧刻度）
    ctx.fillRect(padL + cw + 1, py - 9, padR - 2, 18);
    ctx.fillStyle = '#fff';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(price.toFixed(2), padL + cw + 3, py);
    ctx.restore();
  }

  // 浮动信息框
  function drawTooltip(ctx, lines, px, py, w, h, padT) {
    ctx.save();
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let maxW = 0;
    lines.forEach(l => { const tw = ctx.measureText(l).width; if (tw > maxW) maxW = tw; });
    const boxW = maxW + 12, boxH = lines.length * 16 + 8;
    let bx = px + 12;
    if (bx + boxW > w - 2) bx = px - boxW - 12;
    if (bx < 2) bx = 2;
    let by = py + 12;
    if (by + boxH > h - 2) by = py - boxH - 12;
    if (by < padT) by = padT;
    ctx.fillStyle = 'rgba(10,14,26,0.92)';
    ctx.strokeStyle = 'rgba(148,163,184,0.35)';
    ctx.lineWidth = 1;
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeRect(bx, by, boxW, boxH);
    ctx.fillStyle = COLOR.text;
    lines.forEach((l, i) => ctx.fillText(l, bx + 6, by + 5 + i * 16));
    ctx.restore();
  }

  function formatVol(v) {
    if (v == null) return '--';
    if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (v >= 1e4) return (v / 1e4).toFixed(2) + '万';
    return String(v);
  }

  // 绑定鼠标悬停：redraw(x, y) 在鼠标移动时调用，redraw(null, null) 在移出时调用
  function bindHover(canvas, redraw) {
    if (canvas._hoverMove) canvas.removeEventListener('mousemove', canvas._hoverMove);
    if (canvas._hoverLeave) canvas.removeEventListener('mouseleave', canvas._hoverLeave);
    let raf = 0, px = null, py = null;
    const flush = () => { raf = 0; redraw(px, py); };
    canvas._hoverMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      px = e.clientX - rect.left;
      py = e.clientY - rect.top;
      if (!raf) raf = requestAnimationFrame(flush);
    };
    canvas._hoverLeave = () => { px = null; py = null; if (!raf) raf = requestAnimationFrame(flush); };
    canvas.addEventListener('mousemove', canvas._hoverMove);
    canvas.addEventListener('mouseleave', canvas._hoverLeave);
    canvas.style.cursor = 'crosshair';
  }

  // ============ 简易饼图（板块分布） ============
  function drawPieChart(canvas, data) {
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 10;
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    const colors = ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#94a3b8', '#f97316'];
    let angle = -Math.PI / 2;
    data.forEach((d, i) => {
      const slice = (d.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, angle, angle + slice);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      angle += slice;
    });
  }

  global.Charts = {
    drawMinuteChart, drawKlineChart, drawPieChart, bindHover, COLOR
  };

})(window);
