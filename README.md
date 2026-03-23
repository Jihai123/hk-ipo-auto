# 港股新股自动评分系统 v3.0

## 本次页面增强改造

本次改造遵循“**评分主导 + 信息增强**”原则：

- **评分模块完全保留且仍是第一视觉核心**：保留原有总分、评级、维度分数、评分逻辑、评分展示区与交互位置。
- **首页 / 列表页增强**：在评分榜卡片中新增上市状态、上市日期、一手金额、每手股数、招股价、现价/较招股价涨跌幅、首日涨跌幅、认购倍数、中签率、数据更新时间等辅助字段。
- **详情区增强**：在原评分结果下方新增关键信息补充卡、上市时间表、打新门槛与收益测算、热度信息、数据来源与更新时间模块。
- **后端增量扩展字段**：接口在保持兼容的前提下新增 `listing_status`、`listing_date`、`offer_start_date`、`offer_end_date`、`pricing_date`、`allotment_result_date`、`refund_date`、`lot_size`、`lot_amount`、`offer_price`、`current_price`、`current_vs_offer_pct`、`first_day_change_pct`、`first_day_lot_profit`、`current_lot_profit`、`subscription_multiple`、`allotment_rate`、`updated_at`、`source_name`、`source_url` 等字段。
- **衍生逻辑统一后端计算**：一手金额、较招股价涨跌幅、首日/当前每手盈亏、破发判断统一在后端生成，前端只负责展示。
- **缺失字段优雅降级**：无数据时统一展示“暂无数据”，不影响原有评分功能与页面稳定性。

> 注意：不要重做成普通股票页，评分区必须仍然是第一视觉核心。新增信息是辅助增强，用来填充空白和提升完成度。

## 新特性
- ✅ SQLite数据库存储保荐人历史数据
- ✅ 爬虫自动从AAStocks获取真实数据
- ✅ etnet 静态字段补充与后端衍生字段计算
- ✅ 首页卡片与评分详情区信息密度增强
- ✅ 响应式优化，移动端仍保持评分优先

## 快速部署

### 1. 上传文件到服务器
将以下文件/文件夹上传到 `/www/wwwroot/zhibeimao.com/hk-ipo-auto/`:
- server.js
- package.json
- scripts/
- public/
- crawlers/

### 2. 安装依赖
```bash
cd /www/wwwroot/zhibeimao.com/hk-ipo-auto/
npm install
```

### 3. 初始化数据
```bash
node scripts/init-history-data.js
node scripts/crawler-ipo-list.js
```

如需同时为列表新股评分：
```bash
node scripts/crawler-ipo-list.js --score
```

### 4. 启动服务
```bash
npm start
```

## API接口

| 接口 | 说明 |
|------|------|
| GET /api/health | 健康检查 |
| GET /api/score/:code | 评分详情 + 增量扩展字段 |
| GET /api/ipo/top | 首页评分榜卡片数据 |
| GET /api/ipo/current | 当前IPO列表（带扩展字段） |
| GET /api/ipo/history | 历史表现 |
| GET /api/market/stats | 市场环境统计 |
| GET /api/sponsors | 获取所有保荐人数据 |
| GET /api/sponsors/top | 获取TOP保荐人 |
| GET /api/cache/clear/:code | 清除股票缓存 |

## 数据来源
- 保荐人数据：AAStocks
- 招股书：港交所披露易
- IPO静态字段：etnet 页面抓取 / 本地缓存 / 列表脚本 mock 数据

## 注意事项
1. 原有评分逻辑与评分接口兼容保留。
2. 若交易所或抓取链路未提供某些字段，接口会返回空值并由前端显示“暂无数据”。
3. `scripts/crawler-ipo-list.js` 目前仍包含 mock 列表数据示例，便于本地验证新增字段展示。
