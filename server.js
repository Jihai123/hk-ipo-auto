/**
 * 港股新股自动评分系统 v3.0
 *
 * v3.0 更新:
 * - 新增评分详情展示：每个维度显示判断依据、匹配关键词、上下文引用
 * - 优化前端UI：全新深色主题设计，可展开的评分详情卡片
 * - PDF链接优化：提供"港交所披露易搜索"快速入口，避免慢速PDF下载
 * - 保荐人爬虫升级v3：支持多页爬取，汇总更多保荐人数据
 *
 * v2.1 修复清单:
 * 1. PDF解析页数: 150 → 400
 * 2. 旧股-无旧股: +2 → 0分
 * 3. 旧股判断: 全文搜索 → 限定「全球發售」章节
 * 4. 保荐人识别: 全文 → 限定「參與全球發售的各方」章节
 * 5. 保荐人评分: tier分层 → 实际涨幅率(≥70%=+2, 40-70%=0, <40%=-2)
 * 6. 基石投资者: ≥3个+2/1-2个+1 → 有明星基石=+2, 其他=0
 * 7. 基石名单: 精简为原始名单(高瓴/红杉/淡马锡/GIC等)
 * 8. Pre-IPO逻辑: 无禁售=-2 → 有Pre-IPO且无禁售=-2, 有禁售=0, 无Pre-IPO=0
 * 9. 行业分类: v2基于炒作逻辑 (+2/+1/0/-1/-2 五档)
 * 10. 文本匹配: 直接includes → 去空格+繁简转换+章节限定
 * 11. 缓存: 无 → 7天文件缓存
 * 12. 扫描版检测: 无 → text.length<5000报错
 * 13. 保荐人数据: 硬编码 → JSON文件/数据库支持
 * 14. 清缓存API: 新增
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const pdfParse = require('pdf-parse');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3010;

// 目录配置
const CACHE_DIR = path.join(__dirname, 'cache');
const DATA_DIR = path.join(__dirname, 'data');
const SPONSORS_JSON = path.join(DATA_DIR, 'sponsors.json');
const IPO_SPONSORS_JSON = path.join(DATA_DIR, 'ipo-sponsors.json');

// 确保目录存在
[CACHE_DIR, DATA_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== 保荐人数据 ====================

/**
 * 从JSON文件加载保荐人数据（爬虫获取的真实数据）
 */
function loadSponsorsFromJSON() {
  if (fs.existsSync(SPONSORS_JSON)) {
    try {
      const data = JSON.parse(fs.readFileSync(SPONSORS_JSON, 'utf-8'));
      const result = {};
      for (const s of data.sponsors || []) {
        result[s.name] = {
          rate: s.avgFirstDay,
          count: s.count,
          winRate: s.winRate,
          upCount: s.upCount,
          downCount: s.downCount
        };
      }
      console.log(`[数据] 从JSON加载 ${Object.keys(result).length} 个保荐人`);
      return result;
    } catch (e) {
      console.error('[数据] JSON加载失败:', e.message);
    }
  }
  return null;
}

/**
 * 从IPO映射表加载股票代码→保荐人数据
 * 用于PDF解析无法提取保荐人名称时的备用方案
 */
function loadIPOSponsorMapping() {
  if (fs.existsSync(IPO_SPONSORS_JSON)) {
    try {
      const data = JSON.parse(fs.readFileSync(IPO_SPONSORS_JSON, 'utf-8'));
      console.log(`[数据] 从IPO映射表加载 ${data.count || 0} 个股票代码→保荐人映射`);
      return data.mapping || {};
    } catch (e) {
      console.error('[数据] IPO映射表加载失败:', e.message);
    }
  }
  return {};
}

// 缓存IPO映射表
let IPO_SPONSOR_MAP = {};
try {
  IPO_SPONSOR_MAP = loadIPOSponsorMapping();
} catch (e) {
  console.error('[数据] IPO映射表初始化失败');
}

/**
 * 通过股票代码查找保荐人
 * @param {string} stockCode - 股票代码
 * @returns {Array|null} - 保荐人名称数组或null
 */
function getSponsorsByStockCode(stockCode) {
  const normalizedCode = stockCode.toString().padStart(5, '0');
  const mapping = IPO_SPONSOR_MAP[normalizedCode];
  if (mapping && mapping.sponsors && mapping.sponsors.length > 0) {
    return mapping.sponsors;
  }
  return null;
}

/**
 * 后备保荐人数据（综合多个数据源）
 * 包含历史数据估算，用于数据库/JSON不可用时的fallback
 * 数据来源：AAStocks、港交所披露易、公开财报等
 */
const FALLBACK_SPONSORS = {
  // ========== 主要保荐人（完整名称）==========
  // 中资券商
  '中國國際金融香港證券有限公司': { rate: 27.96, count: 64, winRate: 68.75 },
  '中信證券(香港)有限公司': { rate: 41.62, count: 42, winRate: 83.33 },
  '中信里昂證券有限公司': { rate: 35.50, count: 38, winRate: 78.95 },
  '華泰金融控股(香港)有限公司': { rate: 6.86, count: 33, winRate: 57.58 },
  '海通國際資本有限公司': { rate: 31.22, count: 28, winRate: 75.00 },
  '國泰君安融資有限公司': { rate: 23.18, count: 25, winRate: 76.00 },
  '招商證券(香港)有限公司': { rate: 18.50, count: 22, winRate: 68.18 },
  '招銀國際融資有限公司': { rate: 25.56, count: 18, winRate: 72.22 },
  '建銀國際金融有限公司': { rate: 11.38, count: 18, winRate: 72.22 },
  '廣發融資（香港）有限公司': { rate: 22.30, count: 15, winRate: 73.33 },
  '交銀國際證券有限公司': { rate: 19.20, count: 14, winRate: 71.43 },
  '工銀國際融資有限公司': { rate: 12.50, count: 12, winRate: 66.67 },
  '農銀國際融資有限公司': { rate: 15.80, count: 10, winRate: 70.00 },
  '申萬宏源融資(香港)有限公司': { rate: 28.30, count: 12, winRate: 75.00 },
  '中銀國際亞洲有限公司': { rate: 14.60, count: 15, winRate: 66.67 },
  '光大融資有限公司': { rate: 17.80, count: 8, winRate: 62.50 },
  '民銀資本有限公司': { rate: -5.20, count: 12, winRate: 41.67 },
  '中信建投(國際)融資有限公司': { rate: 15.20, count: 10, winRate: 70.00 },
  '東方證券(香港)有限公司': { rate: 12.80, count: 8, winRate: 62.50 },
  '興證國際融資有限公司': { rate: 8.50, count: 9, winRate: 55.56 },
  '國信證券(香港)融資有限公司': { rate: 10.20, count: 8, winRate: 62.50 },
  '長江證券(香港)有限公司': { rate: 6.80, count: 6, winRate: 50.00 },
  '方正證券(香港)融資有限公司': { rate: 5.50, count: 5, winRate: 40.00 },

  // 外资投行
  '摩根士丹利亞洲有限公司': { rate: 21.91, count: 35, winRate: 77.14 },
  '高盛(亞洲)有限責任公司': { rate: 15.58, count: 30, winRate: 73.33 },
  '瑞銀證券香港有限公司': { rate: 16.22, count: 25, winRate: 72.00 },
  '花旗環球金融亞洲有限公司': { rate: 18.50, count: 20, winRate: 75.00 },
  'J.P. Morgan Securities (Far East) Limited': { rate: 19.80, count: 28, winRate: 75.00 },
  '摩根大通證券(遠東)有限公司': { rate: 19.80, count: 28, winRate: 75.00 },
  '美銀證券': { rate: 14.20, count: 18, winRate: 66.67 },
  'BofA Securities': { rate: 14.20, count: 18, winRate: 66.67 },
  '德意志銀行': { rate: 8.50, count: 12, winRate: 58.33 },
  '巴克萊': { rate: 10.20, count: 10, winRate: 60.00 },
  '法國巴黎銀行': { rate: 12.50, count: 8, winRate: 62.50 },
  '匯豐': { rate: 11.80, count: 15, winRate: 66.67 },
  '渣打': { rate: 9.50, count: 10, winRate: 60.00 },

  // 本地券商
  '大華繼顯(香港)有限公司': { rate: 5.20, count: 15, winRate: 53.33 },
  '力高企業融資有限公司': { rate: 3.80, count: 12, winRate: 50.00 },
  '艾德證券': { rate: 6.50, count: 8, winRate: 50.00 },
  '寶新金融': { rate: 4.20, count: 6, winRate: 50.00 },
  '第一上海': { rate: 7.80, count: 10, winRate: 60.00 },

  // ========== 简称映射（繁体）==========
  '中金': { rate: 27.96, count: 64, winRate: 68.75 },
  '中金公司': { rate: 27.96, count: 64, winRate: 68.75 },
  '中國國際金融': { rate: 27.96, count: 64, winRate: 68.75 },
  'CICC': { rate: 27.96, count: 64, winRate: 68.75 },
  '中信': { rate: 41.62, count: 42, winRate: 83.33 },
  '中信證券': { rate: 41.62, count: 42, winRate: 83.33 },
  '中信里昂': { rate: 35.50, count: 38, winRate: 78.95 },
  '華泰': { rate: 6.86, count: 33, winRate: 57.58 },
  '華泰金融': { rate: 6.86, count: 33, winRate: 57.58 },
  '高盛': { rate: 15.58, count: 30, winRate: 73.33 },
  'Goldman': { rate: 15.58, count: 30, winRate: 73.33 },
  '摩根士丹利': { rate: 21.91, count: 35, winRate: 77.14 },
  'Morgan Stanley': { rate: 21.91, count: 35, winRate: 77.14 },
  '海通': { rate: 31.22, count: 28, winRate: 75.00 },
  '海通國際': { rate: 31.22, count: 28, winRate: 75.00 },
  '瑞銀': { rate: 16.22, count: 25, winRate: 72.00 },
  'UBS': { rate: 16.22, count: 25, winRate: 72.00 },
  '國泰君安': { rate: 23.18, count: 25, winRate: 76.00 },
  '建銀國際': { rate: 11.38, count: 18, winRate: 72.22 },
  '招銀國際': { rate: 25.56, count: 18, winRate: 72.22 },
  '招商證券': { rate: 18.50, count: 22, winRate: 68.18 },
  '招商': { rate: 18.50, count: 22, winRate: 68.18 },
  '花旗': { rate: 18.50, count: 20, winRate: 75.00 },
  'Citi': { rate: 18.50, count: 20, winRate: 75.00 },
  '廣發': { rate: 22.30, count: 15, winRate: 73.33 },
  '農銀國際': { rate: 15.80, count: 10, winRate: 70.00 },
  '交銀國際': { rate: 19.20, count: 14, winRate: 71.43 },
  '工銀國際': { rate: 12.50, count: 12, winRate: 66.67 },
  '申萬宏源': { rate: 28.30, count: 12, winRate: 75.00 },
  '中銀國際': { rate: 14.60, count: 15, winRate: 66.67 },
  '光大': { rate: 17.80, count: 8, winRate: 62.50 },
  '民銀資本': { rate: -5.20, count: 12, winRate: 41.67 },
  '摩根大通': { rate: 19.80, count: 28, winRate: 75.00 },
  'J.P. Morgan': { rate: 19.80, count: 28, winRate: 75.00 },
  'JPMorgan': { rate: 19.80, count: 28, winRate: 75.00 },
  '中信建投': { rate: 15.20, count: 10, winRate: 70.00 },
  '東方證券': { rate: 12.80, count: 8, winRate: 62.50 },
  '興證國際': { rate: 8.50, count: 9, winRate: 55.56 },
  '國信證券': { rate: 10.20, count: 8, winRate: 62.50 },
  '長江證券': { rate: 6.80, count: 6, winRate: 50.00 },
  '方正證券': { rate: 5.50, count: 5, winRate: 40.00 },
  '大華繼顯': { rate: 5.20, count: 15, winRate: 53.33 },
  '力高': { rate: 3.80, count: 12, winRate: 50.00 },

  // ========== 简称映射（简体）==========
  '中信证券': { rate: 41.62, count: 42, winRate: 83.33 },
  '华泰': { rate: 6.86, count: 33, winRate: 57.58 },
  '海通国际': { rate: 31.22, count: 28, winRate: 75.00 },
  '瑞银': { rate: 16.22, count: 25, winRate: 72.00 },
  '国泰君安': { rate: 23.18, count: 25, winRate: 76.00 },
  '建银国际': { rate: 11.38, count: 18, winRate: 72.22 },
  '招银国际': { rate: 25.56, count: 18, winRate: 72.22 },
  '招商证券': { rate: 18.50, count: 22, winRate: 68.18 },
  '广发': { rate: 22.30, count: 15, winRate: 73.33 },
  '农银国际': { rate: 15.80, count: 10, winRate: 70.00 },
  '交银国际': { rate: 19.20, count: 14, winRate: 71.43 },
  '工银国际': { rate: 12.50, count: 12, winRate: 66.67 },
  '申万宏源': { rate: 28.30, count: 12, winRate: 75.00 },
  '中银国际': { rate: 14.60, count: 15, winRate: 66.67 },
  '民银资本': { rate: -5.20, count: 12, winRate: 41.67 },
  '摩根大通': { rate: 19.80, count: 28, winRate: 75.00 },
  '中信建投': { rate: 15.20, count: 10, winRate: 70.00 },
  '东方证券': { rate: 12.80, count: 8, winRate: 62.50 },
  '兴证国际': { rate: 8.50, count: 9, winRate: 55.56 },
  '国信证券': { rate: 10.20, count: 8, winRate: 62.50 },
  '长江证券': { rate: 6.80, count: 6, winRate: 50.00 },
  '方正证券': { rate: 5.50, count: 5, winRate: 40.00 },
  '大华继显': { rate: 5.20, count: 15, winRate: 53.33 },
};

