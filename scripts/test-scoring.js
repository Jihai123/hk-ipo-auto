/**
 * IPO评分算法测试脚本
 * 用于验证重构后的评分逻辑是否正确
 *
 * 运行: node scripts/test-scoring.js
 */

const fs = require('fs');
const path = require('path');

// 复制server.js中的核心逻辑进行测试
const CACHE_DIR = path.join(__dirname, '..', 'cache');
const DATA_DIR = path.join(__dirname, '..', 'data');
const SPONSORS_JSON = path.join(DATA_DIR, 'sponsors.json');

// ==================== 从server.js复制的行业赛道定义 ====================

const HOT_TRACKS = [
  '人工智能','人工智慧','大模型','大語言模型','LLM','GPT','AIGC',
  '算力','算力租賃','智算中心','液冷','光模塊','光模块','CPO','HBM',
  '機器學習','机器学习','深度學習','深度学习','AI應用','AI应用','AI芯片','AI晶片',
  '機器人','机器人','人形機器人','人形机器人','具身智能','機器人關節','機器人減速器',
  '自動駕駛','自动驾驶','智能駕駛','智能驾驶','車聯網','车联网','Robotaxi',
  '半導體','半导体','芯片','晶片','GPU','ASIC','EDA','先進封裝','先进封装','國產替代','国产替代',
  '高速互連','高速互联','互連芯片','互联芯片','DDR5','PCIe','CXL','SerDes',
  '存儲芯片','存储芯片','內存芯片','内存芯片','NAND','DRAM','HDD','SSD',
  '模擬芯片','模拟芯片','射頻芯片','射频芯片','FPGA','MCU','SoC',
  '創新藥','创新药','ADC','CAR-T','mRNA','雙抗','双抗','PROTAC','RNAi',
  '低空經濟','低空经济','eVTOL','飛行汽車','无人机','UAV',
  '衛星互聯網','商业航天'
];

const GROWTH_TRACKS = [
  '醫療器械','医疗器械','醫療設備','医疗设备','診斷','诊断','CXO','CDMO',
  '新能源','儲能','储能','光伏','風電','风电','充電樁','充电桩',
  'SaaS','企業服務','企业服务','工業軟件','工业软件','網絡安全','网络安全',
  '數據中心','数据中心','雲計算','云计算',
  '新茶飲','新茶饮','咖啡連鎖','咖啡连锁','零食連鎖'
];

const LOW_ELASTICITY_TRACKS = [
  '食品','食品加工','飲料','饮料','调味品','乳制品','酒类','零食','糖果','烘焙',
  '餐飲','餐饮','快餐','團餐','团餐','預製菜','预制菜',
  '機械製造','工业设备','包装','印刷','造紙','造纸',
  '水务','燃气','电力','环保','污水處理','污水处理','垃圾處理',
  '建材','水泥','玻璃','钢铁','铝业','陶瓷',
  '物流','航运','港口','机场','货运','快遞','快递'
];

const AVOID_TRACKS = [
  '物業管理','物业管理','物管',
  '房地產','房地产','内房','地产开发','商业地产',
  '小额贷款','消费金融','融资租赁','P2P','网贷',
  '纺织','服装制造','制衣','鞋履制造',
  '教育培训','K12','学科培训','职业教育',
  '博彩','赌场',
  '殯葬','墓园'
];

const STAR_CORNERSTONE = [
  '高瓴','Hillhouse','红杉','Sequoia',
  '淡马锡','Temasek','GIC',
  'ADIA','阿布扎比','Mubadala','QIA','PIF',
  '黑石','Blackstone','贝莱德','BlackRock','Fidelity','Wellington','Capital Group',
  '中投公司','CIC','全国社保','社保基金',
  '国家大基金','丝路基金','国调基金','中国国新','中保投',
  'Tiger Global','Coatue','D1 Capital','Viking Global',
  '博裕资本','春华资本','厚朴投资','鼎晖','中信产业基金'
];

// ==================== 工具函数 ====================

