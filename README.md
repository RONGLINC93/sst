# 模拟炒股终端 (SST)

一个纯前端 + Node.js 后端的模拟炒股软件，数据存储在本地 JSON 文件，无需数据库。包含行情、交易、自选、资讯等完整功能。

## 功能

- **行情**：沪深双市指数、涨幅榜/跌幅榜/成交额榜/换手榜、热门板块、自选股轮播
- **个股详情**：分时图、日K/周K/月K 切换、五档买卖盘、成交明细、12 项指标、公司信息
- **K 线交互**：鼠标悬停显示十字光标 + 价格信息框（开/高/低/收/涨跌幅/成交量）
- **交易**：买入/卖出、撤单、当前委托、历史成交
- **持仓**：盈亏汇总、个股持仓详情
- **资讯**：底部滚动条，点击跳转个股

## 技术栈

- 后端：Node.js + Express，JSON 文件存储
- 前端：原生 HTML/CSS/JS，Canvas 绘制 K 线和分时图
- UI：玻璃拟态（glassmorphism）+ 渐变色，内联 SVG 图标

## 目录结构

```
sst/
├── server.js              # Express 服务器，REST API
├── server/
│   ├── engine.js          # 行情引擎（价格波动、指标计算、资讯生成）
│   └── trader.js         # 交易引擎（下单、撤单、持仓、自选、账户）
├── js/
│   ├── app.js            # 应用主逻辑（路由、渲染、交互）
│   ├── api.js           # API 封装
│   ├── charts.js        # K 线/分时图绘制 + 悬停十字光标
│   ├── format.js        # 数值/时间格式化
│   └── utils.js         # 工具函数
├── css/
│   └── style.css        # 全局样式
├── index.html           # 主页面
└── data/                # 运行时生成的 JSON 数据（不入库）
```

## 快速开始

```bash
npm install
npm start
# 打开 http://localhost:9527
```

## API 速览

| 方法   | 路径                  | 说明                |
| ------ | --------------------- | ------------------- |
| GET    | `/api/stocks`         | 股票列表（含指标）  |
| GET    | `/api/indices`        | 指数列表            |
| GET    | `/api/sectors`        | 板块统计            |
| GET    | `/api/stock/:code`    | 个股详情            |
| GET    | `/api/orderbook/:code`| 五档买卖盘          |
| GET    | `/api/deals/:code`    | 成交明细            |
| GET    | `/api/company/:code`  | 公司信息            |
| GET    | `/api/news`           | 资讯列表            |
| GET    | `/api/search?kw=`     | 股票搜索            |
| GET    | `/api/account`        | 账户总览            |
| POST   | `/api/account/reset`  | 重置账户            |
| POST   | `/api/account/deposit`| 入金                |
| GET    | `/api/holdings`       | 持仓汇总            |
| GET    | `/api/orders`        | 委托列表            |
| POST   | `/api/trade`         | 提交交易            |
| POST   | `/api/cancel-order`   | 撤单                |
| GET    | `/api/watchlist`     | 自选股列表          |
| POST   | `/api/watchlist/toggle` | 切换自选         |
| GET    | `/api/deals-history`  | 成交历史            |

## 运行机制

- 行情引擎每 2 秒推一次价格波动（含指数）
- 行情数据每 10 秒持久化一次到 `data/` 目录
- 前端通过定时轮询刷新行情/自选/委托等数据
- 所有用户数据（账户、持仓、委托、自选）均存储在 `data/*.json`

## 端口

默认 `9527`，可通过环境变量 `PORT` 修改：

```bash
PORT=8080 npm start
```

## 浏览器支持

现代浏览器（Chrome / Edge / Firefox 最新版），需支持 ES6+、Canvas、Flex/Grid 布局。
