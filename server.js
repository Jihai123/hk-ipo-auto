const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const pdfParse = require('pdf-parse');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============================================
// 保荐人历史业绩数据库（首日涨跌幅统计）
// ============================================
const SPONSOR_DATABASE = {
  // 顶级保荐人 (平均首日涨幅 >= 70%)
  '高盛': { avgReturn: 85, count: 45, tier: 'top' },
  'Goldman Sachs': { avgReturn: 85, count: 45, tier: 'top' },
  '摩根士丹利': { avgReturn: 78, count: 52, tier: 'top' },
  'Morgan Stanley': { avgReturn: 78, count: 52, tier: 'top' },
  '摩根士丹利亞洲': { avgReturn: 76, count: 45, tier: 'top' },
  '中金': { avgReturn: 72, count: 68, tier: 'top' },
  '中金公司': { avgReturn: 72, count: 68, tier: 'top' },
  'CICC': { avgReturn: 72, count: 68, tier: 'top' },
  '中國國際金融': { avgReturn: 72, count: 68, tier: 'top' },
  '華泰金融控股': { avgReturn: 75, count: 35, tier: 'top' },
  '華泰': { avgReturn: 75, count: 35, tier: 'top' },
  '华泰': { avgReturn: 75, count: 35, tier: 'top' },
  
  // 中等保荐人 (40% <= 平均首日涨幅 < 70%)
  '中信里昂': { avgReturn: 55, count: 42, tier: 'mid' },
  '中信証券': { avgReturn: 58, count: 38, tier: 'mid' },
  '中信证券': { avgReturn: 58, count: 38, tier: 'mid' },
  '海通國際': { avgReturn: 48, count: 55, tier: 'mid' },
  '海通国际': { avgReturn: 48, count: 55, tier: 'mid' },
  '招銀國際': { avgReturn: 52, count: 48, tier: 'mid' },
  '招银国际': { avgReturn: 52, count: 48, tier: 'mid' },
  'UBS': { avgReturn: 62, count: 28, tier: 'mid' },
  'UBS Securities': { avgReturn: 62, count: 28, tier: 'mid' },
  '瑞銀': { avgReturn: 62, count: 28, tier: 'mid' },
  '瑞银': { avgReturn: 62, count: 28, tier: 'mid' },
  '摩根大通': { avgReturn: 65, count: 32, tier: 'mid' },
  'JP Morgan': { avgReturn: 65, count: 32, tier: 'mid' },
  'J.P. Morgan': { avgReturn: 65, count: 32, tier: 'mid' },
  '建銀國際': { avgReturn: 45, count: 42, tier: 'mid' },
  '建银国际': { avgReturn: 45, count: 42, tier: 'mid' },
  '交銀國際': { avgReturn: 47, count: 38, tier: 'mid' },
  '交银国际': { avgReturn: 47, count: 38, tier: 'mid' },
  '農銀國際': { avgReturn: 44, count: 35, tier: 'mid' },
  '农银国际': { avgReturn: 44, count: 35, tier: 'mid' },
  '工銀國際': { avgReturn: 46, count: 40, tier: 'mid' },
  '工银国际': { avgReturn: 46, count: 40, tier: 'mid' },
  '國泰君安': { avgReturn: 50, count: 45, tier: 'mid' },
  '国泰君安': { avgReturn: 50, count: 45, tier: 'mid' },
  '申萬宏源': { avgReturn: 48, count: 36, tier: 'mid' },
  '申万宏源': { avgReturn: 48, count: 36, tier: 'mid' },
  '光大證券': { avgReturn: 45, count: 32, tier: 'mid' },
  '光大证券': { avgReturn: 45, count: 32, tier: 'mid' },
  '法國巴黎銀行': { avgReturn: 55, count: 25, tier: 'mid' },
  'BNP': { avgReturn: 55, count: 25, tier: 'mid' },
  '德意志銀行': { avgReturn: 52, count: 22, tier: 'mid' },
  'Deutsche Bank': { avgReturn: 52, count: 22, tier: 'mid' },
  '花旗': { avgReturn: 58, count: 30, tier: 'mid' },
  'Citi': { avgReturn: 58, count: 30, tier: 'mid' },
  'Citigroup': { avgReturn: 58, count: 30, tier: 'mid' },
  '滙豐': { avgReturn: 50, count: 35, tier: 'mid' },
  '汇丰': { avgReturn: 50, count: 35, tier: 'mid' },
  'HSBC': { avgReturn: 50, count: 35, tier: 'mid' },
  '星展': { avgReturn: 48, count: 28, tier: 'mid' },
  'DBS': { avgReturn: 48, count: 28, tier: 'mid' },
  '瑞信': { avgReturn: 55, count: 30, tier: 'mid' },
  'Credit Suisse': { avgReturn: 55, count: 30, tier: 'mid' },
  '美銀': { avgReturn: 60, count: 25, tier: 'mid' },
  '美银': { avgReturn: 60, count: 25, tier: 'mid' },
  'Bank of America': { avgReturn: 60, count: 25, tier: 'mid' },
  'Merrill Lynch': { avgReturn: 60, count: 25, tier: 'mid' },
  
  // 一般保荐人 (平均首日涨幅 < 40%)
  '民銀資本': { avgReturn: 32, count: 25, tier: 'low' },
  '民银资本': { avgReturn: 32, count: 25, tier: 'low' },
  '華盛資本': { avgReturn: 28, count: 18, tier: 'low' },
  '华盛资本': { avgReturn: 28, count: 18, tier: 'low' },
  '信達國際': { avgReturn: 35, count: 22, tier: 'low' },
  '信达国际': { avgReturn: 35, count: 22, tier: 'low' },
  '東興證券': { avgReturn: 30, count: 15, tier: 'low' },
  '东兴证券': { avgReturn: 30, count: 15, tier: 'low' },
  '英皇證券': { avgReturn: 25, count: 20, tier: 'low' },
  '英皇证券': { avgReturn: 25, count: 20, tier: 'low' },
  '宏高證券': { avgReturn: 22, count: 12, tier: 'low' },
  '豐盛融資': { avgReturn: 28, count: 16, tier: 'low' },
  '丰盛融资': { avgReturn: 28, count: 16, tier: 'low' },
  '安信國際': { avgReturn: 33, count: 18, tier: 'low' },
  '安信国际': { avgReturn: 33, count: 18, tier: 'low' },
  '國信證券': { avgReturn: 35, count: 20, tier: 'low' },
  '国信证券': { avgReturn: 35, count: 20, tier: 'low' },
  '永泰金融': { avgReturn: 30, count: 15, tier: 'low' },
  '力高企業融資': { avgReturn: 25, count: 12, tier: 'low' },
  '君陽金融': { avgReturn: 28, count: 10, tier: 'low' },
};

