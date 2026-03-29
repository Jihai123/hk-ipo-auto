# 微信小程序实施方案（基于 hk-ipo-auto，低风险 MVP 版）

> 目标：在现有项目上新增微信小程序版本，复用后端与评分逻辑，不破坏现有网站，先跑通 MVP。

## 一、接入方案定稿

### 推荐方案
**在当前仓库新增 `miniprogram/` 目录（前端独立），后端最小新增 `api/mp/*` 聚合层。**

### 为什么是这个方案
1. **最小改动复用最大**：现有核心能力（`/api/score/:code`、`/api/ipo/current`、`/api/ipo/top`）可直接复用。  
2. **风险可控**：不动现有网页入口 `public/index.html` + `public/home.js` 的行为，不改评分逻辑。  
3. **交付快**：小程序前端与现网页前端解耦，后端只做少量“输出层适配”。

### 对现有网站影响边界
- **允许影响**：仅新增路由（`/api/mp/*`）与少量辅助函数（聚合/瘦身/超时兜底）。
- **禁止影响**：
  - 不修改现有 `/api/*` 返回结构。
  - 不改 `scoreProspectus()` 评分规则。
  - 不改 ETNet 爬虫抓取逻辑。
  - 不改 `public/index.html`、`public/home.js` 的 UI 与交互。

### 第一阶段后端允许改哪些文件
- `server.js`（仅新增 `api/mp/*` 路由与组装函数）
- `docs/`（接口契约文档）

### 第一阶段不要改哪些文件
- `crawlers/etnet/*.js`（抓取逻辑）
- `public/index.html`、`public/home.js`（现网网页）
- `client/src/*`（与 MVP 小程序无直接上线关系）

---

## 二、页面结构与流转

### MVP 页面建议
1. **首页（Home）**：搜索框 + 轻量评分榜 + 时间表摘要。
2. **评分详情页（Score Detail）**：单股票评分结果、核心维度与结论。
3. **时间表页（Timeline）**：招股中 / 待上市 / 近期上市。
4. **搜索页（Search）**：可与首页合并（推荐第一版合并，减少页面复杂度）。

### 跳转关系（建议统一到评分详情页）
- 首页点击评分榜股票 → **评分详情页**（带 `code` 参数）
- 首页点击时间表股票 → **评分详情页**（带 `code` 参数）
- 搜索股票代码后 → **评分详情页**

### 第一版是否要资讯详情/IPO基础详情页
- **不建议第一版单独做**“资讯详情页”或“IPO基础详情页”。
- 原因：
  - 现有核心价值是评分，不是资讯分发。
  - 详情基础信息可在评分页顶部展示（公司名、代码、状态、上市日等）。
  - 可避免为“未评分股票”设计额外复杂状态流。

### 是否建议统一跳到评分详情页
- **建议统一跳转到评分详情页**。
- 原因：
  - 用户目标明确（看是否值得打新）；
  - 减少路由分叉与状态管理复杂度；
  - 复用现有 `/api/score/:code`，上线速度快。

---

## 三、现有接口复用评估

### 1) `GET /api/score/:code`
- **是否可直接复用**：可复用（核心）
- **问题**：冷请求链路重（搜索招股书 + 下载解析 + 评分），耗时可能较长。
- **建议**：
  - 小程序端做好 loading/timeout/retry。
  - 增加 `GET /api/mp/score/:code` 作为轻薄适配层（可先透传）。

### 2) `GET /api/ipo/current`
- **是否可直接复用**：可复用
- **问题**：存在兼容旧字段与展示 fallback，字段对小程序略“冗”。
- **建议**：
  - 小程序首版可以直接用；
  - 通过 `GET /api/mp/home` 返回摘要版（每组前 N 条 + 统一空值规范）。

### 3) `GET /api/ipo/top`
- **是否可直接复用**：谨慎复用
- **问题**：冷缓存下可能触发评分计算，首页首屏可能慢。
- **建议**：
  - 首页不直接依赖它做“阻塞首屏”；
  - 优先走 `GET /api/mp/home`，后端提供缓存优先 + 超时降级。

### 4) `GET /api/market/stats`
- **是否可直接复用**：可复用（次核心）
- **问题**：其中 `subscriptionMultiple` 带随机模拟逻辑，展示价值有限。
- **建议**：首版只取关键指标（`avgReturn`、`breakRate`、`heatIndex`），并标注“更新时间”。

### 5) `GET /api/ipo/history`
- **是否可直接复用**：可复用（非首屏刚需）
- **问题**：体量相对大、非核心转化路径。
- **建议**：
  - 不进首屏强依赖；
  - 需要时再懒加载“历史表现”卡片。

