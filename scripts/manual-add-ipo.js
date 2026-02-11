/**
 * 手动添加IPO到列表
 * 使用方式：node scripts/manual-add-ipo.js 09988 "阿里巴巴-SW" 科技 subscribing 2026-02-10 2026-02-15 2026-02-18
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const IPO_LIST_JSON = path.join(DATA_DIR, 'ipo-list.json');

// 确保目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function addIPO(code, name, industry, status, subStart, subEnd, listDate) {
  // 读取现有数据
  let data = { updateTime: new Date().toISOString(), count: 0, source: 'manual', ipos: [] };

  if (fs.existsSync(IPO_LIST_JSON)) {
    data = JSON.parse(fs.readFileSync(IPO_LIST_JSON, 'utf-8'));
  }

  // 检查是否已存在
  const exists = data.ipos.find(ipo => ipo.code === code);
  if (exists) {
    console.log(`⚠️  股票 ${code} 已存在，更新信息`);
    exists.name = name;
    exists.industry = industry;
    exists.status = status;
    exists.subscriptionStart = subStart;
    exists.subscriptionEnd = subEnd;
    exists.listingDate = listDate;
    exists.lastUpdate = new Date().toISOString();
  } else {
    // 添加新IPO
    data.ipos.push({
      code: code,
      name: name,
      industry: industry,
      status: status,
      subscriptionStart: subStart,
      subscriptionEnd: subEnd,
      listingDate: listDate,
      offerPrice: null,
      currency: 'HKD',
      score: null,
      rating: null,
      lastUpdate: new Date().toISOString()
    });
    console.log(`✅ 已添加 ${code} ${name}`);
  }

  // 更新计数和时间
  data.count = data.ipos.length;
  data.updateTime = new Date().toISOString();

  // 保存
  fs.writeFileSync(IPO_LIST_JSON, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`\n✅ 已保存到 ${IPO_LIST_JSON}`);
  console.log(`📊 当前共 ${data.count} 个IPO\n`);
}

// 命令行参数解析
const args = process.argv.slice(2);

if (args.length < 3) {
  console.log(`
使用方法：
  node scripts/manual-add-ipo.js <代码> <名称> <行业> [状态] [招股开始] [招股结束] [上市日期]

示例：
  node scripts/manual-add-ipo.js 09988 "阿里巴巴-SW" 科技 subscribing 2026-02-10 2026-02-15 2026-02-18

参数说明：
  代码     - 5位港股代码（如 09988）
  名称     - 公司名称
  行业     - 行业分类（科技/医疗/金融/消费等）
  状态     - subscribing(招股中) / coming(即将) / listed(已上市)，默认 subscribing
  招股开始 - 格式 YYYY-MM-DD，可选
  招股结束 - 格式 YYYY-MM-DD，可选
  上市日期 - 格式 YYYY-MM-DD，可选

快速添加（最少3个参数）：
  node scripts/manual-add-ipo.js 09988 阿里巴巴 科技
`);
  process.exit(1);
}

const [code, name, industry, status = 'subscribing', subStart = null, subEnd = null, listDate = null] = args;

addIPO(code, name, industry, status, subStart, subEnd, listDate);
