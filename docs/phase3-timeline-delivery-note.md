# Phase 3 交付说明（时间表独立页）

## 完成内容

- 仅实现 Phase 3：小程序时间表独立页。数据源仅使用 `/api/mp/home`，未改后端接口契约。 
- 时间表页支持三组分区展示：`招股中 / 待上市 / 近期上市`。 
- 支持下拉刷新与点击股票跳转评分详情页（`/pages/score/index?code=xxxxx`）。
- 支持四种状态：`loading / success / empty / error`。 
- 当 `degraded.timeline=true` 且三组为空时，优先显示错误/降级态。 
- 更新时间做了移动端友好格式：`YYYY-MM-DD HH:mm`。

## 范围控制

- 未修改：`server.js`、`crawlers/*`、`public/*`、`client/*`。
- 未扩展：复杂筛选、收藏、搜索独立页、后端新增能力。

## 变更文件（Phase 3）

- `miniprogram/pages/timeline/index.js`
- `miniprogram/pages/timeline/index.json`
- `miniprogram/pages/timeline/index.wxml`
- `miniprogram/pages/timeline/index.wxss`
- `miniprogram/components/timeline-stock-card/index.js`
- `miniprogram/components/timeline-stock-card/index.json`
- `miniprogram/components/timeline-stock-card/index.wxml`
- `miniprogram/components/timeline-stock-card/index.wxss`
- `miniprogram/services/timeline.js`
- `miniprogram/utils/timeline.js`
- `miniprogram/app.json`（注册页面）
- `miniprogram/pages/home/index.js`（最小入口跳转）
- `miniprogram/pages/home/index.wxml`（最小入口按钮）