### 是否建议新增 `/api/mp/*` 聚合层
- **建议新增，且保持最小化**。
- 原因：降低小程序前端拼装复杂度、减少多接口并发失败链路、避免直接改现有 `/api/*` 语义。

---

## 四、小程序专用接口方案（最小可行）

### A. `GET /api/mp/home`
- **作用**：小程序首页一次请求拿到首屏所需数据。
- **来源**：聚合 `/api/ipo/top`（或其内部函数）、`/api/ipo/current`、`/api/market/stats`。
- **建议返回**：

```json
{
  "success": true,
  "updatedAt": "2026-03-28T00:00:00.000Z",
  "topList": [
    { "code": "01234", "name": "示例", "score": 78, "rating": "建议申购", "status": "subscribing", "listingDate": "2026-04-10" }
  ],
  "timelineSummary": {
    "subscribing": [
      { "code": "01234", "name": "示例", "listingDate": "2026-04-10", "offerEndDate": "2026-04-03", "lotAmount": 4545 }
    ],
    "listingSoon": [],
    "recentListed": []
  },
  "market": {
    "avgReturn": "+12.5%",
    "breakRate": "32%",
    "heatIndex": 78
  },
  "degraded": {
    "topList": false,
    "timeline": false,
    "market": false
  }
}
```

- **为什么这样设计**：
  - 字段扁平，页面直接渲染；
  - `degraded` 标志便于前端做局部降级提示；
  - 减少前端二次拼装与多请求并发。

### B. `GET /api/mp/score/:code`
- **作用**：评分详情页专用接口。
- **来源**：复用现有 `/api/score/:code`（先透传，再逐步瘦身）。
- **建议返回（首版）**：

```json
{
  "success": true,
  "stockCode": "01234",
  "name": "示例公司",
  "totalScore": 78,
  "rating": "建议申购",
  "elapsed": "24.3s",
  "scores": {
    "oldShares": { "score": 0, "reason": "无旧股", "details": "..." },
    "sponsor": { "score": 2, "reason": "保荐人优秀", "details": "..." },
    "cornerstone": { "score": 2, "reason": "有明星基石", "details": "..." },
    "lockup": { "score": 0, "reason": "有禁售", "details": "..." },
    "industry": { "score": 1, "reason": "成长赛道", "details": "..." }
  },
  "display": {
    "listingDate": "2026-04-10",
    "subscriptionMultiple": 18.6,
    "hasGreenShoe": true
  }
}
```

- **为什么这样设计**：保留核心解释性字段，首版不裁剪过度，减少与既有接口偏差。

### C. `GET /api/mp/ipo/:code`（可选）
- **作用**：给“未评分或评分前”状态提供轻量基础信息（状态、上市日、入场费）。
- **是否首版必须**：**非必须**。建议首版先不做；只有当“先看基础信息再评分”成为明确需求时再加。

### D. 其他接口（克制）
- 不建议第一版新增更多接口，避免后端面扩张。

---

## 五、首页数据策略

### 首屏请求建议
- **只请求一个接口**：`GET /api/mp/home`。
- 首页首屏显示：
  - 轻量评分榜（3~5 条）
  - 时间表摘要（每组 3 条）
  - 3 个市场指标（可选）

### 是否直接调用 `/api/ipo/top`
- **不建议小程序首页直接调用**。
- 原因：冷缓存可能慢，影响首屏；且小程序需要的是“轻量榜单”不是完整结构。

### `/api/ipo/top` 冷缓存慢时如何处理
- 在 `/api/mp/home` 里做“缓存优先 + 超时降级”：
  - top 超时（如 1500~2500ms）→ 返回上次缓存/空数组 + `degraded.topList=true`。
  - timeline 与 market 仍可正常返回，保障页面可用。

### 哪些数据必须缓存
- 首页榜单（topList）
- 时间表摘要（timelineSummary）
- 首页聚合结果（home payload）

### 哪些数据不应实时重算
- 首页榜单评分（不要在首页实时触发多只重算）
- 历史表现统计（可按小时/天更新）

---

## 六、评分详情页策略

### 是否直接调 `/api/score/:code`
- **可行**，并且第一版建议复用（通过 `/api/mp/score/:code` 透传）。

### 慢请求下的前端策略
1. **loading**：分阶段文案（搜索招股书/下载解析/生成评分）。
2. **timeout**：建议 60~90s 前端超时；显示“可重试”按钮。
3. **retry**：指数退避，最多 2 次；第二次失败给出明确文案。
4. **失败提示**：区分“未找到招股书 / 网络问题 / 超时 / 系统异常”。

### 是否要更轻详情接口
- **第一版可不做**，避免新增复杂度。
- 若后续转化数据表明评分页慢，可再引入“评分摘要缓存接口”。