// ============================================
// 明星基石投资者名单
// ============================================
const STAR_CORNERSTONE_INVESTORS = [
  // 高瓴系
  '高瓴', 'Gaoling', 'Hillhouse', 'YHG Investment',
  // 新加坡政府
  '新加坡政府投資', 'GIC', 'Government of Singapore',
  // 中国国资
  '中國國有企業結構調整基金', '国调基金', '結構調整基金', 'Structural Reform',
  '中國互聯網投資基金', '互联网投资基金',
  '中國保險投資基金', '保险投资基金',
  // 橡树资本
  '橡樹資本', '橡树资本', 'Oaktree', 'OAKTREE',
  // 淡马锡
  '淡馬錫', '淡马锡', 'Temasek',
  // 红杉
  '紅杉', '红杉', 'Sequoia',
  // 黑石
  '黑石', 'Blackstone',
  // 贝莱德
  '貝萊德', '贝莱德', 'BlackRock',
  // 富达
  '富達', '富达', 'Fidelity',
  // 资本集团
  '資本集團', 'Capital Group',
  // 春华资本
  '春華資本', '春华资本', 'Primavera',
  // IDG
  'IDG',
  // 科技巨头
  '騰訊', '腾讯', 'Tencent',
  '阿里巴巴', 'Alibaba',
  '京東', '京东', 'JD.com',
  '小米', 'Xiaomi',
  '美團', '美团', 'Meituan',
  '字節跳動', '字节跳动', 'ByteDance',
  // 其他知名
  '中投', 'CIC', 'China Investment',
  '社保基金', 'Social Security Fund',
  '中國人壽', '中国人寿', 'China Life',
  '平安', 'Ping An',
];