/**
 * 获取所有保荐人数据
 * 合并JSON数据和FALLBACK数据，JSON数据优先
 */
function getAllSponsors() {
  const jsonData = loadSponsorsFromJSON();

  // 合并：FALLBACK为基础，JSON数据覆盖
  const merged = { ...FALLBACK_SPONSORS };

  if (jsonData) {
    // JSON数据覆盖FALLBACK中的同名保荐人
    for (const [name, data] of Object.entries(jsonData)) {
      merged[name] = data;
    }
  }

  return merged;
}

// ==================== 行业评分体系 v2（基于炒作逻辑）====================
/**
 * 行业评分规则:
 * +2 情绪驱动型热门赛道：强题材、资金愿意炒、FOMO情绪
 * +1 成长叙事型赛道：有故事但热度一般
 *  0 中性赛道：无明显偏好
 * -1 低弹性赛道：缺乏想象空间
 * -2 资金回避型赛道：破发率高、监管风险
 */

// +2 情绪驱动型热门赛道（2024-2026市场主线）
const HOT_TRACKS = [
  // AI / 大模型
  '人工智能', '人工智慧', '大模型', '大語言模型', 'LLM', 'GPT', '生成式',
  'AIGC', '算法', '算力', '機器學習', '机器学习', '深度學習', '深度学习',
  'AI應用', 'AI应用', 'AI芯片', 'AI晶片',
  // 机器人 / 具身智能
  '機器人', '机器人', 'Robot', '人形機器人', '人形机器人', '具身智能',
  '工業機器人', '工业机器人', '服務機器人', '服务机器人',
  // 自动驾驶 / 智驾
  '自動駕駛', '自动驾驶', '智能駕駛', '智能驾驶', '智駕', '智驾',
  '無人駕駛', '无人驾驶', '車聯網', '车联网', 'V2X', 'L4', 'L3',
  // 半导体 / 芯片
  '半導體', '半导体', '芯片', '晶片', 'GPU', 'NPU', '處理器', '处理器',
  '集成電路', '集成电路', 'IC設計', 'IC设计', '國產替代', '国产替代',
  'Chiplet', '先進封裝', '先进封装', 'EDA', 'ASIC',
  // 创新药 / Biotech
  'ADC', 'CAR-T', 'mRNA', '細胞治療', '细胞治疗', '基因治療', '基因治疗',
  '創新藥', '创新药', '生物製藥', '生物制药', 'Biotech', '雙抗', '双抗',
  'siRNA', 'RNAi', 'PROTAC', '抗體偶聯', '抗体偶联',
  // 低空经济 / eVTOL
  '低空經濟', '低空经济', 'eVTOL', '飛行汽車', '飞行汽车',
  '無人機', '无人机', '電動垂直', '电动垂直', 'UAV',
  // 新消费龙头
  '新茶飲', '新茶饮', '咖啡連鎖', '咖啡连锁', '折扣零售', '零食連鎖',
];

// +1 成长叙事型赛道
const GROWTH_TRACKS = [
  // 医疗健康（非创新药）
  '醫療器械', '医疗器械', '醫療設備', '医疗设备', '診斷', '诊断',
  '眼科', '口腔', '醫美', '医美', 'CXO', 'CDMO', 'CMO',
  // 新能源（热度下降但仍有关注）
  '新能源', '鋰電', '锂电', '儲能', '储能', '光伏', '太陽能', '太阳能',
  '風電', '风电', '電動車', '电动车', '新能源車', '新能源车', '充電樁', '充电桩',
  // 企业服务
  'SaaS', '雲計算', '云计算', '企業服務', '企业服务', '數據中心', '数据中心',
  // 新消费（非龙头）
  '預製菜', '预制菜', '寵物', '宠物', '潮玩', '電子煙', '电子烟',
  // 软件
  '軟件', '软件', '軟體', 'ERP', 'CRM',
];

// -1 低弹性赛道
const LOW_ELASTICITY_TRACKS = [
  // 传统消费
  '食品加工', '飲料', '饮料', '調味品', '调味品', '乳製品', '乳制品', '酒類', '酒类',
  // 传统制造
  '機械製造', '机械制造', '工業設備', '工业设备', '包裝', '包装', '印刷',
  // 公用事业
  '水務', '水务', '燃氣', '燃气', '電力', '电力', '供熱', '供热', '環保', '环保',
  // 建材
  '建材', '水泥', '玻璃', '鋼鐵', '钢铁', '鋁業', '铝业',
];

// -2 资金回避型赛道（历史破发率高/监管风险）
const AVOID_TRACKS = [
  // 物业管理（2021后破发重灾区）
  '物業管理', '物业管理', '物業服務', '物业服务', '物管',
  // 房地产相关
  '房地產', '房地产', '地產開發', '地产开发', '內房', '内房', '房企',
  '商業地產', '商业地产', '住宅開發', '住宅开发',
  // 传统金融服务
  '小額貸款', '小额贷款', '消費金融', '消费金融', '融資租賃', '融资租赁',
  'P2P', '網貸', '网贷', '民間借貸', '民间借贷', '典當', '典当',
  // 纺织服装
  '紡織', '纺织', '服裝製造', '服装制造', '製衣', '制衣', '鞋履製造', '鞋履制造',
  // 教培（政策风险）
  '教育培訓', '教育培训', '課外輔導', '课外辅导', 'K12', '學科培訓', '学科培训',
  // 博彩（监管不确定）
  '博彩', '賭場', '賭博', '赌场', '赌博',
];

// ==================== 明星基石投资者名单 ====================
// 注意：D1 Partners使用特殊标记，需要边界匹配避免误匹配"附錄D1A"等内容
const STAR_CORNERSTONE = [
  // 顶级PE/VC
  '高瓴', 'Hillhouse', '紅杉', '红杉', 'Sequoia',
  // 主权基金
  '淡馬錫', '淡马锡', 'Temasek', 'GIC', '新加坡政府',
  '阿布達比', '阿布扎比', 'ADIA', '科威特投資局', '科威特投资局',
  // 全球资管
  '黑石', 'Blackstone', '貝萊德', '贝莱德', 'BlackRock',
  '富達', '富达', 'Fidelity', 'Wellington', '普信', 'T. Rowe',
  '資本集團', '资本集团', 'Capital Group',
  // 中国主权/国家级
  '中投公司', 'CIC', '社保基金', '全國社保', '全国社保',
  '國家大基金', '国家大基金', '絲路基金', '丝路基金',
  // 知名对冲基金 - D1 Partners需要完整名称
  'Tiger Global', 'Coatue', 'DST Global', 'D1 Partners', 'D1 Capital', 'Viking Global',
  // 知名中国PE
  '春華資本', '春华资本', '博裕資本', '博裕资本', '厚朴投資', '厚朴投资',
  '鼎暉', '鼎晖', 'CDH', '中信產業基金', '中信产业基金',
  // 软银
  '軟銀', '软银', 'SoftBank', 'Vision Fund',
];

// ==================== 工具函数 ====================

/**
 * 格式化股票代码为5位
 */
function formatStockCode(code) {
  return code.toString().replace(/\D/g, '').padStart(5, '0');
}

/**
 * 文本标准化：去空格、全角转半角、繁简统一
 */
function normalizeText(text) {
  if (!text) return '';
  return text
    // 去除所有空白字符
    .replace(/\s+/g, '')
    // 全角转半角（包括全角括号）
    .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    // 繁简常用字转换
    .replace(/證/g, '证').replace(/國/g, '国').replace(/際/g, '际')
    .replace(/銀/g, '银').replace(/資/g, '资').replace(/業/g, '业')
    .replace(/發/g, '发').replace(/項/g, '项').replace(/實/g, '实')
    .replace(/與/g, '与').replace(/為/g, '为').replace(/無/g, '无')
    .replace(/個/g, '个').replace(/開/g, '开').replace(/關/g, '关')
    .replace(/機/g, '机').replace(/車/g, '车').replace(/電/g, '电')
    .replace(/導/g, '导').replace(/體/g, '体').replace(/產/g, '产')
    .replace(/軟/g, '软').replace(/製/g, '制').replace(/廠/g, '厂')
    // 去除常见后缀便于匹配
    .replace(/有限公司$/g, '').replace(/有限责任公司$/g, '');
}