function normalizeText(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, '')
    .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/證/g, '证').replace(/國/g, '国').replace(/際/g, '际')
    .replace(/銀/g, '银').replace(/資/g, '资').replace(/業/g, '业')
    .replace(/發/g, '发').replace(/項/g, '项').replace(/實/g, '实')
    .replace(/與/g, '与').replace(/為/g, '为').replace(/無/g, '无')
    .replace(/個/g, '个').replace(/開/g, '开').replace(/關/g, '关')
    .replace(/機/g, '机').replace(/車/g, '车').replace(/電/g, '电')
    .replace(/導/g, '导').replace(/體/g, '体').replace(/產/g, '产')
    .replace(/軟/g, '软').replace(/製/g, '制').replace(/廠/g, '厂')
    .replace(/有限公司$/g, '').replace(/有限责任公司$/g, '');
}

function extractSection(text, startPatterns, endPatterns, maxLength = 50000, skipTOC = true) {
  for (const sp of startPatterns) {
    const regex = typeof sp === 'string' ? new RegExp(sp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : new RegExp(sp.source, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      if (skipTOC) {
        const afterMatch = text.slice(start + match[0].length, start + match[0].length + 30);
        if (/^\s*\.[\s.]*\.[\s.]*\./.test(afterMatch)) {
          continue;
        }
      }
      let end = Math.min(start + maxLength, text.length);
      for (const ep of endPatterns) {
        const endRegex = typeof ep === 'string' ? new RegExp(ep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : ep;
        const afterStart = text.slice(start + match[0].length);
        const endMatch = afterStart.match(endRegex);
        if (endMatch) {
          end = Math.min(end, start + match[0].length + endMatch.index);
        }
      }
      return text.slice(start, end);
    }
  }
  return '';
}

// ==================== 简化的评分函数（用于测试） ====================

function testScoring(text, stockCode) {
  const results = {
    stockCode,
    oldShares: { score: 0, reason: '', evidence: '' },
    sponsor: { score: 0, reason: '', evidence: '', sponsors: [] },
    cornerstone: { score: 0, reason: '', evidence: '' },
    lockup: { score: 0, reason: '', evidence: '' },
    industry: { score: 0, reason: '', evidence: '' },
    totalScore: 0,
  };

  // ========== 1. 旧股检测 ==========
  const frontPages = text.slice(0, 25000);
  const offeringStatementPatterns = [
    /全球發售的發售股份數目[：:]\s*([^\n]+)/i,
    /全球发售的发售股份数目[：:]\s*([^\n]+)/i,
  ];

  let globalOfferingStatement = '';
  for (const pattern of offeringStatementPatterns) {
    const match = frontPages.match(pattern);
    if (match) {
      globalOfferingStatement = match[0].replace(/\s+/g, ' ').trim();
      break;
    }
  }

  if (globalOfferingStatement) {
    if (/銷售股份|销售股份/.test(globalOfferingStatement)) {
      results.oldShares = { score: -2, reason: '有旧股发售', evidence: globalOfferingStatement };
    } else {
      results.oldShares = { score: 0, reason: '全部新股', evidence: globalOfferingStatement };
    }
  } else {
    // 扩大搜索
    const globalOfferingSection = text.slice(0, 80000);
    if (/銷售股份|销售股份/.test(globalOfferingSection)) {
      results.oldShares = { score: -2, reason: '有旧股发售', evidence: '在全球發售章节发现銷售股份' };
    } else {
      results.oldShares = { score: 0, reason: '全部新股', evidence: '未发现銷售股份关键词' };
    }
  }

  // ========== 2. 保荐人检测 ==========
  const partiesSection = extractSection(
    text,
    [/董事及參與全球發售的各方/i, /參與全球發售的各方/i, /参与全球发售的各方/i],
    [/公司資料/i, /行業概覽/i, /監管概覽/i],
    40000, true
  );

  // 提取保荐人名称
  const sponsorPatterns = [
    /(?:聯席保薦人|獨家保薦人)[^\n]*\n([^\n]+有限公司)/gi,
    /(?:聯席保薦人|獨家保薦人)\s+([^\n]+有限公司)/gi,
  ];

  const extractedSponsors = [];
  const searchText = partiesSection || text.slice(0, 100000);

  for (const pattern of sponsorPatterns) {
    let match;
    while ((match = pattern.exec(searchText)) !== null) {
      const name = match[1].trim().replace(/\s+/g, '');
      if (name.length >= 4 && name.includes('公司') && !extractedSponsors.includes(name)) {
        extractedSponsors.push(name);
      }
    }
  }

  // 从釋義章节查找
  if (extractedSponsors.length === 0) {
    const defMatch = text.match(/「聯席保薦人」\s*指\s*([^「」]+?)(?=「|$)/i);
    if (defMatch) {
      const names = defMatch[1].split(/[、及和]/);
      for (const name of names) {
        const cleanName = name.trim().replace(/\s+/g, '').replace(/[（(][^）)]*[）)]$/, '');
        if (cleanName.length >= 4 && (cleanName.includes('公司') || cleanName.includes('Limited'))) {
          extractedSponsors.push(cleanName);
        }
      }
    }
  }

  results.sponsor = {
    score: 0, // 根据用户要求，保荐人评分默认0分
    reason: extractedSponsors.length > 0 ? `识别到${extractedSponsors.length}个保荐人` : '未识别到保荐人',
    evidence: partiesSection ? '參與全球發售的各方章节' : '招股书前100000字',
    sponsors: extractedSponsors,
  };

  // ========== 3. 基石投资者检测（带词边界检查）==========
  const cornerstoneSection = extractSection(
    text,
    [/基石投資者/i, /基石投资者/i, /CORNERSTONE\s*INVESTOR/i],
    [/風險因素/i, /风险因素/i, /行業概覽/i],
    50000
  );

  const hasCornerstoneSection = cornerstoneSection && cornerstoneSection.length > 500;
  const investorSearchText = cornerstoneSection || text.slice(0, 150000);

  // 词边界检查函数
  const isInvestorWordBoundaryMatch = (searchText, keyword) => {
    if (/^[\u4e00-\u9fa5]+$/.test(keyword)) {
      return searchText.includes(keyword);
    }
    if (/^[A-Za-z0-9]+$/.test(keyword) && keyword.length <= 5) {
      const regex = new RegExp(`(?:^|[^A-Za-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^A-Za-z0-9])`, 'i');
      return regex.test(searchText);
    }
    return searchText.includes(keyword);
  };

  // 验证上下文（仅用于fallback搜索时过滤明显无效的匹配）
  const isValidCornerstoneContext = (searchText, keyword, index, inCornerstoneSection) => {
    if (index === -1) return false;
    // 如果在基石章节内找到，直接信任
    if (inCornerstoneSection) return true;

    const contextStart = Math.max(0, index - 50);
    const context = searchText.slice(contextStart, Math.min(searchText.length, index + keyword.length + 50));
    const keywordPosInContext = index - contextStart;  // 关键词在context中的相对位置

    // 只在fallback搜索时过滤：检查关键词前后是否紧邻字母（如AGIC中的GIC）
    if (/^[A-Za-z0-9]+$/.test(keyword) && keyword.length <= 4) {
      const charBefore = keywordPosInContext > 0 ? context.charAt(keywordPosInContext - 1) : '';
      const charAfter = context.charAt(keywordPosInContext + keyword.length) || '';
      if (/[A-Za-z]/.test(charBefore) || /[A-Za-z]/.test(charAfter)) {
        // 关键词前后有英文字母，可能是更长单词的一部分
        return false;
      }
    }

    // 检查是否是缩写定义列表
    const words = context.split(/\s+/);
    let upperCount = 0;
    for (const w of words) {
      if (/^[A-Z0-9\-]{2,}$/.test(w)) upperCount++;
    }
    if (words.length > 5 && upperCount / words.length > 0.6) return false;

    return true;
  };

  const foundInvestors = [];
  for (const inv of STAR_CORNERSTONE) {
    if (isInvestorWordBoundaryMatch(investorSearchText, inv)) {
      const invIndex = investorSearchText.indexOf(inv);
      if (isValidCornerstoneContext(investorSearchText, inv, invIndex, hasCornerstoneSection)) {
        foundInvestors.push(inv);
      }
    }
  }

  if (foundInvestors.length > 0) {
    results.cornerstone = { score: 2, reason: '有明星基石', evidence: foundInvestors.join(', ') };
  } else {
    results.cornerstone = { score: 0, reason: '无明星基石', evidence: '未发现明星基石投资者' };
  }

  // ========== 4. Pre-IPO禁售期检测 ==========
  const preIPOTermsMatch = text.match(/首次公開發售前投資的主要條款[\s\S]{0,5000}?(?=\n\s*[一二三四五六七八九十\d]+[\.、]|(?:控股|主要)股東|附錄|$)/i);

  let hasPreIPO = false;
  let hasLockup = false;
  let lockupEvidence = '';

  if (preIPOTermsMatch) {
    hasPreIPO = true;
    if (/禁售期/.test(preIPOTermsMatch[0])) {
      hasLockup = true;
      const lockupMatch = preIPOTermsMatch[0].match(/禁售期[^。\n]*[。\n]/);
      lockupEvidence = lockupMatch ? lockupMatch[0] : '发现禁售期关键词';
    }
  } else {
    // 扩大搜索
    const historySection = extractSection(
      text,
      [/歷史[、,]?\s*重組/i, /歷史[、,]?\s*發展/i],
      [/業務/i, /业务/i],
      150000, true
    );

    if (historySection) {
      const preIPOKeywords = ['首次公開發售前投資', 'Pre-IPO', '上市前投資'];
      for (const kw of preIPOKeywords) {
        if (historySection.toLowerCase().includes(kw.toLowerCase())) {
          hasPreIPO = true;
          // 搜索禁售期
          const idx = historySection.toLowerCase().indexOf(kw.toLowerCase());
          const nearbyText = historySection.slice(Math.max(0, idx - 100), Math.min(historySection.length, idx + 1000));
          if (/禁售期|鎖定期|lock-up/i.test(nearbyText)) {
            hasLockup = true;
            const lockupMatch = nearbyText.match(/禁售期[^。\n]*/i);
            lockupEvidence = lockupMatch ? lockupMatch[0] : '发现禁售期';
          }
          break;
        }
      }
    }
  }

  if (hasPreIPO) {
    if (hasLockup) {
      results.lockup = { score: 0, reason: 'Pre-IPO有禁售期', evidence: lockupEvidence };
    } else {
      results.lockup = { score: -2, reason: 'Pre-IPO无禁售期', evidence: '有Pre-IPO但未找到禁售期' };
    }
  } else {
    results.lockup = { score: 0, reason: '无Pre-IPO', evidence: '未发现Pre-IPO投资者' };
  }

  // ========== 5. 行业检测（带词边界检查和釋義列表过滤）==========
  const industrySection = extractSection(
    text,
    [/行業概覽/i, /行业概览/i, /INDUSTRY\s*OVERVIEW/i],
    [/監管/i, /监管/i, /董事/i],
    100000
  );

  const industrySearchText = industrySection || text.slice(0, 250000);

  // 获取上下文
  const getIndustryContext = (keyword) => {
    const idx = industrySearchText.indexOf(keyword);
    if (idx !== -1) {
      return industrySearchText.slice(Math.max(0, idx - 30), Math.min(industrySearchText.length, idx + keyword.length + 50)).replace(/\s+/g, ' ');
    }
    return '';
  };

  // 词边界检查
  const isIndustryWordBoundaryMatch = (text, keyword) => {
    if (/^[\u4e00-\u9fa5]+$/.test(keyword)) {
      return text.includes(keyword);
    }
    if (/^[A-Za-z0-9]+$/.test(keyword) && keyword.length <= 4) {
      const regex = new RegExp(`(?:^|[^A-Za-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^A-Za-z0-9])`, 'i');
      return regex.test(text);
    }
    return text.includes(keyword);
  };

  // 检查是否是釋義缩写词列表
  const isIndustryDefinitionList = (keyword) => {
    const ctx = getIndustryContext(keyword);
    const words = ctx.split(/\s+/);
    let techWordCount = 0;
    let allUpperCount = 0;
    for (const w of words) {
      if (/^[A-Z0-9a-z\-]{1,15}$/.test(w)) techWordCount++;
      if (/^[A-Z0-9\-]{2,}$/.test(w)) allUpperCount++;
    }
    return words.length > 5 && (techWordCount / words.length > 0.5 || allUpperCount / words.length > 0.4);
  };

  let industryScore = 0;
  let industryReason = '中性赛道';
  let matchedKeyword = '';

  // 检查热门赛道
  for (const track of HOT_TRACKS) {
    if (isIndustryWordBoundaryMatch(industrySearchText, track)) {
      if (isIndustryDefinitionList(track)) continue;
      industryScore = 2;
      industryReason = '热门赛道';
      matchedKeyword = track;
      break;
    }
  }

  // 检查成长赛道
  if (industryScore === 0) {
    for (const track of GROWTH_TRACKS) {
      if (isIndustryWordBoundaryMatch(industrySearchText, track)) {
        if (isIndustryDefinitionList(track)) continue;
        industryScore = 1;
        industryReason = '成长赛道';
        matchedKeyword = track;
        break;
      }
    }
  }

  // 检查低弹性赛道
  if (industryScore === 0) {
    for (const track of LOW_ELASTICITY_TRACKS) {
      if (isIndustryWordBoundaryMatch(industrySearchText, track)) {
        if (isIndustryDefinitionList(track)) continue;
        industryScore = -1;
        industryReason = '低弹性赛道';
        matchedKeyword = track;
        break;
      }
    }
  }

  // 检查回避赛道
  for (const track of AVOID_TRACKS) {
    if (isIndustryWordBoundaryMatch(industrySearchText, track)) {
      if (isIndustryDefinitionList(track)) continue;
      industryScore = -2;
      industryReason = '回避赛道';
      matchedKeyword = track;
      break;
    }
  }

  results.industry = {
    score: industryScore,
    reason: industryReason,
    evidence: matchedKeyword || '无明显偏好',
  };

  // 计算总分
  results.totalScore = results.oldShares.score + results.sponsor.score +
                       results.cornerstone.score + results.lockup.score + results.industry.score;

  return results;
}

// ==================== 测试用例 ====================

const TEST_CASES = [
  {
    code: '02677',
    name: '卓正醫療',
    expected: {
      oldShares: 0,      // 无旧股
      sponsor: 0,        // 海通/浦銀（业绩一般）
      cornerstone: 0,    // 无基石
      lockup: 0,         // 有禁售期
      industry: 0,       // 无明显偏好
      total: 0,
    },
    notes: '医疗服务，有Pre-IPO禁售期',
  },
  {
    code: '02714',
    name: '锅圈食汇',
    expected: {
      oldShares: 0,      // 无旧股
      sponsor: 0,        // 摩根/中信/高盛
      cornerstone: 0,    // 无基石
      lockup: 0,         // 无禁售期或无Pre-IPO
      industry: -1,      // 食品
      total: -1,
    },
    notes: '食品行业',
  },
  {
    code: '03200',
    name: '中国商飞',
    expected: {
      oldShares: 0,      // 无旧股
      sponsor: 0,        // 中金
      cornerstone: 2,    // 有基石
      lockup: 0,         // 无禁售期
      industry: 0,       // 中立
      total: 2,
    },
    notes: '航空制造，有基石投资者',
  },
  {
    code: '06809',
    name: '瀾起科技',
    expected: {
      oldShares: 0,      // 无旧股
      sponsor: 0,        // 中金/摩根/UBS
      cornerstone: 0,    // 无明星基石（可能误判）
      lockup: 0,         // 无禁售期
      industry: 2,       // 高速互連芯片
      total: 2,
    },
    notes: '芯片行业',
  },
  {
    code: '00600',
    name: '爱芯元智',
    expected: {
      oldShares: 0,      // 无旧股
      sponsor: 0,        // 中金/国泰君安/交银
      cornerstone: 0,    // 无明星基石（可能误判）
      lockup: 0,         // 无禁售期
      industry: 2,       // 半导体
      total: 2,
    },
    notes: '半导体行业',
  },
  {
    code: '02720',
    name: '牧高笛',
    expected: {
      oldShares: 0,      // 无旧股
      sponsor: 0,        // 中金
      cornerstone: 0,    // 无基石
      lockup: 0,         // 无禁售期
      industry: 0,       // 户外（中立）
      total: 0,
    },
    notes: '户外用品',
  },
];

// ==================== 运行测试 ====================

async function runTests() {
  console.log('═'.repeat(80));
  console.log('IPO评分算法测试');
  console.log('═'.repeat(80));

  let passed = 0;
  let failed = 0;

  for (const testCase of TEST_CASES) {
    const cachePath = path.join(CACHE_DIR, `${testCase.code.padStart(5, '0')}.txt`);

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`测试: ${testCase.code} ${testCase.name} (${testCase.notes})`);
    console.log(`${'─'.repeat(80)}`);

    if (!fs.existsSync(cachePath)) {
      console.log(`  ⚠️  缓存文件不存在: ${cachePath}`);
      console.log(`  期望总分: ${testCase.expected.total}`);
      failed++;
      continue;
    }

    const text = fs.readFileSync(cachePath, 'utf-8');
    const results = testScoring(text, testCase.code);

    console.log(`\n  📊 评分结果:`);
    console.log(`     旧股: ${results.oldShares.score} (${results.oldShares.reason})`);
    console.log(`           证据: ${results.oldShares.evidence.slice(0, 100)}...`);
    console.log(`     保荐人: ${results.sponsor.score} (${results.sponsor.reason})`);
    console.log(`           保荐人: ${results.sponsor.sponsors.join(', ') || '未识别'}`);
    console.log(`     基石: ${results.cornerstone.score} (${results.cornerstone.reason})`);
    console.log(`           证据: ${results.cornerstone.evidence.slice(0, 50)}...`);
    console.log(`     禁售期: ${results.lockup.score} (${results.lockup.reason})`);
    console.log(`           证据: ${results.lockup.evidence.slice(0, 80)}...`);
    console.log(`     行业: ${results.industry.score} (${results.industry.reason})`);
    console.log(`           关键词: ${results.industry.evidence}`);
    console.log(`\n     总分: ${results.totalScore}`);

    console.log(`\n  🎯 期望值:`);
    console.log(`     旧股: ${testCase.expected.oldShares}, 保荐人: ${testCase.expected.sponsor}, 基石: ${testCase.expected.cornerstone}, 禁售期: ${testCase.expected.lockup}, 行业: ${testCase.expected.industry}`);
    console.log(`     期望总分: ${testCase.expected.total}`);

    // 验证
    const errors = [];
    if (results.oldShares.score !== testCase.expected.oldShares) {
      errors.push(`旧股: 实际${results.oldShares.score} != 期望${testCase.expected.oldShares}`);
    }
    if (results.cornerstone.score !== testCase.expected.cornerstone) {
      errors.push(`基石: 实际${results.cornerstone.score} != 期望${testCase.expected.cornerstone}`);
    }
    if (results.industry.score !== testCase.expected.industry) {
      errors.push(`行业: 实际${results.industry.score} != 期望${testCase.expected.industry}`);
    }
    if (results.totalScore !== testCase.expected.total) {
      errors.push(`总分: 实际${results.totalScore} != 期望${testCase.expected.total}`);
    }

    if (errors.length === 0) {
      console.log(`\n  ✅ 测试通过`);
      passed++;
    } else {
      console.log(`\n  ❌ 测试失败:`);
      for (const err of errors) {
        console.log(`     - ${err}`);
      }
      failed++;
    }
  }

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`测试完成: ${passed} 通过, ${failed} 失败`);
  console.log(`${'═'.repeat(80)}`);
}

runTests().catch(console.error);
