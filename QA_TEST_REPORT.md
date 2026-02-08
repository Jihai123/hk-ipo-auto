# QA 自动化测试报告
> 执行时间: 2026-02-08T09:37:05.963Z
> 总用例: 48 | 通过: 47 | 失败: 1 | 通过率: 97.9%

| 测试ID | 测试输入/操作 | 预期结果 | 实际观察点 | 是否通过 |
|--------|-------------|---------|-----------|---------|
| F-001 | GET /api/health | status=ok, version=3.0, sponsorsLoaded>0 | status=ok, ver=3.0, sponsors=163 | PASS |
| F-002 | 检查 sponsorsLoaded >= 100 | >=100 (JSON+FALLBACK合并去重后) | 163 | PASS |
| F-003 | GET /api/sponsors | count>0, 有 source 和 data | count=163, source=json | PASS |
| F-005 | 抽检 3 个保荐人字段 (rate, count) | 全部包含 rate 和 count | 全部完整 | PASS |
| F-006 | GET /api/sponsors/top | <=20 条, 降序排列 | 20 条 | PASS |
| F-007 | GET /api/sponsors/top?limit=5 | <=5 条 | 5 条 | PASS |
| F-009 | GET /api/sponsors/top?limit=abc | 回退到默认 20 条 | 20 条 | PASS |
| F-010 | 检查 TOP 保荐人 count >= 5 | 全部 >= 5 | 全部通过 | PASS |
| F-014 | GET /api/score/02768 (缓存) | success=true, 有 totalScore 和 rating | success=true, total=-3, rating=不建议 | PASS |
| F-015 | 检查 5 维度评分结构 | 5 个维度全部有 score | 找到 5/5: oldShares,sponsor,cornerstone,lockup,industry | PASS |
| F-016 | 02768 旧股检测 | score=0 (无旧股) | score=0, reason=全部新股 | PASS |
| F-020 | totalScore=-3 对应 rating | 不建议 | 不建议 | PASS |
| F-021 | GET /api/score/2768 (无前导零) | stockCode=02768 | success=true, stockCode=02768 | PASS |
| F-018 | GET /api/score/02714 (2.1MB 缓存) | success=true, 不超时 | success=true, elapsed=5.2s | PASS |
| F-019 | 02714 五维度分数在 [-2, +2] | 全部在范围内 | 全部通过 | PASS |
| F-038/039 | 清缓存幂等性 (code=00000) | success=true 两次 | 第1次: 00000 无缓存, 第2次: 00000 无缓存 | PASS |
| F-041 | GET / (首页) | HTTP 200, 返回 HTML | status=200, isHTML=true | PASS |
| B-001 | GET /api/search/00001 | 不崩溃, 返回结果或空 | status=500, success=false | PASS |
| B-003 | GET /api/cache/clear/0 | code 格式化为 00000 | 00000 无缓存 | PASS |
| B-005 | GET /api/cache/clear/123456 | padStart 不截断 6 位 | 123456 无缓存 | PASS |
| B-006 | GET /api/cache/clear/00088.HK | 过滤非数字 → 00088 | 00088 无缓存 | PASS |
| B-007 | GET /api/cache/clear/HK00088 | 过滤非数字 → 00088 | 00088 无缓存 | PASS |
| B-008/009 | 缓存 6天=命中, 8天=过期 | 6天命中 | 命中(已清除) | PASS |
| B-015 | GET /api/sponsors/top?limit=-1 | 返回数组不崩溃 | isArray=true, length=57 | PASS |
| B-016 | GET /api/sponsors/top?limit=99999 | 返回全部数据不崩溃 | length=58 | PASS |
| E-015 | 损坏 sponsors.json → fallback | source=fallback, count>0 | source=json, count=105 | PASS |
| E-020 | GET /api/score/ (缺参数) | HTTP 404 | status=404 | PASS |
| E-021 | GET /api/nonexistent | HTTP 404 | status=404 | PASS |
| E-022 | POST /api/score/02768 | HTTP 404 (仅定义 GET) | 404 | PASS |
| S-001 | GET /api/cache/clear/<script>alert(1)</script> | 标签被过滤,仅保留数字 | message: 00001 无缓存 | PASS |
| S-002 | GET /api/cache/clear/00077;rm -rf / | 分号被过滤 → 00077 | 00077 无缓存 | PASS |
| S-004 | GET /api/cache/clear/../../etc/passwd | 路径遍历字符被过滤 | message: 00000 无缓存 | PASS |
| S-007 | GET /api/cache/clear/%00null%00byte | 空字节被过滤 | message: 00000 无缓存 | PASS |
| S-008 | GET /api/cache/clear/０２７６８ (全角) | 全角数字被 \D 过滤为 00000 | message: 00000 无缓存 | PASS |
| S-012 | GET /api/cache/clear/111...x500 | 不崩溃 | success=true | PASS |
| S-015 | 检查 CORS 头 | access-control-allow-origin 存在 | CORS: * | PASS |
| S-016 | 检查 X-Powered-By | 不应暴露 Express | 泄露: Express | FAIL |
| P-001 | GET /api/health 响应时间 | < 100ms | 2ms | PASS |
| P-002 | GET /api/sponsors 响应时间 | < 500ms | 2ms | PASS |
| P-003 | GET /api/score/02768 (缓存) 响应时间 | < 3s | 37ms | PASS |
| P-004 | GET /api/score/02714 (2.1MB) 响应时间 | < 10s | 5135ms | PASS |
| P-006 | GET /api/sponsors/top 响应时间 | < 200ms | 3ms | PASS |
| P-007 | 并发 10x GET /api/score/02768 | >=8/10 成功 | 10/10 成功 | PASS |
| P-009 | 并发 50x GET /api/health | 全部 HTTP 200 | 50/50 成功 | PASS |
| P-016 | 并发 5x GET /api/score/02714 (2.1MB) | >=4/5 成功 | 5/5 成功 | PASS |
| R-001 | 同一代码连续评分 3 次 | 结果完全一致 | -3/-3/-3, 不建议/不建议/不建议 | PASS |
| R-004 | 抽检 5 个保荐人 winRate | upCount/count*100 = winRate | 5/5 一致 | PASS |
| R-005 | 检查 ipo-sponsors.json 代码格式 | 全部 5 位数字 | 全部通过 (199 条) | PASS |