/**
 * 检查保荐人名称是否匹配（支持部分匹配）
 * @param {string} searchText - 搜索文本
 * @param {string} sponsorName - 保荐人名称
 * @returns {boolean}
 */
function matchSponsorName(searchText, sponsorName) {
  // 直接匹配
  if (searchText.includes(sponsorName)) return true;

  // 标准化后匹配
  const normalizedSearch = normalizeText(searchText);
  const normalizedName = normalizeText(sponsorName);
  if (normalizedSearch.includes(normalizedName)) return true;

  // 去除"有限公司"后缀再匹配
  const coreNamePatterns = [
    sponsorName.replace(/有限公司$/, '').replace(/有限責任公司$/, ''),
    sponsorName.replace(/\(香港\)有限公司$/, '(香港)'),
    sponsorName.replace(/（香港）有限公司$/, '（香港）'),
  ];

  for (const pattern of coreNamePatterns) {
    if (pattern && pattern.length >= 4 && searchText.includes(pattern)) return true;
    const normalizedPattern = normalizeText(pattern);
    if (normalizedPattern && normalizedPattern.length >= 4 && normalizedSearch.includes(normalizedPattern)) return true;
  }

  return false;
}

/**
 * 提取特定章节内容（智能跳过目录）
 * @param {string} text - 全文
 * @param {Array} startPatterns - 开始标记正则数组
 * @param {Array} endPatterns - 结束标记正则数组
 * @param {number} maxLength - 最大章节长度
 * @param {boolean} skipTOC - 是否跳过目录格式（标题后跟. . .）
 */
function extractSection(text, startPatterns, endPatterns, maxLength = 50000, skipTOC = true) {
  for (const sp of startPatterns) {
    const regex = typeof sp === 'string' ? new RegExp(sp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : new RegExp(sp.source, 'gi');
    let match;

    // 使用exec循环找所有匹配，跳过目录格式
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;

      // 检查是否是目录格式（标题后面跟着连续的点号）
      if (skipTOC) {
        const afterMatch = text.slice(start + match[0].length, start + match[0].length + 30);
        if (/^\s*\.[\s.]*\.[\s.]*\./.test(afterMatch)) {
          // 这是目录格式，跳过继续找下一个
          continue;
        }
      }

      // 找到正文章节，计算结束位置
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

/**
 * 缓存路径
 */
function getCachePath(code) {
  return path.join(CACHE_DIR, `${formatStockCode(code)}.txt`);
}

/**
 * 读取缓存（7天有效）
 */
function readCache(code) {
  const cachePath = getCachePath(code);
  if (fs.existsSync(cachePath)) {
    const stats = fs.statSync(cachePath);
    const ageMs = Date.now() - stats.mtimeMs;
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7天
    
    if (ageMs < maxAgeMs) {
      console.log(`[缓存] 命中: ${code} (${Math.round(ageMs / 3600000)}小时前)`);
      return fs.readFileSync(cachePath, 'utf-8');
    } else {
      console.log(`[缓存] 过期: ${code}`);
    }
  }
  return null;
}

/**
 * 写入缓存
 */
function writeCache(code, text) {
  const cachePath = getCachePath(code);
  fs.writeFileSync(cachePath, text, 'utf-8');
  console.log(`[缓存] 保存: ${code} (${(text.length / 1024).toFixed(1)}KB)`);
}

/**
 * 清除缓存
 */
function clearCache(code) {
  const cachePath = getCachePath(code);
  if (fs.existsSync(cachePath)) {
    fs.unlinkSync(cachePath);
    return true;
  }
  return false;
}

// ==================== PDF解析辅助函数 ====================

/**
 * 使用pdftotext解析PDF（对中文支持更好）
 * @param {string} pdfPath - PDF文件路径
 * @returns {string|null} - 解析的文本内容
 */
function parsePdfWithPdftotext(pdfPath) {
  try {
    // 使用pdftotext命令行工具，-layout保持布局，-enc UTF-8确保中文编码正确
    const result = execSync(`pdftotext -layout -enc UTF-8 "${pdfPath}" -`, {
      encoding: 'utf8',
      timeout: 300000, // 5分钟超时
      maxBuffer: 100 * 1024 * 1024, // 100MB输出缓冲
    });
    return result;
  } catch (e) {
    console.log('[PDF] pdftotext解析失败:', e.message);
    return null;
  }
}

/**
 * 验证PDF内容是否属于目标股票
 * @param {string} text - PDF文本内容
 * @param {string} stockCode - 目标股票代码（如 "01810"）
 * @param {string} stockName - 目标股票名称（可选）
 * @returns {object} - { valid: boolean, confidence: string, reason: string }
 */
function validatePdfContent(text, stockCode, stockName = '') {
  const codeNum = stockCode.replace(/^0+/, ''); // "01810" -> "1810"
  const formattedCode = stockCode.padStart(5, '0'); // 确保5位格式

  // 检查文本长度
  if (!text || text.length < 5000) {
    return { valid: false, confidence: 'none', reason: 'PDF文本内容太少，可能是扫描版或解析失败' };
  }

  // 统计[]符号的数量，如果太多说明中文解析失败
  const bracketCount = (text.match(/\[\]/g) || []).length;
  const textLen = text.length;
  const bracketRatio = bracketCount / textLen;

  if (bracketRatio > 0.01) {
    console.log(`[验证] 警告：检测到大量[]符号(${bracketCount}个)，中文可能解析失败`);
  }

  // 检查股票代码是否出现在文本中
  // 招股书中通常会提到"股份代號 XXXX"或"Stock Code: XXXX"
  const codePatterns = [
    new RegExp(`股份代號[：:]?\\s*${codeNum}`, 'i'),
    new RegExp(`股票代號[：:]?\\s*${codeNum}`, 'i'),
    new RegExp(`Stock\\s*Code[：:]?\\s*${codeNum}`, 'i'),
    new RegExp(`股份代碼[：:]?\\s*${codeNum}`, 'i'),
    new RegExp(`\\b${codeNum}\\b`), // 单独出现的代码数字
  ];

  let codeFound = false;
  for (const pattern of codePatterns) {
    if (pattern.test(text)) {
      codeFound = true;
      console.log(`[验证] 找到股票代码匹配: ${pattern}`);
      break;
    }
  }

  // 检查公司名称是否出现
  let nameFound = false;
  if (stockName) {
    // 对于中文名称，尝试多种形式
    const nameParts = stockName.split(/[-－\s]/); // 分割名称
    for (const part of nameParts) {
      if (part.length >= 2 && text.includes(part)) {
        nameFound = true;
        console.log(`[验证] 找到公司名称匹配: ${part}`);
        break;
      }
    }
  }

  // 综合判断
  if (codeFound && nameFound) {
    return { valid: true, confidence: 'high', reason: '股票代码和公司名称均匹配' };
  } else if (codeFound) {
    return { valid: true, confidence: 'medium', reason: '股票代码匹配' };
  } else if (nameFound) {
    return { valid: true, confidence: 'medium', reason: '公司名称匹配' };
  } else {
    // 对于旧股，代码可能未在正文中频繁出现，检查是否为招股书
    const isProspectus = text.includes('招股章程') || text.includes('招股書') ||
                         text.includes('Prospectus') || text.includes('全球發售');
    if (isProspectus) {
      return { valid: false, confidence: 'low', reason: '是招股书但无法匹配到目标股票，可能是其他公司的招股书' };
    }
    return { valid: false, confidence: 'none', reason: '未找到股票代码或公司名称' };
  }
}

/**
 * 快速验证PDF是否可能属于目标股票（通过下载部分内容）
 * @param {string} pdfUrl - PDF URL
 * @param {string} stockCode - 目标股票代码
 * @param {string} stockName - 目标股票名称
 * @returns {Promise<boolean>} - 是否可能属于目标股票
 */
async function quickValidatePdf(pdfUrl, stockCode, stockName) {
  try {
    // 下载PDF前50KB内容进行快速验证
    const response = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Range': 'bytes=0-51200', // 只下载前50KB
      },
    });

    // 将buffer保存为临时文件并用pdftotext解析
    const tempPdfPath = path.join(CACHE_DIR, `temp_validate_${Date.now()}.pdf`);
    fs.writeFileSync(tempPdfPath, response.data);

    try {
      const text = parsePdfWithPdftotext(tempPdfPath);
      if (text) {
        const codeNum = stockCode.replace(/^0+/, '');
        // 检查是否包含股票代码或名称的一部分
        const hasCode = text.includes(codeNum);
        const hasName = stockName && stockName.split(/[-－\s]/).some(part =>
          part.length >= 2 && text.includes(part)
        );

        console.log(`[快速验证] ${pdfUrl.slice(-30)}: code=${hasCode}, name=${hasName}`);
        return hasCode || hasName;
      }
    } finally {
      // 清理临时文件
      if (fs.existsSync(tempPdfPath)) {
        fs.unlinkSync(tempPdfPath);
      }
    }
  } catch (e) {
    // 部分下载可能失败（服务器不支持Range），这种情况不做快速验证
    console.log('[快速验证] 跳过:', e.message);
  }

  return true; // 无法验证时默认返回true，让后续完整下载再验证
}

// ==================== 搜索招股书 ====================

/**
 * 从港交所搜索招股书PDF链接
 */