// ============================================
// 行业分类关键词
// ============================================
const INDUSTRY_POSITIVE = [
  '物業管理', '物业管理', '物管',
  '軟件', '软件', 'SaaS', '雲計算', '云计算',
  '人工智能', 'AI', '人工智慧',
  '醫藥', '医药', '醫療', '医疗', '醫療設備', '医疗设备',
  '生物科技', '生物技術', '生物技术',
  '新能源', '光伏', '鋰電', '锂电',
  '半導體', '半导体', '芯片', '晶片',
  '互聯網', '互联网',
];

const INDUSTRY_NEGATIVE = [
  '紡織', '纺织',
  '服裝', '服装',
  '奢侈品',
  '綜合金融服務', '综合金融服务',
  '證券', '证券',
  '房地產', '房地产', '地產', '地产',
  '煤炭',
  '鋼鐵', '钢铁',
  '傳統製造', '传统制造',
];

// ============================================
// 工具函数
// ============================================

// 格式化股票代码为5位
function formatStockCode(code) {
  const num = code.replace(/\D/g, '');
  return num.padStart(5, '0');
}

// 从港交所搜索招股书
async function searchProspectus(stockCode) {
  const formattedCode = formatStockCode(stockCode);
  
  console.log(`[搜索] 正在搜索股票 ${formattedCode} 的招股书...`);
  
  try {
    // 港交所披露易搜索API
    const searchUrl = 'https://www1.hkexnews.hk/search/titlesearch.xhtml';
    
    const formData = new URLSearchParams();
    formData.append('lang', 'ZH');
    formData.append('category', '0'); // 所有类别
    formData.append('market', 'SEHK');
    formData.append('searchType', '0');
    formData.append('t1code', '40000'); // 上市文件
    formData.append('t2Gcode', '-2');
    formData.append('t2code', '-2');
    formData.append('stockId', formattedCode);
    formData.append('from', '');
    formData.append('to', '');
    formData.append('title', '');
    formData.append('sortDir', '0');
    formData.append('sortByOptions', 'DateTime');
    formData.append('rowRange', '100');
    
    const response = await axios.post(searchUrl, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout: 30000,
    });
    
    const $ = cheerio.load(response.data);
    const results = [];
    
    // 解析搜索结果表格
    $('table.table tbody tr').each((i, row) => {
      const $row = $(row);
      const title = $row.find('td').eq(0).text().trim();
      const link = $row.find('td').eq(0).find('a').attr('href');
      const date = $row.find('td').eq(1).text().trim();
      
      // 寻找招股章程/招股书
      if (title && (
        title.includes('招股章程') || 
        title.includes('招股書') ||
        title.includes('招股书') ||
        title.includes('Prospectus') ||
        title.includes('配發結果') ||
        title.includes('配发结果')
      )) {
        results.push({
          title,
          link: link ? `https://www1.hkexnews.hk${link}` : null,
          date,
        });
      }
    });
    
    console.log(`[搜索] 找到 ${results.length} 个相关文件`);
    return results;
    
  } catch (error) {
    console.error('[搜索] 搜索失败:', error.message);
    throw new Error(`搜索招股书失败: ${error.message}`);
  }
}

// 下载并解析PDF
async function downloadAndParsePDF(pdfUrl) {
  console.log(`[下载] 正在下载PDF: ${pdfUrl}`);
  
  try {
    const response = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    console.log(`[下载] PDF下载完成，大小: ${(response.data.byteLength / 1024 / 1024).toFixed(2)} MB`);
    
    // 解析PDF
    const data = await pdfParse(response.data, {
      max: 150, // 只解析前150页
    });
    
    console.log(`[解析] PDF解析完成，提取文本长度: ${data.text.length}`);
    return data.text;
    
  } catch (error) {
    console.error('[下载] PDF下载/解析失败:', error.message);
    throw new Error(`PDF处理失败: ${error.message}`);
  }
}

// ============================================
// 评分函数
// ============================================

// 1. 检查是否有旧股
function checkOldShares(text) {
  console.log('[评分] 检查是否有旧股...');
  
  const result = {
    hasOldShares: false,
    score: 0,
    detail: '',
    evidence: '',
  };
  
  // 查找"全球發售的發售股份數目"相关内容
  const patterns = [
    /全球發售的發售股份數目[\s\S]{0,200}/gi,
    /全球发售的发售股份数目[\s\S]{0,200}/gi,
    /發售股份總數[\s\S]{0,200}/gi,
    /发售股份总数[\s\S]{0,200}/gi,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      result.evidence = match[0].substring(0, 150);
      
      // 检查是否包含"及"、"以及"、"和"连接词，表示有新股+旧股
      if (match[0].match(/新股[\s\S]{0,30}(及|以及|和|與|与)[\s\S]{0,30}舊股/i) ||
          match[0].match(/舊股|旧股|出售股份/i)) {
        result.hasOldShares = true;
        result.score = -2;
        result.detail = '发现有旧股出售';
        break;
      }
    }
  }
  
  if (!result.hasOldShares) {
    result.detail = '全部为新股发行';
  }
  
  console.log(`[评分] 旧股检查完成: ${result.detail}, 得分: ${result.score}`);
  return result;
}

