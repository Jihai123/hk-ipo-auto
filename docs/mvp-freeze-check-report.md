# 微信小程序 MVP 封版检查报告

## 一、页面与路由检查

- `app.json` 已注册 `home`、`score`、`timeline` 三个页面。 
- 首页支持三种路径进入评分页：
  - 评分榜点击；
  - 时间表摘要点击；
  - 搜索提交与最近查询点击。 
- 时间表独立页支持点击股票进入评分页。 
- 未发现漏注册页面与不可达主路径。

风险提示：
- 跳转依赖 `code` 参数，当前已在点击前做空值保护；若后端返回空 code，点击会被忽略。

## 二、页面状态完整性检查

- 首页：具备 `loading`、`error`，成功态内含局部空态（榜单/时间表为空时显示“暂无数据”）。
- 评分页：具备 `loading / success / empty / error`，并支持手动重试与下拉刷新。
- 时间表页：具备 `loading / success / empty / error`，并在 `degraded.timeline=true` 且全空时优先 error。

风险提示：
- 首页没有独立全局 `empty` 分支（非阻塞）。

## 三、接口契约检查

### `/api/mp/home`
- 已输出：`success`、`updatedAt`、`degraded`、`topList`、`timelineSummary`、`market`、`error`。

### `/api/mp/score/:code`
- 已输出：`success`、`code`、`name`、`totalScore`、`rating`、`ratingLabel`、`dimensions`、`display`、`error`。

风险提示：
- 首页评分榜展示当前使用 `item.rating`，现在是枚举值（buy/neutral/avoid），如希望中文展示建议改用 `ratingLabel`（非阻塞，体验问题）。
- `name` 在缓存命中且未走搜索时可能为空，前端已回退到 `code`。

## 四、搜索体验检查

- 已覆盖：输入清洗（仅数字）、非法输入拦截、自动补零、最近查询、历史点击跳评分页。
- 历史存储：本地 key `hk_ipo_recent_searches_v1`，最多 6 条，去重、最新优先。

风险提示：
- 超过 5 位数字会提示失败，不会跳转（符合预期）。

## 五、UI 一致性检查

- 三页均为简洁卡片化、深浅中性色为主，整体风格一致。
- `page-state` 组件统一了评分页和时间表页的状态提示。

建议（非阻塞）：
- 首页可考虑后续也接入 `page-state` 以完全统一状态视觉。

## 六、边界与误改检查

- 近几次提交变更集中在：`miniprogram/*`、`server.js`（仅 mp 接口）、`docs/*`。
- 未发现改动 `public/*`、`client/*`、`crawlers/*`。
- 现有旧 `/api/*` 仍保留并与 `/api/mp/*` 并行。
- 架构仍是“单后端 + 多前端（旧网页 + 小程序）”。

## 七、真机联调前检查清单

1. 配置小程序合法 request 域名（生产必须 HTTPS）。
2. `app.json` 页面注册是否完整。
3. `utils/constants.js` 的接口地址切换策略（本地/测试/生产）。
4. 首页、评分页、时间表页下拉刷新是否生效。
5. `home -> score`、`timeline -> score` 路由是否可达。
6. 异常提示是否可见（断网、非法 code、空数据）。
7. 空列表场景是否不崩。

## 八、MVP 封版结论

**结论：A. 可以直接进入开发者工具联调。**

建议联调前先做 2 个非阻塞小修：
1. 首页评分榜展示改用 `ratingLabel`。
2. `API_BASE` 增加环境切换（避免真机仍指向 localhost）。
