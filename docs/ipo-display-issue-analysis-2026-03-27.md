# 新股时间表展示问题原因分析（仅分析，不改代码）

日期：2026-03-27

## 结论摘要

1. **“待上市”为空的直接原因**：
   后端 ETNet 列表爬虫里虽然声明了 `listingSoon` 字段，但**没有任何解析逻辑给它赋值**，最终一直是空数组。

2. **“近期上市”缺少最新几只新股的直接原因**：
   当前爬虫只解析了固定的 `table#8`（代码中 `FIXED_TABLE_INDEX.recentListed = 7`）作为“近期上市”来源，
   但 ETNet 页面中你截图里最上面那批“最新上市/昨上市”的卡片区（如 01021、02526、02726、06636）不在这张固定表里，
   因此不会被抓到。

3. **补充风险点**：
   “近期上市”结果还被硬限制 `slice(0, 12)`，即最多保留 12 条；即使解析到更多，也会截断。

---

## 代码证据

### 1) 为什么“待上市”为空

- `result` 初始化时有 `listingSoon: []`。
- 后续只赋值了 `subscribing` 和 `recentListed`：
  - `result.subscribing = parsed.subscribing`
  - `result.recentListed = parsed.recentListed`
- `listingSoon` 没有从页面任何位置解析并写入，只是在最后又做了一次 `uniqByCode(result.listingSoon)`，因此仍为空。

对应文件：`crawlers/etnet/ipoList.js`

### 2) 为什么“近期上市”没有最新几只

- 当前只解析固定表：
  - `FIXED_TABLE_INDEX.recentListed = 7`（即第 8 张表）
  - `parseFixedTables()` 仅处理 `subscribingTable` 与 `recentTable`
- 代码没有解析页面顶部的“最新上市/昨上市”卡片区块，所以那部分数据不会进入 `recentListed`。

对应文件：`crawlers/etnet/ipoList.js`

### 3) 前端/接口并非主因（只是按后端数据展示）

- 前端 `getCurrentData()` 直接读取接口返回的 `listingSoon`（或兼容字段 `coming`）与 `recentListed`（或 `listed`）。
- 后端 `/api/ipo/current` 也只是把当前缓存/爬虫结果返回。

即：展示层没有额外过滤掉“待上市”或“近期上市最新项”，核心瓶颈在 ETNet 抓取层的数据来源覆盖不全。

---

## 验证过程记录

- 通过代码静态检查确认 `listingSoon` 没有解析流程。
- 尝试直接运行 ETNet 列表爬虫进行线上验证，但当前环境请求 ETNet 返回 403（被目标站点拦截），因此未能在本地复现在线抓取结果。