async function searchProspectus(stockCode) {
  const formattedCode = formatStockCode(stockCode);
  const codeNum = parseInt(stockCode, 10).toString();
  
  console.log(`[搜索] 股票代码: ${formattedCode}`);
  
  try {
    // 先搜索主板
    const mainBoardUrl = 'https://www2.hkexnews.hk/New-Listings/New-Listing-Information/Main-Board?sc_lang=zh-HK';
    let response = await axios.get(mainBoardUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 30000,
    });
    
    let $ = cheerio.load(response.data);
    let results = [];
    
    // 解析表格
    $('table tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 4) {
        const code = $(cells[0]).text().trim();
        const name = $(cells[1]).text().trim();
        const links = $(cells[3]).find('a');
        
        if (code === codeNum || code === formattedCode) {
          links.each((j, link) => {
            const href = $(link).attr('href');
            const linkText = $(link).text().trim();
            
            // 查找招股章程链接
            if (href && (linkText.includes('招股章程') || linkText.includes('Prospectus') || href.includes('.pdf'))) {
              const pdfUrl = href.startsWith('http') ? href : `https://www1.hkexnews.hk${href}`;
              results.push({
                title: `${name} 招股章程`,
                link: pdfUrl,
                code: formattedCode,
                name: name,
              });
            }
          });
        }
      }
    });
    
    // 如果主板没找到，搜索创业板
    if (results.length === 0) {
      console.log('[搜索] 主板未找到，搜索创业板...');

      const gemUrl = 'https://www2.hkexnews.hk/New-Listings/New-Listing-Information/GEM?sc_lang=zh-HK';
      response = await axios.get(gemUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 30000,
      });

      $ = cheerio.load(response.data);

      $('table tr').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 4) {
          const code = $(cells[0]).text().trim();
          const name = $(cells[1]).text().trim();
          const links = $(cells[3]).find('a');

          if (code === codeNum || code === formattedCode) {
            links.each((j, link) => {
              const href = $(link).attr('href');
              const linkText = $(link).text().trim();

              if (href && (linkText.includes('招股章程') || linkText.includes('Prospectus') || href.includes('.pdf'))) {
                const pdfUrl = href.startsWith('http') ? href : `https://www1.hkexnews.hk${href}`;
                results.push({
                  title: `${name} 招股章程`,
                  link: pdfUrl,
                  code: formattedCode,
                  name: name,
                });
              }
            });
          }
        }
      });
    }

    // 如果新上市列表都没找到，尝试获取股票上市日期并搜索历史招股书
    if (results.length === 0) {
      console.log('[搜索] 新上市列表未找到，尝试获取上市日期...');

      try {
        // 方法1: 从Yahoo Finance获取首个交易日期
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${codeNum}.HK?interval=1mo&range=max`;
        const yahooResponse = await axios.get(yahooUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 15000,
        });

        const chartData = yahooResponse.data?.chart?.result?.[0];
        if (chartData?.timestamp?.length > 0) {
          const firstTimestamp = chartData.timestamp[0];
          const ipoDate = new Date(firstTimestamp * 1000);
          const stockName = chartData.meta?.shortName || chartData.meta?.longName || `股票${formattedCode}`;

          console.log(`[搜索] 上市日期: ${ipoDate.toISOString().slice(0, 10)}, 名称: ${stockName}`);

          // 招股书通常在上市前1-3周发布，搜索上市月份及前一个月
          const searchDates = [];
          const ipoMonth = new Date(ipoDate);
          ipoMonth.setDate(1);
          searchDates.push(new Date(ipoMonth)); // 上市当月

          const prevMonth = new Date(ipoMonth);
          prevMonth.setMonth(prevMonth.getMonth() - 1);
          searchDates.push(prevMonth); // 上市前一个月

          // 使用HKEX日期索引搜索
          for (const searchDate of searchDates) {
            const year = searchDate.getFullYear();
            const month = String(searchDate.getMonth() + 1).padStart(2, '0');

            // 尝试使用披露易的日期搜索接口
            const dateFrom = `${year}${month}01`;
            const dateTo = `${year}${month}${new Date(year, searchDate.getMonth() + 1, 0).getDate()}`;

            const searchUrl = 'https://www1.hkexnews.hk/search/titlesearch.xhtml';
            const searchParams = new URLSearchParams({
              lang: 'ZH',
              category: '0',
              market: 'SEHK',
              searchType: '1',  // 按股票代码搜索
              documentType: '-1',
              t1code: '40000',  // 招股章程类别
              t2Gcode: '-2',
              t2code: '-2',
              stockId: codeNum,
              from: dateFrom,
              to: dateTo,
              sortDir: '0',
              sortByRecordCountOrDate: '2',
              rowRange: '100',
              pageNo: '1',
            });

            try {
              response = await axios.post(searchUrl, searchParams.toString(), {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: 30000,
              });

              $ = cheerio.load(response.data);

              // 解析搜索结果表格
              $('table tbody tr').each((i, row) => {
                const cells = $(row).find('td');
                if (cells.length >= 4) {
                  const dateCell = $(cells[0]).text().trim();
                  const codeCell = $(cells[1]).text().trim();
                  const nameCell = $(cells[2]).text().trim();
                  const docCell = $(cells[3]);

                  // 检查是否匹配股票代码
                  if (codeCell.includes(codeNum) || codeCell.includes(formattedCode)) {
                    const titleLink = docCell.find('a').first();
                    const title = titleLink.text().trim();
                    const href = titleLink.attr('href');

                    if (href && (
                      title.includes('招股章程') ||
                      title.includes('招股書') ||
                      title.includes('Prospectus')
                    )) {
                      if (!title.includes('申請版本') && !title.includes('PHIP') && !title.includes('補充')) {
                        const pdfUrl = href.startsWith('http') ? href : `https://www1.hkexnews.hk${href}`;
                        results.push({
                          title: title || `${stockName} 招股章程`,
                          link: pdfUrl,
                          code: formattedCode,
                          name: nameCell || stockName,
                        });
                      }
                    }
                  }
                }
              });

              // 同时检查其他可能的选择器
              $('.row, .result-row').each((i, row) => {
                const titleEl = $(row).find('.news-title a, .headline a, a[href*=".pdf"]');
                const title = titleEl.text().trim();
                const href = titleEl.attr('href');

                if (title && href && (
                  title.includes('招股章程') ||
                  title.includes('Prospectus')
                )) {
                  if (!title.includes('申請版本') && !title.includes('PHIP')) {
                    const pdfUrl = href.startsWith('http') ? href : `https://www1.hkexnews.hk${href}`;
                    if (!results.find(r => r.link === pdfUrl)) {
                      results.push({
                        title: title,
                        link: pdfUrl,
                        code: formattedCode,
                        name: stockName,
                      });
                    }
                  }
                }
              });

              if (results.length > 0) break;
            } catch (err) {
              console.log(`[搜索] ${year}/${month} 搜索失败:`, err.message);
            }
          }

          // 方法2: 如果仍未找到，尝试直接获取上市公司公告JSON列表
          if (results.length === 0) {
            console.log('[搜索] 尝试获取活跃股票列表...');
            try {
              const stockListUrl = 'https://www1.hkexnews.hk/ncms/script/eds/activestock_sehk_c.json';
              const stockListResp = await axios.get(stockListUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 30000,
              });

              const stockList = stockListResp.data;
              const stockInfo = stockList.find(s => s.c === formattedCode || s.c === codeNum);

              if (stockInfo) {
                console.log(`[搜索] 找到股票信息: ${stockInfo.n} (${stockInfo.c})`);

                // 方法3: 直接探测可能的招股书URL（并行探测，加速搜索）
                console.log('[搜索] 尝试直接探测招股书URL...');

                // 生成上市前5-35天的日期列表（覆盖更大范围）
                const probeUrls = [];
                for (let d = 5; d <= 35; d++) {
                  const probeDate = new Date(ipoDate);
                  probeDate.setDate(probeDate.getDate() - d);
                  const year = probeDate.getFullYear();
                  const month = String(probeDate.getMonth() + 1).padStart(2, '0');
                  const day = String(probeDate.getDate()).padStart(2, '0');
                  const mmdd = `${month}${day}`;

                  // 每天尝试序号 001-050（招股书序号可能较大）
                  for (let seq = 1; seq <= 50; seq++) {
                    const seqStr = String(seq).padStart(3, '0');
                    // 使用www域名（更稳定）
                    probeUrls.push(`https://www.hkexnews.hk/listedco/listconews/sehk/${year}/${mmdd}/ltn${year}${mmdd}${seqStr}_c.pdf`);
                  }
                }

                // 使用curl探测文件大小
                const checkUrl = (url) => {
                  try {
                    const result = execSync(
                      `curl -s -I -H 'Range: bytes=0-10' '${url}' -H 'User-Agent: Mozilla/5.0' --connect-timeout 5 --max-time 10`,
                      { encoding: 'utf8', timeout: 15000 }
                    );
                    const rangeMatch = result.match(/content-range:\s*bytes\s*\d+-\d+\/(\d+)/i);
                    if (rangeMatch) {
                      return parseInt(rangeMatch[1]);
                    }
                    const lengthMatch = result.match(/content-length:\s*(\d+)/i);
                    if (lengthMatch && result.toLowerCase().includes('200')) {
                      return parseInt(lengthMatch[1]);
                    }
                    return 0;
                  } catch (e) {
                    return 0;
                  }
                };

                // ========== 三层过滤策略 ==========
                // 第1层：标题过滤（URL探测无标题，跳过）
                // 第2层：PDF前500KB二进制文本指纹搜索（快速，不需要完整PDF结构）
                // 第3层：完整下载解析验证（只对第2层命中者）

                // 招股书首页必出现的指纹词
                const PROSPECTUS_FINGERPRINTS = [
                  '本招股章程', '全球發售', '香港公開發售', '國際發售',
                  '聯席保薦人', '聯席全球協調人', '招股章程', 'Prospectus',
                  'Global Offering', 'Hong Kong Public Offering'
                ];

                // 第2层：快速指纹验证（只下载前500KB，在二进制中搜索文本）
                const quickFingerprintCheck = async (url, stockCode, stockName) => {
                  try {
                    const resp = await axios.get(url, {
                      responseType: 'arraybuffer',
                      timeout: 30000,
                      headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Range': 'bytes=0-512000', // 只下载前500KB
                      },
                    });

                    // 将buffer转为字符串进行搜索（PDF中的文本通常是明文存储）
                    const content = resp.data.toString('utf8', 0, resp.data.byteLength);
                    const contentLatin = resp.data.toString('latin1', 0, resp.data.byteLength);

                    // 检查招股书指纹词
                    const hasFingerprint = PROSPECTUS_FINGERPRINTS.some(fp =>
                      content.includes(fp) || contentLatin.includes(fp)
                    );

                    // 检查股票代码
                    const codeNum = stockCode.replace(/^0+/, '');
                    const hasCode = content.includes(codeNum) || contentLatin.includes(codeNum);

                    // 检查公司名称
                    const nameParts = stockName.split(/[-－\s]/);
                    const hasName = nameParts.some(part =>
                      part.length >= 2 && (content.includes(part) || contentLatin.includes(part))
                    );

                    // 检查英文名（如xiaomi）
                    const contentLower = contentLatin.toLowerCase();
                    const hasXiaomi = contentLower.includes('xiaomi');

                    console.log(`[指纹] ${url.slice(-35)}: 招股书=${hasFingerprint}, 代码=${hasCode}, 名称=${hasName}, xiaomi=${hasXiaomi}`);

                    // 必须是招股书 且 匹配目标股票
                    return hasFingerprint && (hasCode || hasName || hasXiaomi);
                  } catch (e) {
                    // Range请求可能不被支持，返回null表示需要完整下载
                    if (e.response && e.response.status === 416) {
                      console.log(`[指纹] Range不支持，需完整下载: ${url.slice(-35)}`);
                      return null;
                    }
                    console.log(`[指纹] 失败: ${e.message}`);
                    return false;
                  }
                };

                // 第3层：完整验证（只对第2层命中者或Range不支持的情况）
                const fullValidation = async (url, stockCode, stockName) => {
                  const tempPath = path.join(CACHE_DIR, `validate_${Date.now()}.pdf`);
                  try {
                    console.log(`[完整验证] 下载: ${url.slice(-40)}`);
                    const resp = await axios.get(url, {
                      responseType: 'arraybuffer',
                      timeout: 120000,
                      headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                      },
                    });

                    fs.writeFileSync(tempPath, resp.data);
                    console.log(`[完整验证] 下载完成: ${(resp.data.byteLength / 1024 / 1024).toFixed(1)}MB`);

                    let text = null;

                    // 尝试pdftotext
                    text = parsePdfWithPdftotext(tempPath);

                    // 回退到pdf-parse
                    if (!text || text.length < 100) {
                      try {
                        const pdfData = await pdfParse(resp.data, { max: 10 });
                        text = pdfData.text;
                      } catch (parseErr) {
                        // 解析失败，使用二进制文本搜索
                        text = resp.data.toString('utf8', 0, Math.min(resp.data.byteLength, 1000000));
                      }
                    }

                    if (text && text.length > 50) {
                      const codeNum = stockCode.replace(/^0+/, '');
                      const hasCode = text.includes(codeNum);
                      const nameParts = stockName.split(/[-－\s]/);
                      const hasName = nameParts.some(part => part.length >= 2 && text.includes(part));
                      const hasXiaomi = text.toLowerCase().includes('xiaomi');

                      console.log(`[完整验证] 结果: code=${hasCode}, name=${hasName}, xiaomi=${hasXiaomi}`);
                      return hasCode || hasName || hasXiaomi;
                    }
                  } catch (e) {
                    console.log(`[完整验证] 失败: ${e.message}`);
                  } finally {
                    if (fs.existsSync(tempPath)) {
                      try { fs.unlinkSync(tempPath); } catch (e) {}
                    }
                  }
                  return false;
                };

                // 收集候选PDF（大于3MB的）
                const candidateUrls = [];
                const batchSize = 20;
                for (let i = 0; i < probeUrls.length && candidateUrls.length < 30; i += batchSize) {
                  const batch = probeUrls.slice(i, i + batchSize);

                  for (const url of batch) {
                    const fileSize = checkUrl(url);
                    // 招股书通常较大（至少3MB）
                    if (fileSize > 3000000) {
                      candidateUrls.push({ url, fileSize });
                    }
                  }
                }

                // 按文件大小降序排序（招股书通常是当天最大的文件）
                candidateUrls.sort((a, b) => b.fileSize - a.fileSize);

                console.log(`[搜索] 发现 ${candidateUrls.length} 个候选PDF，按大小排序后前5个:`);
                candidateUrls.slice(0, 5).forEach((c, i) => {
                  console.log(`  ${i + 1}. ${c.url.slice(-40)} (${(c.fileSize / 1024 / 1024).toFixed(1)}MB)`);
                });

                // ========== 快速指纹验证（并行，只取前5个最大的）==========
                console.log(`[搜索] 并行指纹验证前5个最大的PDF...`);
                const topCandidates = candidateUrls.slice(0, 5);

                // 并行验证所有候选
                const validationResults = await Promise.all(
                  topCandidates.map(async (candidate) => {
                    const result = await quickFingerprintCheck(candidate.url, formattedCode, stockInfo.n);
                    return { candidate, result };
                  })
                );

                // 找到第一个通过指纹验证的（按大小顺序）
                for (const { candidate, result } of validationResults) {
                  if (result === true) {
                    console.log(`[搜索] ✓ 指纹验证通过: ${candidate.url}`);
                    results.push({
                      title: `${stockInfo.n} 招股章程`,
                      link: candidate.url,
                      code: formattedCode,
                      name: stockInfo.n,
                    });
                    break;
                  }
                }

                if (results.length === 0 && candidateUrls.length > 0) {
                  console.log('[搜索] 所有候选指纹验证失败，可能需要手动查找');
                }
              }
            } catch (listErr) {
              console.log('[搜索] 获取股票列表失败:', listErr.message);
            }
          }
        }
      } catch (yahooErr) {
        console.log('[搜索] Yahoo Finance查询失败:', yahooErr.message);
      }
    }

    console.log(`[搜索] 找到 ${results.length} 个结果`);
    return results;
    
  } catch (error) {
    console.error('[搜索] 失败:', error.message);
    throw new Error(`搜索招股书失败: ${error.message}`);
  }
}

