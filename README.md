# 港股新股自动评分系统 v3.0

## 本次改造重点（评分内核不变）

- 保留 `/api/score/:code` 接口路径与评分主流程，不改评分维度、权重、算法和历史验证链路。
- 首页真实入口继续是 `server.js + public/index.html`，本次改造只落在该生效层。
- ETNet IPO 数据源重构为：**板块/列表页主源 + detail 页补源**。
- 前端已下线 PE 展示（仅展示总分与评级），后端 PE 逻辑保留，便于后续继续修复。

---

## ETNet IPO 多源融合说明

### 1) 字段主源：ETNet IPO 板块页 / 列表页

主源板块包含：

- 暗盘区（grey market）
- 今日上市区（listed today）
- 上市时间表（timetable）
- 招股中（subscribing）
- 即将上市（listing soon）
- 新股信息（ipo info）
- 申请上市（通过聆讯，hearing passed）

在融合层中优先取板块字段：

- `name`, `status`, `listing_date`, `offer_price`, `offer_price_range`, `lot_size`, `lot_cost`
- `subscription_multiple`, `guaranteed_lot`, `success_rate`
- `current_price`, `cumulative_return`, `grey_market_top_quote`

### 2) 字段补源：ETNet detail 页

detail 页仅用于补充：

- `industry`, `market`, `sponsor`, `underwriters`
- `offer_price_mid`, `lot_size`（主源缺失时）
- timeline 明细、`market_cap`、`nav_per_share`、`offered_shares`

### 3) 为什么 `name` 不应从 detail 页取

- detail 页经常受页面模板、缓存和文案变化影响。
- 首页榜单需要与板块列表一致的公司名，避免出现空名或不一致命名。
- 因此优先使用板块页列表名，detail 仅在**明确标签提取**时兜底，不用 `<title>`/`body` 猜测。

### 4) 为什么 `status` 优先由板块位置决定

- 板块即业务状态（招股中/暗盘/今日上市）本身，语义最稳定。
- 当板块状态缺失时才回退到时间线推断，避免 body keyword 猜测导致误判。

---

## 前端 PE 下线说明

- 本次仅移除前端面向用户的 PE 展示字段和文案。
- Dashboard 面向前端输出不再包含 `pe*` 展示字段。
- 后端评分内核中的 PE 计算和证据链仍保留（不删除），后续可继续修复和恢复展示。

---

## Live / Fixture 测试方法

> 以下命令均可在你的服务器目录执行（例如 `/www/wwwroot/zhibeimao.com/hk-ipo-auto/`）。

### 1) Live 测试

```bash
node scripts/test-etnet-live.js --code=03355
node scripts/test-dashboard-live.js
```

输出将包含：

- source section coverage
- 每个字段来源（list / detail / fallback）
- `name` 与 `status` 来源证据
- dashboard 各状态条数、top3 完整度、PE 字段泄漏检查

### 2) Fixture 测试

```bash
IPO_DATA_MODE=fixture node scripts/test-etnet-fixture.js
IPO_DATA_MODE=fixture node scripts/test-dashboard-fixture.js
```

Fixture 文件：

- `tests/fixtures/etnet/ipo-board.html`
- `tests/fixtures/etnet/grey-market.html`
- `tests/fixtures/etnet/listed-today.html`
- `tests/fixtures/etnet/subscribing.html`

---

## 快速部署

```bash
npm install
npm start
```

可访问：

- 首页：`/hk/`
- 评分：`/api/score/:code`
- Dashboard：`/api/dashboard`