// 2. 识别保荐人并评分
function scoreSponsor(text) {
  console.log('[评分] 识别保荐人...');
  
  const result = {
    sponsors: [],
    bestSponsor: null,
    avgReturn: 0,
    count: 0,
    tier: 'unknown',
    score: 0,
    detail: '',
  };
  
  // 提取保荐人相关段落
  const sponsorPatterns = [
    /參與全球發售的各方[\s\S]{0,2000}/gi,
    /独家保薦人[\s\S]{0,500}/gi,
    /聯席保薦人[\s\S]{0,500}/gi,
    /保薦人[：:\s][\s\S]{0,500}/gi,
  ];
  
  let sponsorSection = '';
  for (const pattern of sponsorPatterns) {
    const match = text.match(pattern);
    if (match) {
      sponsorSection += match.join(' ');
    }
  }
  
  // 在全文中搜索保荐人名称
  const foundSponsors = new Map();
  
  for (const [name, data] of Object.entries(SPONSOR_DATABASE)) {
    if (text.includes(name) || sponsorSection.includes(name)) {
      // 避免重复（同一保荐人可能有多个名称）
      const key = `${data.avgReturn}-${data.count}`;
      if (!foundSponsors.has(key) || name.length > foundSponsors.get(key).name.length) {
        foundSponsors.set(key, { name, ...data });
      }
    }
  }
  
  result.sponsors = Array.from(foundSponsors.values());
  
  if (result.sponsors.length > 0) {
    // 找最佳保荐人
    result.bestSponsor = result.sponsors.reduce((best, s) => 
      !best || s.avgReturn > best.avgReturn ? s : best, null);
    
    result.avgReturn = result.bestSponsor.avgReturn;
    result.count = result.bestSponsor.count;
    result.tier = result.bestSponsor.tier;
    
    // 评分
    if (result.count < 8) {
      result.score = 0;
      result.detail = `保荐人${result.bestSponsor.name}历史保荐少于8只，维持0分`;
    } else if (result.avgReturn >= 70) {
      result.score = 2;
      result.detail = `保荐人${result.bestSponsor.name}首日平均涨幅${result.avgReturn}% ≥70%`;
    } else if (result.avgReturn >= 40) {
      result.score = 0;
      result.detail = `保荐人${result.bestSponsor.name}首日平均涨幅${result.avgReturn}%，40%-70%区间`;
    } else {
      result.score = -2;
      result.detail = `保荐人${result.bestSponsor.name}首日平均涨幅${result.avgReturn}% <40%`;
    }
  } else {
    result.detail = '未能识别保荐人';
  }
  
  console.log(`[评分] 保荐人评分完成: ${result.detail}, 得分: ${result.score}`);
  return result;
}

// 3. 识别基石投资者
function scoreCornerstone(text) {
  console.log('[评分] 识别基石投资者...');
  
  const result = {
    cornerstones: [],
    hasStarInvestor: false,
    score: 0,
    detail: '',
  };
  
  // 搜索基石投资者
  const foundInvestors = [];
  
  for (const investor of STAR_CORNERSTONE_INVESTORS) {
    if (text.includes(investor)) {
      foundInvestors.push(investor);
    }
  }
  
  // 去重（同一投资者可能有多个名称）
  result.cornerstones = [...new Set(foundInvestors)];
  
  if (result.cornerstones.length > 0) {
    result.hasStarInvestor = true;
    result.score = 2;
    result.detail = `发现明星基石投资者: ${result.cornerstones.slice(0, 3).join(', ')}${result.cornerstones.length > 3 ? '等' : ''}`;
  } else {
    // 检查是否有基石投资者章节但无明星
    if (text.match(/基石投資者|基石投资者|Cornerstone/i)) {
      result.detail = '有基石投资者但非明星机构';
    } else {
      result.detail = '未发现基石投资者';
    }
  }
  
  console.log(`[评分] 基石投资者评分完成: ${result.detail}, 得分: ${result.score}`);
  return result;
}