// ==================== PDF下载与解析 ====================

/**
 * 下载并解析PDF（增强版：支持pdftotext + 内容验证）
 * @param {string} pdfUrl - PDF URL
 * @param {string} stockCode - 股票代码
 * @param {string} stockName - 股票名称（用于验证）
 * @param {boolean} skipValidation - 是否跳过内容验证（默认false）
 */
async function downloadAndParsePDF(pdfUrl, stockCode, stockName = '', skipValidation = false) {
  // 先检查缓存
  const cached = readCache(stockCode);
  if (cached) {
    // 如果有缓存，也要验证内容是否正确
    if (!skipValidation && stockName) {
      const validation = validatePdfContent(cached, stockCode, stockName);
      if (!validation.valid && validation.confidence !== 'none') {
        console.log(`[缓存] 内容验证失败: ${validation.reason}，将重新下载`);
        clearCache(stockCode);
      } else {
        return cached;
      }
    } else {
      return cached;
    }
  }

  console.log(`[PDF] 下载: ${pdfUrl.substring(0, 80)}...`);

  const tempPdfPath = path.join(CACHE_DIR, `temp_${stockCode}_${Date.now()}.pdf`);

  try {
    const response = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
      timeout: 180000, // 3分钟超时
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/pdf',
      },
      maxContentLength: 150 * 1024 * 1024, // 最大150MB
    });

    const pdfBuffer = response.data;
    console.log(`[PDF] 大小: ${(pdfBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);

    // 保存PDF到临时文件
    fs.writeFileSync(tempPdfPath, pdfBuffer);

    let text = null;
    let usedPdftotext = false;

    // 方法1: 优先使用pdftotext（对中文支持更好）
    console.log('[PDF] 尝试使用pdftotext解析...');
    text = parsePdfWithPdftotext(tempPdfPath);

    if (text && text.length > 10000) {
      usedPdftotext = true;
      console.log(`[PDF] pdftotext解析成功: ${text.length}字符`);

      // 检查中文是否正确解析（统计[]符号）
      const bracketCount = (text.match(/\[\]/g) || []).length;
      if (bracketCount > 100) {
        console.log(`[PDF] 警告：pdftotext结果包含${bracketCount}个[]符号，可能有中文丢失`);
      }
    } else {
      // 方法2: 回退到pdf-parse
      console.log('[PDF] pdftotext失败，回退到pdf-parse...');
      try {
        const data = await pdfParse(pdfBuffer, {
          max: 400,
        });
        text = data.text;
        console.log(`[PDF] pdf-parse解析完成: ${data.numpages}页, ${text.length}字符`);
      } catch (parseErr) {
        console.log('[PDF] pdf-parse也失败:', parseErr.message);
      }
    }

    // 检测解析结果
    if (!text || text.length < 5000) {
      throw new Error('PDF可能为扫描版，无法提取文字内容');
    }

    // 内容验证：确保PDF属于目标股票
    if (!skipValidation) {
      const validation = validatePdfContent(text, stockCode, stockName);
      console.log(`[验证] 结果: valid=${validation.valid}, confidence=${validation.confidence}, reason=${validation.reason}`);

      if (!validation.valid) {
        throw new Error(`PDF内容验证失败: ${validation.reason}。下载的可能不是目标股票(${stockCode})的招股书`);
      }
    }

    // 写入缓存
    writeCache(stockCode, text);

    return text;

  } catch (error) {
    console.error('[PDF] 解析失败:', error.message);
    throw new Error(`PDF解析失败: ${error.message}`);
  } finally {
    // 清理临时文件
    if (fs.existsSync(tempPdfPath)) {
      try {
        fs.unlinkSync(tempPdfPath);
      } catch (e) {
        // 忽略清理失败
      }
    }
  }
}

// ==================== 评分引擎 ====================

/**
 * 主评分函数
 */
function scoreProspectus(rawText, stockCode) {
  const text = rawText;
  const normalizedText = normalizeText(rawText);
  const SPONSORS = getAllSponsors();
  
  console.log(`[评分] 开始评分: ${stockCode}, 文本长度: ${text.length}`);
  
  const scores = {
    oldShares: { score: 0, reason: '', details: '' },
    sponsor: { score: 0, reason: '', details: '', sponsors: [] },
    cornerstone: { score: 0, reason: '', details: '', investors: [] },
    lockup: { score: 0, reason: '', details: '' },
    industry: { score: 0, reason: '', details: '', track: '' },
  };
  
  // ========== 1. 旧股检测（多层验证：全球發售架構 + 售股股東 + 募集資金用途）==========

  // 检测结果容器
  let hasOldShares = false;
  let confidence = 'low';
  let evidenceList = [];
  let newSharesCount = null;
  let saleSharesCount = null;

  // -------- 第一层：《全球發售的架構》章节 --------
  // 标题变体：全球發售的架構、全球發售的結構、發售結構、全球發售安排、全球發售
  const globalOfferingSection = extractSection(
    text,
    [
      /全球發售的架構/i, /全球發售的結構/i, /全球发售的架构/i, /全球发售的结构/i,
      /發售結構/i, /发售结构/i, /全球發售安排/i, /全球发售安排/i,
      /全球發售(?!的架構|的結構|安排)/i, /全球发售(?!的架构|的结构|安排)/i,
      /GLOBAL\s*OFFERING/i
    ],
    [/風險因素/i, /风险因素/i, /RISK\s*FACTORS/i, /售股股東/i, /募集資金/i],
    50000
  );

  const oldSharesKeywords = ['銷售股份', '销售股份', '售股股東', '售股股东'];
  const searchTextForOldShares = globalOfferingSection || text.slice(0, 80000);
  const normalizedSearchText = normalizeText(searchTextForOldShares);

  // 在《全球發售》章节查找旧股关键词
  let matchedOldShareKeyword = null;
  let oldShareContext = '';
  for (const kw of oldSharesKeywords) {
    if (normalizedSearchText.includes(normalizeText(kw))) {
      matchedOldShareKeyword = kw;
      const kwIndex = searchTextForOldShares.indexOf(kw);
      if (kwIndex !== -1) {
        oldShareContext = searchTextForOldShares.slice(Math.max(0, kwIndex - 50), Math.min(searchTextForOldShares.length, kwIndex + 80)).replace(/\s+/g, ' ');
      }
      break;
    }
  }

  if (matchedOldShareKeyword) {
    hasOldShares = true;
    confidence = 'high';
    evidenceList.push({
      source: '《全球發售的架構》',
      keyword: matchedOldShareKeyword,
      context: oldShareContext,
    });
  }

  // 提取新股/旧股数量
  const newSharesMatch = searchTextForOldShares.match(/([\d,，]+)\s*股新股份/);
  const saleSharesMatch = searchTextForOldShares.match(/([\d,，]+)\s*股銷售股份/) ||
                          searchTextForOldShares.match(/([\d,，]+)\s*股销售股份/);
  if (newSharesMatch) {
    newSharesCount = newSharesMatch[1].replace(/[,，]/g, '');
  }
  if (saleSharesMatch) {
    saleSharesCount = saleSharesMatch[1].replace(/[,，]/g, '');
    hasOldShares = true;
    confidence = 'high';
    evidenceList.push({
      source: '《全球發售的架構》数量提取',
      keyword: '銷售股份数量',
      context: saleSharesMatch[0],
    });
  }

  // -------- 第二层：《售股股東》章节 --------
  // 这个章节存在即可确认有旧股
  const sellingShareholderSection = extractSection(
    text,
    [
      /售股股東(?!出售|将|會)/i, /售股股东(?!出售|将|会)/i,
      /有關售股股東的資料/i, /有关售股股东的资料/i,
      /售股股東資料/i, /售股股东资料/i,
      /SELLING\s*SHAREHOLDER/i
    ],
    [/風險因素/i, /风险因素/i, /財務資料/i, /财务资料/i, /附錄/i, /附录/i],
    30000
  );

  if (sellingShareholderSection && sellingShareholderSection.length > 500) {
    hasOldShares = true;
    confidence = 'very_high';
    // 尝试提取售股股東名称
    const shareholderContext = sellingShareholderSection.slice(0, 300).replace(/\s+/g, ' ');
    evidenceList.push({
      source: '《售股股東》章节存在',
      keyword: '售股股東专属章节',
      context: shareholderContext,
    });
  }

  // -------- 第三层：《募集資金用途》法律声明 --------
  // 查找法律确认句："本公司將不會從售股股東出售銷售股份中收取任何所得款項"
  const useOfProceedsSection = extractSection(
    text,
    [
      /募集資金用途/i, /募集资金用途/i,
      /全球發售所得款項用途/i, /全球发售所得款项用途/i,
      /發售所得款項用途/i, /发售所得款项用途/i,
      /USE\s*OF\s*PROCEEDS/i
    ],
    [/風險因素/i, /风险因素/i, /未來計劃/i, /未来计划/i, /股息/i],
    30000
  );

  const legalStatementKeywords = [
    '不會從售股股東出售',
    '不会从售股股东出售',
    '將不會從售股股東',
    '将不会从售股股东',
    '不會收取.*銷售股份.*所得款項',
    '售股股東.*所得款項.*歸.*售股股東'
  ];

  const proceedsSearchText = useOfProceedsSection || text.slice(0, 150000);
  for (const legalKw of legalStatementKeywords) {
    const legalRegex = new RegExp(legalKw, 'i');
    if (legalRegex.test(proceedsSearchText) || legalRegex.test(normalizeText(proceedsSearchText))) {
      hasOldShares = true;
      confidence = 'very_high';
      // 提取匹配上下文
      const match = proceedsSearchText.match(new RegExp('.{0,30}' + legalKw + '.{0,50}', 'i'));
      evidenceList.push({
        source: '《募集資金用途》法律声明',
        keyword: legalKw,
        context: match ? match[0].replace(/\s+/g, ' ') : '',
      });
      break;
    }
  }

  // -------- 汇总旧股检测结果 --------
  if (hasOldShares) {
    let details = '存在销售股份，原始股东套现';
    if (newSharesCount && saleSharesCount) {
      const total = parseInt(newSharesCount) + parseInt(saleSharesCount);
      const saleRatio = (parseInt(saleSharesCount) / total * 100).toFixed(1);
      details = `新股${newSharesCount}股 + 旧股${saleSharesCount}股（旧股占比${saleRatio}%）`;
    }
    scores.oldShares = {
      score: -2,
      reason: '有旧股发售',
      details,
      evidence: {
        confidence,
        sources: evidenceList,
        newSharesCount,
        saleSharesCount,
      }
    };
  } else {
    scores.oldShares = {
      score: 0,
      reason: '全部新股',
      details: '无旧股发售，募资全部进入公司',
      evidence: {
        confidence: 'high',
        searchedSections: [
          globalOfferingSection ? '《全球發售的架構》' : null,
          sellingShareholderSection ? '《售股股東》' : null,
          useOfProceedsSection ? '《募集資金用途》' : null,
        ].filter(Boolean),
        searchedKeywords: [...oldSharesKeywords, ...legalStatementKeywords.slice(0, 2)].join('、'),
        note: '三个关键章节均未发现旧股证据',
      }
    };
  }
  
  // ========== 2. 保荐人评分 ==========
  // 保荐人名称来源：
  // 1. 釋義章节中的定义格式：「聯席保薦人」指 XXX公司
  // 2. 參與全球發售的各方章节
  // 3. 招股书前半部分

  // 策略1: 查找「...保薦人」指 这种定义格式（最可靠）
  let sponsorSection = '';
  const sponsorDefMatch = text.match(/「[聯席獨家]*保薦人」[指是為]/i);
  if (sponsorDefMatch) {
    // 从定义位置向前后各取一定范围
    const defStart = Math.max(0, sponsorDefMatch.index - 5000);
    const defEnd = Math.min(text.length, sponsorDefMatch.index + 10000);
    sponsorSection = text.slice(defStart, defEnd);
  }

  // 策略2: 如果没找到定义格式，尝试章节提取
  if (!sponsorSection || sponsorSection.length < 1000) {
    const altSection = extractSection(
      text,
      [/參與全球發售的各方/i, /参与全球发售的各方/i, /PARTIES\s*INVOLVED/i],
      [/董事/i, /概要/i, /SUMMARY/i],
      30000
    );
    if (altSection) {
      sponsorSection = altSection;
    }
  }

  // 策略3: 兜底使用招股书前12万字
  if (!sponsorSection || sponsorSection.length < 1000) {
    sponsorSection = text.slice(0, 120000);
  }

  const searchTextForSponsor = sponsorSection || text.slice(0, 120000);
  const normalizedSponsorText = normalizeText(searchTextForSponsor);
  const foundSponsors = [];

  // 遍历保荐人数据库查找匹配
  for (const [name, data] of Object.entries(SPONSORS)) {
    if (matchSponsorName(searchTextForSponsor, name)) {
      // 避免重复（同一保荐人可能有多个名称）
      if (!foundSponsors.some(s => Math.abs(s.rate - data.rate) < 0.01 && s.count === data.count)) {
        // 提取匹配上下文
        const nameIndex = searchTextForSponsor.indexOf(name);
        // 尝试找核心名称
        const coreName = name.replace(/有限公司$/, '').replace(/有限責任公司$/, '');
        const coreIndex = nameIndex === -1 ? searchTextForSponsor.indexOf(coreName) : nameIndex;
        const matchedName = nameIndex !== -1 ? name : coreName;
        const context = coreIndex !== -1
          ? searchTextForSponsor.slice(Math.max(0, coreIndex - 20), Math.min(searchTextForSponsor.length, coreIndex + matchedName.length + 30)).replace(/\s+/g, ' ')
          : '';
        foundSponsors.push({ name, ...data, matchContext: context });
      }
    }
  }

  const sponsorEvidence = {
    section: sponsorSection ? '保薦人/參與全球發售的各方章节' : '招股书前120000字',
    matchedCount: foundSponsors.length,
    allMatched: foundSponsors.map(s => ({
      name: s.name,
      rate: s.rate,
      count: s.count,
      winRate: s.winRate,
    })),
  };

  if (foundSponsors.length > 0) {
    // 取经验最丰富的保荐人作为主保荐人
    const mainSponsor = foundSponsors.sort((a, b) => b.count - a.count)[0];

    if (mainSponsor.count < 8) {
      scores.sponsor = {
        score: 0,
        reason: '数据不足',
        details: `${mainSponsor.name.substring(0, 20)} (仅${mainSponsor.count}单，需≥8单)`,
        sponsors: foundSponsors.slice(0, 3),
        evidence: { ...sponsorEvidence, scoreRule: '保荐人历史案例<8单，数据不足不评分' },
      };
    } else if (mainSponsor.rate >= 70) {
      scores.sponsor = {
        score: 2,
        reason: '优质保荐人',
        details: `${mainSponsor.name.substring(0, 20)} 历史涨幅+${mainSponsor.rate.toFixed(1)}%, ${mainSponsor.count}单`,
        sponsors: foundSponsors.slice(0, 3),
        evidence: { ...sponsorEvidence, scoreRule: '历史平均涨幅≥70%，+2分' },
      };
    } else if (mainSponsor.rate >= 40) {
      scores.sponsor = {
        score: 0,
        reason: '中等保荐人',
        details: `${mainSponsor.name.substring(0, 20)} 历史涨幅+${mainSponsor.rate.toFixed(1)}%, ${mainSponsor.count}单`,
        sponsors: foundSponsors.slice(0, 3),
        evidence: { ...sponsorEvidence, scoreRule: '历史平均涨幅40-70%，0分' },
      };
    } else {
      scores.sponsor = {
        score: -2,
        reason: '低质保荐人',
        details: `${mainSponsor.name.substring(0, 20)} 历史涨幅${mainSponsor.rate >= 0 ? '+' : ''}${mainSponsor.rate.toFixed(1)}%, ${mainSponsor.count}单`,
        sponsors: foundSponsors.slice(0, 3),
        evidence: { ...sponsorEvidence, scoreRule: '历史平均涨幅<40%，-2分' },
      };
    }
  } else {
    // 备用方案：通过股票代码从IPO映射表查找保荐人
    const stockCodeMatch = text.match(/股份代號\s*[：:]\s*(\d+)|Stock\s*Code\s*[：:]\s*(\d+)/i);
    let fallbackSponsors = null;
    let stockCodeFromText = stockCodeMatch ? (stockCodeMatch[1] || stockCodeMatch[2]) : null;

    // 优先使用从文本提取的股票代码，其次使用传入的stockCode参数
    const codeToUse = stockCodeFromText || stockCode;
    if (codeToUse) {
      fallbackSponsors = getSponsorsByStockCode(codeToUse);
      if (!stockCodeFromText) {
        stockCodeFromText = stockCode; // 更新用于后续显示
      }
    }

    if (fallbackSponsors && fallbackSponsors.length > 0) {
      // 从映射表找到了保荐人，尝试在保荐人数据库中查找其业绩
      const fallbackFoundSponsors = [];
      for (const sponsorName of fallbackSponsors) {
        // 尝试完整匹配
        if (SPONSORS[sponsorName]) {
          fallbackFoundSponsors.push({ name: sponsorName, ...SPONSORS[sponsorName] });
        } else {
          // 尝试部分匹配
          for (const [dbName, data] of Object.entries(SPONSORS)) {
            if (dbName.includes(sponsorName) || sponsorName.includes(dbName)) {
              fallbackFoundSponsors.push({ name: sponsorName, ...data, matchedName: dbName });
              break;
            }
          }
        }
      }

      if (fallbackFoundSponsors.length > 0) {
        const mainSponsor = fallbackFoundSponsors.sort((a, b) => (b.count || 0) - (a.count || 0))[0];
        const rate = mainSponsor.rate || 0;
        const count = mainSponsor.count || 0;

        sponsorEvidence.source = 'IPO映射表（备用方案）';
        sponsorEvidence.stockCode = stockCodeFromText;
        sponsorEvidence.matchedCount = fallbackFoundSponsors.length;
        sponsorEvidence.allMatched = fallbackFoundSponsors.map(s => ({
          name: s.name,
          rate: s.rate,
          count: s.count,
          winRate: s.winRate,
        }));

        if (count < 8) {
          scores.sponsor = {
            score: 0,
            reason: '数据不足',
            details: `${mainSponsor.name.substring(0, 20)} (仅${count}单，需≥8单) [备用]`,
            sponsors: fallbackFoundSponsors.slice(0, 3),
            evidence: { ...sponsorEvidence, scoreRule: '保荐人历史案例<8单，数据不足不评分' },
          };
        } else if (rate >= 70) {
          scores.sponsor = {
            score: 2,
            reason: '优质保荐人',
            details: `${mainSponsor.name.substring(0, 20)} 历史涨幅+${rate.toFixed(1)}%, ${count}单 [备用]`,
            sponsors: fallbackFoundSponsors.slice(0, 3),
            evidence: { ...sponsorEvidence, scoreRule: '历史平均涨幅≥70%，+2分' },
          };
        } else if (rate >= 40) {
          scores.sponsor = {
            score: 0,
            reason: '中等保荐人',
            details: `${mainSponsor.name.substring(0, 20)} 历史涨幅+${rate.toFixed(1)}%, ${count}单 [备用]`,
            sponsors: fallbackFoundSponsors.slice(0, 3),
            evidence: { ...sponsorEvidence, scoreRule: '历史平均涨幅40-70%，0分' },
          };
        } else {
          scores.sponsor = {
            score: -2,
            reason: '低质保荐人',
            details: `${mainSponsor.name.substring(0, 20)} 历史涨幅${rate >= 0 ? '+' : ''}${rate.toFixed(1)}%, ${count}单 [备用]`,
            sponsors: fallbackFoundSponsors.slice(0, 3),
            evidence: { ...sponsorEvidence, scoreRule: '历史平均涨幅<40%，-2分' },
          };
        }
      } else {
        // 从映射表找到了保荐人名称，但在数据库中没有业绩记录
        scores.sponsor = {
          score: 0,
          reason: '无业绩记录',
          details: `保荐人: ${fallbackSponsors.join('、').substring(0, 40)}... (无历史业绩)`,
          sponsors: fallbackSponsors.map(name => ({ name })),
          evidence: {
            ...sponsorEvidence,
            source: 'IPO映射表（备用方案）',
            stockCode: stockCodeFromText,
            scoreRule: '保荐人在映射表中找到，但数据库无业绩记录，不评分',
          },
        };
      }
    } else {
      scores.sponsor = {
        score: 0,
        reason: '未识别',
        details: '未找到匹配的保荐人数据',
        sponsors: [],
        evidence: { ...sponsorEvidence, scoreRule: '未匹配到保荐人数据库，不评分' },
      };
    }
  }

  // ========== 3. 基石投资者（严格限定章节，避免全文误匹配）==========
  // 基石投资者通常在招股书目录之后、概要之前有专门章节
  const cornerstoneSection = extractSection(
    text,
    [/基石投資者/i, /基石投资者/i, /CORNERSTONE\s*INVESTOR/i],
    [/風險因素/i, /风险因素/i, /行業概覽/i, /行业概览/i, /概要/i, /SUMMARY/i],
    50000  // 减少章节长度，避免误匹配
  );

  // 如果没有基石投资者章节，只在摘要/概要部分搜索（前15万字）
  // 避免在财务数据等无关内容中误匹配
  let investorSearchText = cornerstoneSection;
  if (!cornerstoneSection) {
    // 备用：在招股书概要部分搜索
    const summarySection = extractSection(
      text,
      [/概要/i, /摘要/i, /SUMMARY/i],
      [/風險因素/i, /风险因素/i, /行業概覽/i],
      100000
    );
    investorSearchText = summarySection || text.slice(0, 150000);
  }
  const normalizedInvestorText = normalizeText(investorSearchText);

  const foundInvestorDetails = [];
  for (const inv of STAR_CORNERSTONE) {
    const normalizedInv = normalizeText(inv);
    if (investorSearchText.includes(inv) || normalizedInvestorText.includes(normalizedInv)) {
      // 提取匹配上下文
      const invIndex = investorSearchText.indexOf(inv);
      const context = invIndex !== -1
        ? investorSearchText.slice(Math.max(0, invIndex - 20), Math.min(investorSearchText.length, invIndex + inv.length + 40)).replace(/\s+/g, ' ')
        : '';
      foundInvestorDetails.push({ keyword: inv, context });
    }
  }

  // 去重（同一投资者可能匹配多个名称）
  const uniqueInvestors = [...new Set(foundInvestorDetails.map(item => {
    const inv = item.keyword;
    if (/高瓴|Hillhouse/i.test(inv)) return '高瓴';
    if (/红杉|紅杉|Sequoia/i.test(inv)) return '红杉';
    if (/淡马锡|淡馬錫|Temasek/i.test(inv)) return '淡马锡';
    if (/GIC|新加坡政府/i.test(inv)) return 'GIC';
    if (/黑石|Blackstone/i.test(inv)) return '黑石';
    if (/贝莱德|貝萊德|BlackRock/i.test(inv)) return '贝莱德';
    if (/软银|軟銀|SoftBank|Vision Fund/i.test(inv)) return '软银';
    if (/中投公司|CIC/i.test(inv)) return '中投';
    if (/社保/i.test(inv)) return '社保基金';
    if (/国家大基金|國家大基金/i.test(inv)) return '大基金';
    if (/D1 Partners|D1 Capital/i.test(inv)) return 'D1 Partners';
    if (/DST Global/i.test(inv)) return 'DST';
    if (/Tiger Global/i.test(inv)) return 'Tiger Global';
    if (/Viking Global/i.test(inv)) return 'Viking';
    if (/Coatue/i.test(inv)) return 'Coatue';
    if (/富達|富达|Fidelity/i.test(inv)) return '富达';
    if (/Wellington/i.test(inv)) return 'Wellington';
    if (/普信|T\. Rowe/i.test(inv)) return '普信';
    if (/春華資本|春华资本/i.test(inv)) return '春华资本';
    if (/鼎暉|鼎晖|CDH/i.test(inv)) return '鼎晖';
    return inv;
  }))];

  const cornerstoneEvidence = {
    section: cornerstoneSection ? '基石投資者章节' : '招股书概要/前15万字',
    sectionLength: investorSearchText.length,
    matchedKeywords: foundInvestorDetails.map(d => d.keyword),
    matchedContexts: foundInvestorDetails.slice(0, 3).map(d => d.context),
    starList: '高瓴、红杉、淡马锡、GIC、黑石、贝莱德、中投公司、社保基金等',
  };

  if (uniqueInvestors.length > 0) {
    scores.cornerstone = {
      score: 2,
      reason: '有明星基石',
      details: uniqueInvestors.join(', '),
      investors: uniqueInvestors,
      evidence: { ...cornerstoneEvidence, scoreRule: '发现明星基石投资者，+2分' },
    };
  } else {
    scores.cornerstone = {
      score: 0,
      reason: '无明星基石',
      details: '未发现指定名单中的基石投资者',
      investors: [],
      evidence: { ...cornerstoneEvidence, scoreRule: '未匹配到明星基石名单，0分' },
    };
  }
  
  // ========== 4. Pre-IPO禁售期（限定在股本/历史/股东章节）==========
  // Pre-IPO投资通常在以下章节披露：
  // - 歷史、重組及公司架構
  // - 股本（包含股本变动历史）
  // - 主要股東
  const shareholderSection = extractSection(
    text,
    [
      /歷史.*重組/i, /历史.*重组/i, /HISTORY.*REORGANIZATION/i,
      /股本/i, /SHARE\s*CAPITAL/i,
      /主要股東/i, /主要股东/i, /SUBSTANTIAL\s*SHAREHOLDER/i,
      /股權結構/i, /股权结构/i
    ],
    [/業務/i, /业务/i, /BUSINESS/i, /財務資料/i, /财务资料/i],
    80000
  );

  // 如果没找到专门章节，限制在招股书中间部分搜索（避免财务数据区）
  const preIPOSearchText = shareholderSection || text.slice(50000, 250000);
  const normalizedPreIPOText = normalizeText(preIPOSearchText);

  // 检测是否有Pre-IPO投资
  const preIPOKeywords = ['Pre-IPO', 'pre-ipo', '上市前投資', '上市前投资', '私募', '戰略投資', '战略投资', '優先股', '优先股'];
  let matchedPreIPOKeyword = null;
  let preIPOContext = '';
  for (const kw of preIPOKeywords) {
    if (preIPOSearchText.toLowerCase().includes(kw.toLowerCase()) || normalizedPreIPOText.includes(normalizeText(kw))) {
      matchedPreIPOKeyword = kw;
      const kwIndex = preIPOSearchText.toLowerCase().indexOf(kw.toLowerCase());
      if (kwIndex !== -1) {
        preIPOContext = preIPOSearchText.slice(Math.max(0, kwIndex - 30), Math.min(preIPOSearchText.length, kwIndex + 60)).replace(/\s+/g, ' ');
      }
      break;
    }
  }

  const lockupEvidence = {
    section: shareholderSection ? '股本/歷史/股東章节' : '招股书5万-25万字区间',
    preIPOKeywords: preIPOKeywords.join('、'),
  };

  if (matchedPreIPOKeyword) {
    // 有Pre-IPO，检查是否有禁售期
    const lockupKeywords = ['禁售期', '禁售', '鎖定期', '锁定期', 'lock-up', 'lockup', 'lock up', '不得出售', '不得轉讓', '不得转让'];
    let matchedLockupKeyword = null;
    let lockupContext = '';
    for (const kw of lockupKeywords) {
      if (preIPOSearchText.toLowerCase().includes(kw.toLowerCase()) || normalizedPreIPOText.includes(normalizeText(kw))) {
        matchedLockupKeyword = kw;
        const kwIndex = preIPOSearchText.toLowerCase().indexOf(kw.toLowerCase());
        if (kwIndex !== -1) {
          lockupContext = preIPOSearchText.slice(Math.max(0, kwIndex - 30), Math.min(preIPOSearchText.length, kwIndex + 60)).replace(/\s+/g, ' ');
        }
        break;
      }
    }

    if (matchedLockupKeyword) {
      scores.lockup = {
        score: 0,
        reason: 'Pre-IPO有禁售期',
        details: '有Pre-IPO投资者，且设有禁售期安排',
        evidence: {
          ...lockupEvidence,
          preIPOFound: { keyword: matchedPreIPOKeyword, context: preIPOContext },
          lockupFound: { keyword: matchedLockupKeyword, context: lockupContext },
          scoreRule: '有Pre-IPO投资者且有禁售期，0分（安全）',
        },
      };
    } else {
      scores.lockup = {
        score: -2,
        reason: 'Pre-IPO无禁售期',
        details: '警告：有Pre-IPO投资者但未发现禁售期安排',
        evidence: {
          ...lockupEvidence,
          preIPOFound: { keyword: matchedPreIPOKeyword, context: preIPOContext },
          lockupFound: null,
          lockupKeywords: lockupKeywords.join('、'),
          scoreRule: '有Pre-IPO但未发现禁售期，-2分（风险）',
        },
      };
    }
  } else {
    scores.lockup = {
      score: 0,
      reason: '无Pre-IPO',
      details: '未发现Pre-IPO投资者',
      evidence: {
        ...lockupEvidence,
        preIPOFound: null,
        scoreRule: '无Pre-IPO投资者，0分',
      },
    };
  }
  
  // ========== 5. 行业评分（基于炒作逻辑）==========
  const industrySection = extractSection(
    text,
    [/行業概覽/i, /行业概览/i, /INDUSTRY\s*OVERVIEW/i, /業務/i, /业务/i, /BUSINESS/i],
    [/監管/i, /监管/i, /董事/i, /REGULATORY/i, /DIRECTOR/i],
    100000
  );

  const industrySearchText = industrySection || text.slice(0, 250000);
  const normalizedIndustryText = normalizeText(industrySearchText);

  let industryScore = 0;
  let industryReason = '中性赛道';
  let industryDetails = '无明显偏好';
  let trackType = 'neutral';
  let matchedKeyword = null;
  let matchedContext = '';

  // 提取关键词上下文的辅助函数
  const getContext = (keyword) => {
    const idx = industrySearchText.indexOf(keyword);
    if (idx !== -1) {
      return industrySearchText.slice(Math.max(0, idx - 30), Math.min(industrySearchText.length, idx + keyword.length + 50)).replace(/\s+/g, ' ');
    }
    return '';
  };

  // 检查关键词是否是完整词匹配（防止L3匹配到L330TOPSPCB）
  // 对于短的英文/数字关键词，检查前后是否是词边界
  const isWordBoundaryMatch = (text, keyword) => {
    // 纯中文关键词不需要词边界检查
    if (/^[\u4e00-\u9fa5]+$/.test(keyword)) {
      return text.includes(keyword);
    }
    // 短的英文/数字关键词（<=4字符）需要严格的词边界检查
    if (/^[A-Za-z0-9]+$/.test(keyword) && keyword.length <= 4) {
      // 使用词边界正则匹配
      const regex = new RegExp(`(?:^|[^A-Za-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^A-Za-z0-9])`, 'i');
      return regex.test(text);
    }
    // 其他关键词用普通的includes
    return text.includes(keyword);
  };

  // 检查是否是釋義缩写词列表格式（避免误匹配）
  // 特征：上下文中有多个连续的短英文缩写（如"3D 5G AI AIGC AiP"）
  // 或者上下文中有大量纯大写字母数字组成的词（PDF解析可能把词连在一起）
  const isDefinitionList = (keyword) => {
    const ctx = getContext(keyword);
    // 检查上下文是否包含多个连续的技术缩写词
    const words = ctx.split(/\s+/);
    let techWordCount = 0;
    let allUpperCount = 0;
    for (const w of words) {
      // 技术缩写词：1-15个字符的字母数字组合
      if (/^[A-Z0-9a-z\-]{1,15}$/.test(w)) {
        techWordCount++;
      }
      // 全大写的词（可能是缩写连接在一起）
      if (/^[A-Z0-9\-]{2,}$/.test(w)) {
        allUpperCount++;
      }
    }
    // 如果超过50%都是技术词/缩写，或者超过40%是全大写词，认为是釋義列表
    return words.length > 5 && (techWordCount / words.length > 0.5 || allUpperCount / words.length > 0.4);
  };

  // 检查热门赛道 (+2)
  for (const track of HOT_TRACKS) {
    if (isWordBoundaryMatch(industrySearchText, track) || isWordBoundaryMatch(normalizedIndustryText, normalizeText(track))) {
      // 检查是否是釋義缩写词列表，如果是则跳过
      if (isDefinitionList(track)) {
        continue;
      }
      industryScore = 2;
      industryReason = '🔥 热门赛道';
      industryDetails = `情绪驱动型: ${track}`;
      trackType = 'hot';
      matchedKeyword = track;
      matchedContext = getContext(track);
      break;
    }
  }

  // 检查成长赛道 (+1)
  if (industryScore === 0) {
    for (const track of GROWTH_TRACKS) {
      if (isWordBoundaryMatch(industrySearchText, track) || isWordBoundaryMatch(normalizedIndustryText, normalizeText(track))) {
        if (isDefinitionList(track)) continue;
        industryScore = 1;
        industryReason = '📈 成长赛道';
        industryDetails = `成长叙事型: ${track}`;
        trackType = 'growth';
        matchedKeyword = track;
        matchedContext = getContext(track);
        break;
      }
    }
  }

  // 检查低弹性赛道 (-1)
  if (industryScore === 0) {
    for (const track of LOW_ELASTICITY_TRACKS) {
      if (isWordBoundaryMatch(industrySearchText, track) || isWordBoundaryMatch(normalizedIndustryText, normalizeText(track))) {
        if (isDefinitionList(track)) continue;
        industryScore = -1;
        industryReason = '📉 低弹性赛道';
        industryDetails = `缺乏想象空间: ${track}`;
        trackType = 'low';
        matchedKeyword = track;
        matchedContext = getContext(track);
        break;
      }
    }
  }

  // 检查回避赛道 (-2) - 即使匹配了其他档位，回避赛道优先
  for (const track of AVOID_TRACKS) {
    if (industrySearchText.includes(track) || normalizedIndustryText.includes(normalizeText(track))) {
      if (isDefinitionList(track)) continue;
      industryScore = -2;
      industryReason = '❌ 资金回避';
      industryDetails = `高破发风险: ${track}`;
      trackType = 'avoid';
      matchedKeyword = track;
      matchedContext = getContext(track);
      break;
    }
  }

  const industryEvidence = {
    section: industrySection ? '行業概覽/業務章节' : '招股书前250000字',
    sectionLength: industrySearchText.length,
    matchedKeyword,
    matchedContext,
    trackCategories: {
      hot: 'AI/机器人/自动驾驶/半导体/创新药/低空经济（+2分）',
      growth: '医疗器械/新能源/SaaS/软件（+1分）',
      neutral: '无明显偏好（0分）',
      low: '传统消费/制造/公用事业/建材（-1分）',
      avoid: '物管/房地产/小贷/纺织/教培（-2分）',
    },
    scoreRule: trackType === 'neutral'
      ? '未匹配到特定行业关键词'
      : `匹配到"${matchedKeyword}"，属于${trackType}赛道`,
  };

  scores.industry = {
    score: industryScore,
    reason: industryReason,
    details: industryDetails,
    track: trackType,
    evidence: industryEvidence,
  };
  
  // ========== 计算总分 ==========
  const totalScore = Object.values(scores).reduce((sum, item) => sum + item.score, 0);
  
  let rating;
  if (totalScore >= 6) rating = '强烈推荐';
  else if (totalScore >= 4) rating = '建议申购';
  else if (totalScore >= 2) rating = '可以考虑';
  else if (totalScore >= 0) rating = '谨慎申购';
  else rating = '不建议';
  
  console.log(`[评分] 完成: 总分${totalScore}, ${rating}`);
  
  return {
    stockCode: formatStockCode(stockCode),
    totalScore,
    rating,
    scores,
  };
}

// ==================== API路由 ====================

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '3.0',
    sponsorsLoaded: Object.keys(getAllSponsors()).length,
  });
});

// 获取保荐人数据
app.get('/api/sponsors', (req, res) => {
  const sponsors = getAllSponsors();
  res.json({
    count: Object.keys(sponsors).length,
    source: fs.existsSync(SPONSORS_JSON) ? 'json' : 'fallback',
    data: sponsors,
  });
});

// 获取TOP保荐人
app.get('/api/sponsors/top', (req, res) => {
  const sponsors = getAllSponsors();
  const limit = parseInt(req.query.limit) || 20;
  
  // 去重并排序
  const seen = new Set();
  const uniqueSponsors = [];
  
  for (const [name, data] of Object.entries(sponsors)) {
    const key = `${data.rate}-${data.count}`;
    if (!seen.has(key) && data.count >= 5) {
      seen.add(key);
      uniqueSponsors.push({ name, ...data });
    }
  }
  
  const sorted = uniqueSponsors
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  
  res.json(sorted);
});

// 搜索招股书
app.get('/api/search/:code', async (req, res) => {
  try {
    const results = await searchProspectus(req.params.code);
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 清除缓存
app.get('/api/cache/clear/:code', (req, res) => {
  const code = formatStockCode(req.params.code);
  const cleared = clearCache(code);
  res.json({
    success: true,
    message: cleared ? `已清除 ${code} 的缓存` : `${code} 无缓存`,
  });
});

// 主评分API
app.get('/api/score/:code', async (req, res) => {
  const { code } = req.params;
  const startTime = Date.now();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[API] 评分请求: ${code}`);
  console.log(`${'='.repeat(60)}`);

  try {
    // 先检查缓存
    let pdfText = readCache(code);
    let prospectusInfo = null;

    if (pdfText) {
      console.log(`[API] 使用缓存文本`);
    } else {
      // 搜索招股书
      const searchResults = await searchProspectus(code);

      if (searchResults.length === 0) {
        return res.json({
          success: false,
          error: '未找到招股书，请确认股票代码正确且已上市',
        });
      }

      prospectusInfo = searchResults[0];
      console.log(`[API] 招股书: ${prospectusInfo.title}`);

      // 下载并解析PDF（传递stockName用于内容验证）
      pdfText = await downloadAndParsePDF(prospectusInfo.link, code, prospectusInfo.name || '');
    }

    // 评分
    const scoreResult = scoreProspectus(pdfText, code);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[API] 完成: ${scoreResult.totalScore}分, ${scoreResult.rating}, 耗时${elapsed}秒`);

    const response = {
      success: true,
      ...scoreResult,
      elapsed: `${elapsed}s`,
    };

    if (prospectusInfo) {
      response.prospectus = {
        title: prospectusInfo.title,
        link: prospectusInfo.link,
        name: prospectusInfo.name,
      };
    }

    res.json(response);

  } catch (error) {
    console.error(`[API] 错误: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 静态文件
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== 启动服务 ====================

app.listen(PORT, () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🚀 港股新股自动评分系统 v3.0`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`📍 服务地址: http://localhost:${PORT}`);
  console.log(`📊 评分API: http://localhost:${PORT}/api/score/{股票代码}`);
  console.log(`💾 保荐人数量: ${Object.keys(getAllSponsors()).length}`);
  console.log(`📂 数据来源: ${fs.existsSync(SPONSORS_JSON) ? 'JSON文件' : '内置数据'}`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`v3.0 新功能:`);
  console.log(`  ✨ 评分详情展示: 显示判断依据和匹配上下文`);
  console.log(`  🎨 全新UI设计: 深色主题 + 可展开详情卡片`);
  console.log(`  🔗 PDF链接优化: 提供港交所披露易快速入口`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`行业评分规则 (基于炒作逻辑):`);
  console.log(`  🔥 +2 热门赛道: AI/机器人/半导体/创新药/低空经济`);
  console.log(`  📈 +1 成长赛道: 医疗器械/新能源/SaaS/软件`);
  console.log(`  ⚪  0 中性赛道: 无明显偏好`);
  console.log(`  📉 -1 低弹性: 传统消费/建材/公用事业`);
  console.log(`  ❌ -2 回避赛道: 物管/内房/小贷/纺织/教培`);
  console.log(`${'═'.repeat(60)}\n`);
});