### 评分详情页首版展示字段（建议）
- 必须：`name/code/totalScore/rating/5大核心维度(分值+原因)`
- 建议：`listingDate/subscriptionMultiple/hasGreenShoe`（作为补充）
- 先不展示：超长证据文本、复杂章节上下文、大段富文本

---

## 七、推荐目录结构

```text
miniprogram/
├─ app.js
├─ app.json
├─ app.wxss
├─ pages/
│  ├─ home/
│  │  ├─ index.js
│  │  ├─ index.wxml
│  │  └─ index.wxss
│  ├─ score/
│  │  ├─ index.js
│  │  ├─ index.wxml
│  │  └─ index.wxss
│  ├─ timeline/
│  │  ├─ index.js
│  │  ├─ index.wxml
│  │  └─ index.wxss
│  └─ search/                # 可选；也可先合并到 home
│     ├─ index.js
│     ├─ index.wxml
│     └─ index.wxss
├─ components/
│  ├─ ipo-card/
│  ├─ score-badge/
│  ├─ score-dimension/
│  └─ loading-state/
├─ services/
│  ├─ api.js                 # request 封装
│  ├─ home.js
│  ├─ score.js
│  └─ ipo.js
├─ utils/
│  ├─ format.js
│  ├─ constants.js
│  └─ error-map.js
└─ store/                    # 第一版可省略，用 page-level state
```

### 状态层建议
- 第一版 **不强制引入 store**（数据量小、页面少）。
- 后续跨页状态增多再引入（如收藏/登录/埋点队列）。

### tabBar 建议
- 可配简化 tabBar：`首页`、`时间表`。
- 搜索入口放首页顶部，评分页走非 tab 页面。

### 分包建议
- 第一版 **不建议分包**（页面少，复杂度收益比低）。

---

## 八、开发阶段计划（可执行）

### Phase 0：后端最小接口准备
- **主要改文件**：`server.js`、`docs/`
- **产出**：`/api/mp/home`、`/api/mp/score/:code`（最小可用）
- **验收**：
  - 可稳定返回首页数据（允许部分降级）
  - 单 code 能返回评分结果
  - 现有 `/api/*` 行为不变

### Phase 1：小程序骨架 + 首页
- **主要改文件**：`miniprogram/app.*`、`pages/home/*`、`services/home.js`
- **产出**：首页可展示榜单+时间表摘要+搜索入口
- **验收**：冷启动<3s（本地体验目标），接口失败有降级显示

### Phase 2：评分详情页
- **主要改文件**：`pages/score/*`、`services/score.js`
- **产出**：输入/跳转 code 后可看到评分、维度、结论
- **验收**：loading/timeout/retry/错误态完整可用

### Phase 3：时间表页
- **主要改文件**：`pages/timeline/*`、`services/ipo.js`
- **产出**：三分组列表与基础字段展示
- **验收**：从首页可跳转到时间表页；点击股票可进评分页

### Phase 4：搜索与体验优化
- **主要改文件**：`pages/home/*` 或 `pages/search/*`、`utils/error-map.js`
- **产出**：搜索交互完善、错误文案优化、埋点基础
- **验收**：搜索->评分页成功率、重试成功率达到预设目标

---

## 九、风险与边界控制

### 最容易影响现网的网站风险点
1. 改动现有 `/api/*` 返回字段。
2. 在 `server.js` 中改动已有路由的执行顺序/错误处理。
3. 为小程序“顺手”重构评分引擎或抓取层。

### 如何避免把 `server.js` 改崩
- 采用“新增不修改”原则：只新增 `api/mp/*`，不改旧路由实现。
- 新增逻辑放在独立函数，避免插入已有评分流程核心路径。
- 每次改动后做最小回归：`/api/health`、`/api/score/:code`、`/api/ipo/current`。

### 如何避免接口契约影响现网
- `api/mp/*` 与 `api/*` 完全隔离。
- 契约文档先行，字段命名一次定稿，避免前后端反复拉扯。

### 第一版最容易高估的功能
- “资讯内容体系”
- “复杂个性化推荐”
- “账号/订阅/社交分享闭环”

### 第一版明确不要做
- 不做资讯详情体系
- 不做复杂排行榜筛选
- 不做重型图表与超长证据展示
- 不做大规模后端重构

---

## 十、最终建议

1. **方案定稿**：同仓新增 `miniprogram/` + 后端最小 `api/mp/*`。  
2. **交付策略**：先“首页 + 评分详情 + 时间表”三件套，不做额外内容体系。  
3. **技术策略**：强复用现有评分/抓取；把改动限定在“输出层适配”。  
4. **风险策略**：只新增不改旧，接口隔离，阶段验收，逐步上线。

> 这样能在最短周期内做出可上线小程序 MVP，同时把对现有网站与评分系统的风险降到最低。