// 4. 检查IPO前投资者禁售期
function scorePreIPO(text) {
  console.log('[评分] 检查IPO前投资者...');
  
  const result = {
    hasPreIPO: false,
    hasLockup: true,
    score: 0,
    detail: '',
  };
  
  // 检查是否有IPO前投资者
  const preIpoPatterns = [
    /首次公開發售前投資者/i,
    /首次公开发售前投资者/i,
    /Pre-IPO\s*Investor/i,
    /上市前投資者/i,
  ];
  
  for (const pattern of preIpoPatterns) {
    if (pattern.test(text)) {
      result.hasPreIPO = true;
      break;
    }
  }
  
  if (result.hasPreIPO) {
    // 检查是否有禁售期
    const lockupPatterns = [
      /禁售期/i,
      /鎖定期/i,
      /锁定期/i,
      /lock-?up/i,
      /不會出售/i,
      /不会出售/i,
      /承諾.*?個月/i,
      /承诺.*?个月/i,
    ];
    
    let hasLockupMention = false;
    for (const pattern of lockupPatterns) {
      if (pattern.test(text)) {
        hasLockupMention = true;
        break;
      }
    }
    
    // 检查是否明确说无禁售
    const noLockupPatterns = [
      /無禁售期/i,
      /无禁售期/i,
      /沒有禁售/i,
      /没有禁售/i,
      /不受.*?禁售/i,
    ];
    
    let noLockup = false;
    for (const pattern of noLockupPatterns) {
      if (pattern.test(text)) {
        noLockup = true;
        break;
      }
    }
    
    if (noLockup) {
      result.hasLockup = false;
      result.score = -2;
      result.detail = 'IPO前投资者无禁售期约束';
    } else if (hasLockupMention) {
      result.hasLockup = true;
      result.score = 0;
      result.detail = 'IPO前投资者有禁售期';
    } else {
      result.detail = '有IPO前投资者，禁售期情况不明';
    }
  } else {
    result.detail = '无IPO前投资者或未披露';
  }
  
  console.log(`[评分] IPO前投资者评分完成: ${result.detail}, 得分: ${result.score}`);
  return result;
}

// 5. 识别行业
function scoreIndustry(text) {
  console.log('[评分] 识别行业...');
  
  const result = {
    industry: '',
    type: 'neutral',
    score: 0,
    detail: '',
  };
  
  // 提取行业概览章节
  const industrySection = text.match(/行業概覽[\s\S]{0,3000}/i) || 
                          text.match(/行业概览[\s\S]{0,3000}/i) ||
                          text.match(/業務概覽[\s\S]{0,3000}/i) ||
                          [''];
  
  const searchText = industrySection[0] + text.substring(0, 10000);
  
  // 检查正面行业
  for (const keyword of INDUSTRY_POSITIVE) {
    if (searchText.includes(keyword)) {
      result.industry = keyword;
      result.type = 'positive';
      result.score = 2;
      result.detail = `行业: ${keyword} (物业管理/软件服务/医药医疗)`;
      console.log(`[评分] 行业评分完成: ${result.detail}, 得分: ${result.score}`);
      return result;
    }
  }
  
  // 检查负面行业
  for (const keyword of INDUSTRY_NEGATIVE) {
    if (searchText.includes(keyword)) {
      result.industry = keyword;
      result.type = 'negative';
      result.score = -2;
      result.detail = `行业: ${keyword} (纺织品/服装/金融服务等)`;
      console.log(`[评分] 行业评分完成: ${result.detail}, 得分: ${result.score}`);
      return result;
    }
  }
  
  result.detail = '其他行业';
  console.log(`[评分] 行业评分完成: ${result.detail}, 得分: ${result.score}`);
  return result;
}

// 6. 估值评分（简化版，需要用户输入）
function scoreValuation(peRatio, industryPeRatio) {
  const result = {
    peRatio: peRatio || null,
    industryPeRatio: industryPeRatio || null,
    score: 0,
    detail: '',
  };
  
  if (!peRatio || !industryPeRatio) {
    result.detail = '估值数据不足，暂不评分';
    return result;
  }
  
  const ratio = peRatio / industryPeRatio;
  
  if (ratio < 0.8) {
    result.score = 2;
    result.detail = `市盈率${peRatio}低于同行${industryPeRatio}`;
  } else if (ratio > 1.2) {
    result.score = -2;
    result.detail = `市盈率${peRatio}高于同行${industryPeRatio}`;
  } else {
    result.detail = `市盈率${peRatio}接近同行${industryPeRatio}`;
  }
  
  return result;
}

