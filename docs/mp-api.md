# Mini Program API (Phase 0)

本文档描述小程序 Phase 0 使用的后端聚合接口。

## 1) GET /api/mp/home

### 作用
小程序首页一次请求获取：轻量榜单 + 时间表摘要 + 市场快照。

### 成功返回示例
```json
{
  "success": true,
  "updatedAt": "2026-03-28T12:00:00.000Z",
  "degraded": {
    "topList": false,
    "market": false
  },
  "topList": [
    {
      "code": "09660",
      "name": "示例公司",
      "score": 78,
      "rating": "建议申购",
      "listingDate": "2026-04-10"
    }
  ],
  "timelineSummary": {
    "subscribing": [],
    "listingSoon": [],
    "recentListed": []
  },
  "market": {
    "avgReturn": "+12.5%",
    "breakRate": "30%",
    "heatIndex": 78
  }
}
```

### 降级字段说明
- `degraded.topList = true`：榜单获取超时或失败，接口仍返回时间表与市场数据。
- `degraded.market = true`：市场统计不可用，`market` 字段将返回 `null` 值。

---

## 2) GET /api/mp/score/:code

### 作用
小程序评分详情页统一结构接口。

### 成功返回示例
```json
{
  "success": true,
  "code": "09660",
  "name": "示例公司",
  "totalScore": 78,
  "rating": "建议申购",
  "elapsed": 26,
  "dimensions": [
    {
      "key": "sponsor",
      "label": "保荐人业绩",
      "score": 2,
      "reason": "保荐人历史表现优秀",
      "details": "历史案例涨幅较高"
    }
  ],
  "display": {
    "listingDate": "2026-04-10",
    "subscriptionMultiple": 12.3,
    "hasGreenShoe": true
  },
  "error": null
}
```

### 失败返回示例
```json
{
  "success": false,
  "code": "09660",
  "name": "",
  "totalScore": 0,
  "rating": "",
  "elapsed": 14,
  "dimensions": [],
  "display": {},
  "error": "prospectus not found"
}
```

### 说明
- `dimensions` 为小程序前端直接渲染的维度列表，不需要再处理复杂对象。
- `error` 始终存在：成功时为 `null`，失败时为字符串。
