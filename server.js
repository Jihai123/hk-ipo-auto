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
  '中投', 'CIC', '社保基金', '全國社保', '全国社保',
  '國家大基金', '国家大基金', '絲路基金', '丝路基金',
  // 知名对冲基金
  'Tiger Global', 'Coatue', 'DST', 'D1', 'Viking',
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
    // 全角转半角
    .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    // 繁简常用字转换
    .replace(/證/g, '证').replace(/國/g, '国').replace(/際/g, '际')
    .replace(/銀/g, '银').replace(/資/g, '资').replace(/業/g, '业')
    .replace(/發/g, '发').replace(/項/g, '项').replace(/實/g, '实')
    .replace(/與/g, '与').replace(/為/g, '为').replace(/無/g, '无')
    .replace(/個/g, '个').replace(/開/g, '开').replace(/關/g, '关')
    .replace(/機/g, '机').replace(/車/g, '车').replace(/電/g, '电')
    .replace(/導/g, '导').replace(/體/g, '体').replace(/產/g, '产')
    .replace(/軟/g, '软').replace(/製/g, '制').replace(/廠/g, '厂');
}

/**
 * 提取特定章节内容
 */
function extractSection(text, startPatterns, endPatterns, maxLength = 50000) {
  for (const sp of startPatterns) {
    const regex = typeof sp === 'string' ? new RegExp(sp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : sp;
    const match = text.match(regex);
    if (match) {
      const start = match.index;
      let end = Math.min(start + maxLength, text.length);
      
      // 查找结束标记
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
    
    console.log(`[搜索] 找到 ${results.length} 个结果`);
    return results;
    
  } catch (error) {
    console.error('[搜索] 失败:', error.message);
    throw new Error(`搜索招股书失败: ${error.message}`);
  }
}

// ==================== PDF下载与解析 ====================

/**
 * 下载并解析PDF
 */
async function downloadAndParsePDF(pdfUrl, stockCode) {
  // 先检查缓存
  const cached = readCache(stockCode);
  if (cached) {
    return cached;
  }
  
  console.log(`[PDF] 下载: ${pdfUrl.substring(0, 80)}...`);
  
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
    
    // 解析PDF，最多400页
    const data = await pdfParse(pdfBuffer, {
      max: 400,
    });
    
    console.log(`[PDF] 解析完成: ${data.numpages}页, ${data.text.length}字符`);
    
    // 检测扫描版PDF
    if (data.text.length < 5000) {
      throw new Error('PDF可能为扫描版，无法提取文字内容');
    }
    
    // 写入缓存
    writeCache(stockCode, data.text);
    
    return data.text;
    
  } catch (error) {
    console.error('[PDF] 解析失败:', error.message);
    throw new Error(`PDF解析失败: ${error.message}`);
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
  
  // ========== 1. 旧股检测（限定在「全球發售」章节）==========
  const globalOfferingSection = extractSection(
    text,
    [/全球發售/i, /全球发售/i, /GLOBAL\s*OFFERING/i],
    [/風險因素/i, /风险因素/i, /RISK\s*FACTORS/i],
    30000
  );

  const oldSharesKeywords = ['銷售股份', '销售股份', '舊股', '旧股', '售股股東', '售股股东', '現有股份', '现有股份'];
  const searchTextForOldShares = globalOfferingSection || normalizedText.slice(0, 50000);
  const normalizedSearchText = normalizeText(searchTextForOldShares);

  // 查找匹配的关键词和上下文
  let matchedOldShareKeyword = null;
  let oldShareContext = '';
  for (const kw of oldSharesKeywords) {
    if (normalizedSearchText.includes(normalizeText(kw))) {
      matchedOldShareKeyword = kw;
      // 提取关键词周围的上下文
      const kwIndex = text.indexOf(kw);
      if (kwIndex !== -1) {
        oldShareContext = text.slice(Math.max(0, kwIndex - 30), Math.min(text.length, kwIndex + 50)).replace(/\s+/g, ' ');
      }
      break;
    }
  }

  if (matchedOldShareKeyword) {
    scores.oldShares = {
      score: -2,
      reason: '有旧股发售',
      details: '存在销售股份/舊股，原始股东套现',
      evidence: {
        keyword: matchedOldShareKeyword,
        context: oldShareContext,
        section: globalOfferingSection ? '全球發售章节' : '招股书前50000字',
      }
    };
  } else {
    scores.oldShares = {
      score: 0,
      reason: '全部新股',
      details: '无旧股发售，募资全部进入公司',
      evidence: {
        keyword: null,
        context: '未找到旧股相关关键词',
        section: globalOfferingSection ? '全球發售章节' : '招股书前50000字',
        searchedKeywords: oldSharesKeywords.join('、'),
      }
    };
  }
  
  // ========== 2. 保荐人评分（限定在特定章节）==========
  const sponsorSection = extractSection(
    text,
    [/保薦人/i, /保荐人/i, /參與全球發售的各方/i, /参与全球发售的各方/i, /PARTIES\s*INVOLVED/i, /SPONSOR/i],
    [/概要/i, /SUMMARY/i, /風險因素/i],
    25000
  );

  const searchTextForSponsor = sponsorSection || text.slice(0, 120000);
  const normalizedSponsorText = normalizeText(searchTextForSponsor);
  const foundSponsors = [];

  // 遍历保荐人数据库查找匹配
  for (const [name, data] of Object.entries(SPONSORS)) {
    const normalizedName = normalizeText(name);
    if (searchTextForSponsor.includes(name) || normalizedSponsorText.includes(normalizedName)) {
      // 避免重复（同一保荐人可能有多个名称）
      if (!foundSponsors.some(s => Math.abs(s.rate - data.rate) < 0.01 && s.count === data.count)) {
        // 提取匹配上下文
        const nameIndex = searchTextForSponsor.indexOf(name);
        const context = nameIndex !== -1
          ? searchTextForSponsor.slice(Math.max(0, nameIndex - 20), Math.min(searchTextForSponsor.length, nameIndex + name.length + 30)).replace(/\s+/g, ' ')
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

    // 如果从文本提取了股票代码，或者有传入的股票代码参数
    if (stockCodeFromText) {
      fallbackSponsors = getSponsorsByStockCode(stockCodeFromText);
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

  // ========== 3. 基石投资者（限定章节）==========
  const cornerstoneSection = extractSection(
    text,
    [/基石投資者/i, /基石投资者/i, /CORNERSTONE\s*INVESTOR/i],
    [/風險因素/i, /风险因素/i, /行業概覽/i, /行业概览/i],
    60000
  );

  const investorSearchText = cornerstoneSection || text;
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
    if (/中投|CIC/i.test(inv)) return '中投';
    if (/社保/i.test(inv)) return '社保基金';
    if (/国家大基金|國家大基金/i.test(inv)) return '大基金';
    return inv;
  }))];

  const cornerstoneEvidence = {
    section: cornerstoneSection ? '基石投資者章节' : '全文搜索',
    sectionLength: investorSearchText.length,
    matchedKeywords: foundInvestorDetails.map(d => d.keyword),
    matchedContexts: foundInvestorDetails.slice(0, 3).map(d => d.context),
    starList: '高瓴、红杉、淡马锡、GIC、黑石、贝莱德、中投、社保基金等',
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
  
  // ========== 4. Pre-IPO禁售期 ==========
  const shareholderSection = extractSection(
    text,
    [/股本/i, /主要股東/i, /主要股东/i, /歷史.*沿革/i, /历史.*沿革/i, /股權結構/i, /股权结构/i],
    [/業務/i, /业务/i, /財務/i, /财务/i],
    80000
  );

  const preIPOSearchText = shareholderSection || text.slice(0, 200000);
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
    section: shareholderSection ? '股本/股權結構章节' : '招股书前200000字',
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

  // 检查热门赛道 (+2)
  for (const track of HOT_TRACKS) {
    if (industrySearchText.includes(track) || normalizedIndustryText.includes(normalizeText(track))) {
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
      if (industrySearchText.includes(track) || normalizedIndustryText.includes(normalizeText(track))) {
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
      if (industrySearchText.includes(track) || normalizedIndustryText.includes(normalizeText(track))) {
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
    // 搜索招股书
    const searchResults = await searchProspectus(code);
    
    if (searchResults.length === 0) {
      return res.json({
        success: false,
        error: '未找到招股书，请确认股票代码正确且已上市',
      });
    }
    
    const prospectus = searchResults[0];
    console.log(`[API] 招股书: ${prospectus.title}`);
    
    // 下载并解析PDF
    const pdfText = await downloadAndParsePDF(prospectus.link, code);
    
    // 评分
    const scoreResult = scoreProspectus(pdfText, code);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[API] 完成: ${scoreResult.totalScore}分, ${scoreResult.rating}, 耗时${elapsed}秒`);
    
    res.json({
      success: true,
      prospectus: {
        title: prospectus.title,
        link: prospectus.link,
        name: prospectus.name,
      },
      ...scoreResult,
      elapsed: `${elapsed}s`,
    });
    
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