// ============================================
// API 路由
// ============================================

// 主评分接口
app.get('/api/score/:code', async (req, res) => {
  const stockCode = req.params.code;
  const { peRatio, industryPeRatio } = req.query;
  
  console.log(`\n========================================`);
  console.log(`[API] 开始评分: ${stockCode}`);
  console.log(`========================================\n`);
  
  try {
    // 1. 搜索招股书
    const searchResults = await searchProspectus(stockCode);
    
    if (searchResults.length === 0) {
      return res.json({
        success: false,
        error: '未找到招股书，请确认股票代码正确且已提交上市申请',
        stockCode: formatStockCode(stockCode),
      });
    }
    
    // 找到招股章程PDF
    let prospectusUrl = null;
    for (const result of searchResults) {
      if (result.link && (result.title.includes('招股章程') || result.title.includes('Prospectus'))) {
        prospectusUrl = result.link;
        break;
      }
    }
    
    if (!prospectusUrl && searchResults[0].link) {
      prospectusUrl = searchResults[0].link;
    }
    
    if (!prospectusUrl) {
      return res.json({
        success: false,
        error: '未找到可下载的招股书PDF',
        searchResults,
      });
    }
    
    // 2. 下载并解析PDF
    const pdfText = await downloadAndParsePDF(prospectusUrl);
    
    // 3. 各项评分
    const oldSharesResult = checkOldShares(pdfText);
    const sponsorResult = scoreSponsor(pdfText);
    const cornerstoneResult = scoreCornerstone(pdfText);
    const preIpoResult = scorePreIPO(pdfText);
    const industryResult = scoreIndustry(pdfText);
    const valuationResult = scoreValuation(
      peRatio ? parseFloat(peRatio) : null,
      industryPeRatio ? parseFloat(industryPeRatio) : null
    );
    
    // 4. 计算总分
    const totalScore = 
      oldSharesResult.score +
      sponsorResult.score +
      cornerstoneResult.score +
      preIpoResult.score +
      industryResult.score +
      valuationResult.score;
    
    // 5. 评级
    let rating = '';
    if (totalScore >= 6) rating = '强烈推荐申购';
    else if (totalScore >= 4) rating = '建议申购';
    else if (totalScore >= 2) rating = '可考虑申购';
    else if (totalScore >= 0) rating = '谨慎申购';
    else if (totalScore >= -2) rating = '不建议申购';
    else rating = '强烈不建议申购';
    
    console.log(`\n[完成] 总得分: ${totalScore}, 评级: ${rating}\n`);
    
    res.json({
      success: true,
      stockCode: formatStockCode(stockCode),
      prospectusUrl,
      totalScore,
      rating,
      scores: {
        oldShares: oldSharesResult,
        sponsor: sponsorResult,
        cornerstone: cornerstoneResult,
        preIPO: preIpoResult,
        industry: industryResult,
        valuation: valuationResult,
      },
      searchResults,
    });
    
  } catch (error) {
    console.error('[API] 评分失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stockCode: formatStockCode(stockCode),
    });
  }
});

// 仅搜索招股书（不下载解析）
app.get('/api/search/:code', async (req, res) => {
  const stockCode = req.params.code;
  
  try {
    const results = await searchProspectus(stockCode);
    res.json({
      success: true,
      stockCode: formatStockCode(stockCode),
      results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 获取保荐人数据库
app.get('/api/sponsors', (req, res) => {
  const sponsors = {};
  for (const [name, data] of Object.entries(SPONSOR_DATABASE)) {
    // 只返回主要名称（中文优先）
    if (name.match(/[\u4e00-\u9fa5]/)) {
      sponsors[name] = data;
    }
  }
  res.json(sponsors);
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 港股新股打分服务已启动`);
  console.log(`📍 访问地址: http://localhost:${PORT}`);
  console.log(`📚 API文档:`);
  console.log(`   GET /api/score/:code - 完整评分`);
  console.log(`   GET /api/search/:code - 搜索招股书`);
  console.log(`   GET /api/sponsors - 保荐人数据库\n`);
});
