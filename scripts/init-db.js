/**
 * 数据库初始化脚本
 * 创建SQLite数据库和表结构
 * 
 * 运行: node scripts/init-db.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'ipo.db');

// 确保data目录存在
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

console.log('🗄️  初始化数据库...');
console.log(`   路径: ${DB_PATH}`);

const db = new Database(DB_PATH);

// 启用外键约束
db.pragma('foreign_keys = ON');

// 创建表
db.exec(`
  -- IPO记录表：存储每个IPO的详细信息
  CREATE TABLE IF NOT EXISTS ipo_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_code TEXT NOT NULL,           -- 股票代码 (如 02768)
    stock_name TEXT,                    -- 股票名称
    listing_date TEXT NOT NULL,         -- 上市日期 (YYYY-MM-DD)
    issue_price REAL,                   -- 发行价
    first_day_open REAL,                -- 首日开盘价
    first_day_close REAL,               -- 首日收盘价
    first_day_high REAL,                -- 首日最高价
    first_day_low REAL,                 -- 首日最低价
    first_day_return REAL,              -- 首日涨幅 (%)
    cumulative_return REAL,             -- 累计涨幅 (%)
    industry TEXT,                      -- 行业分类
    board TEXT DEFAULT 'Main',          -- 板块 (Main/GEM)
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(stock_code)
  );

  -- IPO保荐人关联表：一个IPO可能有多个保荐人
  CREATE TABLE IF NOT EXISTS ipo_sponsors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ipo_id INTEGER NOT NULL,
    sponsor_name TEXT NOT NULL,
    is_lead BOOLEAN DEFAULT 0,          -- 是否主保荐人
    FOREIGN KEY (ipo_id) REFERENCES ipo_records(id) ON DELETE CASCADE,
    UNIQUE(ipo_id, sponsor_name)
  );

  -- 保荐人统计表：汇总每个保荐人的历史表现
  CREATE TABLE IF NOT EXISTS sponsor_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sponsor_name TEXT NOT NULL UNIQUE,  -- 保荐人名称
    total_count INTEGER DEFAULT 0,      -- 总保荐数量
    up_count INTEGER DEFAULT 0,         -- 首日上涨数量
    down_count INTEGER DEFAULT 0,       -- 首日下跌数量
    flat_count INTEGER DEFAULT 0,       -- 首日平盘数量
    avg_first_day_return REAL,          -- 平均首日涨幅 (%)
    avg_cumulative_return REAL,         -- 平均累计涨幅 (%)
    win_rate REAL,                      -- 胜率 (%)
    data_source TEXT,                   -- 数据来源
    last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- 保荐人别名表：处理同一保荐人的不同写法
  CREATE TABLE IF NOT EXISTS sponsor_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alias_name TEXT NOT NULL UNIQUE,    -- 别名
    canonical_name TEXT NOT NULL        -- 标准名称
  );

  -- 创建索引
  CREATE INDEX IF NOT EXISTS idx_ipo_listing_date ON ipo_records(listing_date);
  CREATE INDEX IF NOT EXISTS idx_ipo_stock_code ON ipo_records(stock_code);
  CREATE INDEX IF NOT EXISTS idx_sponsor_name ON sponsor_stats(sponsor_name);
  CREATE INDEX IF NOT EXISTS idx_ipo_sponsors_sponsor ON ipo_sponsors(sponsor_name);
`);

console.log('✅ 数据库表创建完成');

// 插入常见保荐人别名
const aliases = [
  // 中金
  ['中金公司', '中國國際金融香港證券有限公司'],
  ['中金', '中國國際金融香港證券有限公司'],
  ['CICC', '中國國際金融香港證券有限公司'],
  ['中國國際金融', '中國國際金融香港證券有限公司'],
  ['中国国际金融香港证券有限公司', '中國國際金融香港證券有限公司'],
  
  // 中信
  ['中信証券', '中信證券(香港)有限公司'],
  ['中信证券', '中信證券(香港)有限公司'],
  ['中信證券', '中信證券(香港)有限公司'],
  
  // 华泰
  ['华泰', '華泰金融控股(香港)有限公司'],
  ['華泰', '華泰金融控股(香港)有限公司'],
  ['华泰金融', '華泰金融控股(香港)有限公司'],
  ['华泰联合', '華泰金融控股(香港)有限公司'],
  
  // 高盛
  ['高盛', '高盛(亞洲)有限責任公司'],
  ['Goldman Sachs', '高盛(亞洲)有限責任公司'],
  
  // 摩根士丹利
  ['摩根士丹利', '摩根士丹利亞洲有限公司'],
  ['Morgan Stanley', '摩根士丹利亞洲有限公司'],
  ['大摩', '摩根士丹利亞洲有限公司'],
  
  // 海通
  ['海通国际', '海通國際資本有限公司'],
  ['海通國際', '海通國際資本有限公司'],
  
  // 瑞银
  ['瑞银', '瑞銀證券香港有限公司'],
  ['瑞銀', '瑞銀證券香港有限公司'],
  ['UBS', '瑞銀證券香港有限公司'],
  
  // 建银
  ['建银国际', '建銀國際金融有限公司'],
  ['建銀國際', '建銀國際金融有限公司'],
  
  // 国泰君安
  ['国泰君安', '國泰君安融資有限公司'],
  ['國泰君安', '國泰君安融資有限公司'],
  
  // 招银
  ['招银国际', '招銀國際融資有限公司'],
  ['招銀國際', '招銀國際融資有限公司'],
];

const insertAlias = db.prepare(`
  INSERT OR IGNORE INTO sponsor_aliases (alias_name, canonical_name) VALUES (?, ?)
`);

for (const [alias, canonical] of aliases) {
  insertAlias.run(alias, canonical);
}

console.log(`✅ 已插入 ${aliases.length} 个保荐人别名`);

// 显示数据库信息
const tables = db.prepare(`
  SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
`).all();

console.log('\n📋 数据库表:');
tables.forEach(t => console.log(`   - ${t.name}`));

db.close();
console.log('\n🎉 数据库初始化完成！');
