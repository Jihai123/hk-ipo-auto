# 港股新股自动评分系统 v2.0

## 新特性
- ✅ SQLite数据库存储保荐人历史数据
- ✅ 爬虫自动从AAStocks获取真实数据
- ✅ 数据可更新、可扩展

## 快速部署

### 1. 上传文件到服务器
将以下文件/文件夹上传到 `/www/wwwroot/zhibeimao.com/hk-ipo-auto/`:
- server.js
- package.json
- scripts/          (整个文件夹)
- public/           (整个文件夹)

### 2. 安装依赖
```bash
cd /www/wwwroot/zhibeimao.com/hk-ipo-auto/
npm install
```

### 3. 初始化数据库并爬取数据
```bash
# 方式1: 一键设置
npm run setup

# 方式2: 分步执行
npm run init-db    # 初始化数据库
npm run crawl      # 爬取保荐人数据
```

### 4. 启动服务
```bash
pm2 restart hk-ipo  # 或 pm2 start server.js --name "hk-ipo"
```

## 数据库说明

### 位置
`data/ipo.db` (SQLite数据库)

### 表结构
- `sponsor_stats` - 保荐人统计数据
- `ipo_records` - IPO历史记录
- `ipo_sponsors` - IPO与保荐人关联
- `sponsor_aliases` - 保荐人别名映射

### 更新数据
```bash
# 定期运行爬虫更新数据（建议每周一次）
npm run crawl

# 或设置定时任务
crontab -e
# 添加: 0 3 * * 1 cd /www/wwwroot/zhibeimao.com/hk-ipo-auto && npm run crawl
```

## API接口

| 接口 | 说明 |
|------|------|
| GET /api/health | 健康检查 |
| GET /api/score/:code | 评分（如 /api/score/02768）|
| GET /api/sponsors | 获取所有保荐人数据 |
| GET /api/sponsors/top | 获取TOP20保荐人 |
| GET /api/cache/clear/:code | 清除股票缓存 |

## 评分规则

| 项目 | 正分 | 零分 | 负分 |
|------|------|------|------|
| 旧股 | - | 无旧股(0) | 有旧股(-2) |
| 保荐人 | 涨幅≥70%(+2) | 40-70%(0) | <40%(-2) |
| 基石投资者 | 有明星基石(+2) | 其他(0) | - |
| Pre-IPO禁售 | - | 有禁售期/无Pre-IPO(0) | 无禁售期(-2) |
| 行业 | 医药/软件/物管(+2) | 其他(0) | 纺织/金融(-2) |

## 数据来源
- 保荐人数据：AAStocks (aastocks.com)
- 招股书：港交所披露易 (hkexnews.hk)

## 注意事项
1. better-sqlite3 需要编译，服务器需要安装 build-essential
2. 如果数据库不可用，系统会自动使用内置的后备数据
3. PDF缓存有效期7天，存储在 cache/ 目录
