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

// ==================== V5 新增：etnet 爬虫模块 ====================
const { crawlIPODetail }      = require('./crawlers/etnet/ipoDetail');
const { buildIndustryCodeMap } = require('./crawlers/etnet/industryCodeMap');
const { getComparablePE }     = require('./crawlers/etnet/industryPE');
const { crawlIPOListFromETNet } = require('./crawlers/etnet/ipoList');

const app = express();
const PORT = process.env.PORT || 3010;
const IPO_DEBUG = process.env.IPO_DEBUG === '1';

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
  // ========== 主要保荐人（完整名称 - 繁体，匹配招股书）==========
  // 按总项目数降序排列
  
  // TOP 20 大型保荐人
  '中國國際金融香港證券有限公司': { rate: 25.0, count: 238, winRate: 48.74, upCount: 116, downCount: null },
  '摩根士丹利亞洲有限公司': { rate: 45.0, count: 141, winRate: 64.54, upCount: 91, downCount: null },
  '高盛(亞洲)有限責任公司': { rate: 35.0, count: 114, winRate: 50.88, upCount: 58, downCount: null },
  '海通國際資本有限公司': { rate: 55.0, count: 93, winRate: 63.44, upCount: 59, downCount: null },
  '建銀國際金融有限公司': { rate: 30.0, count: 80, winRate: 48.75, upCount: 39, downCount: null },
  '國泰君安融資有限公司': { rate: 50.0, count: 79, winRate: 64.56, upCount: 51, downCount: null },
  '華泰金融控股(香港)有限公司': { rate: 35.0, count: 73, winRate: 50.68, upCount: 37, downCount: null },
  '花旗環球金融亞洲有限公司': { rate: 32.0, count: 70, winRate: 48.57, upCount: 34, downCount: null },
  '瑞銀證券香港有限公司': { rate: 25.0, count: 64, winRate: 40.63, upCount: 26, downCount: null },
  '中信里昂證券資本市場有限公司': { rate: 30.0, count: 59, winRate: 47.46, upCount: 28, downCount: null },
  '招銀國際融資有限公司': { rate: 50.0, count: 56, winRate: 60.71, upCount: 34, downCount: null },
  '摩根大通證券(遠東)有限公司': { rate: 28.0, count: 53, winRate: 41.51, upCount: 22, downCount: null },
  '中信證券(香港)有限公司': { rate: 60.0, count: 50, winRate: 76.00, upCount: 38, downCount: null },
  '美林遠東有限公司': { rate: 50.0, count: 48, winRate: 62.50, upCount: 30, downCount: null },
  '中信建投(國際)融資有限公司': { rate: 45.0, count: 47, winRate: 55.32, upCount: 26, downCount: null },
  '農銀國際融資有限公司': { rate: 42.0, count: 46, winRate: 52.17, upCount: 24, downCount: null },
  '中銀國際亞洲有限公司': { rate: 40.0, count: 45, winRate: 51.11, upCount: 23, downCount: null },
  '招商證券(香港)有限公司': { rate: 50.0, count: 41, winRate: 63.41, upCount: 26, downCount: null },
  '豐盛融資有限公司': { rate: 70.0, count: 41, winRate: 82.93, upCount: 34, downCount: null },
  '瑞士信貸(香港)有限公司': { rate: 50.0, count: 41, winRate: 60.98, upCount: 25, downCount: null },
  
  // 21-40名
  '中國光大融資有限公司': { rate: 50.0, count: 40, winRate: 62.50, upCount: 25, downCount: null },
  '交銀國際(亞洲)有限公司': { rate: 40.0, count: 39, winRate: 51.28, upCount: 20, downCount: null },
  '法國巴黎證券(亞洲)有限公司': { rate: 22.0, count: 34, winRate: 38.24, upCount: 13, downCount: null },
  '創升融資有限公司': { rate: 55.0, count: 33, winRate: 69.70, upCount: 23, downCount: null },
  '匯富融資有限公司': { rate: 55.0, count: 30, winRate: 70.00, upCount: 21, downCount: null },
  '香港上海滙豐銀行有限公司': { rate: 25.0, count: 28, winRate: 39.29, upCount: 11, downCount: null },
  '麥格理資本股份有限公司': { rate: 30.0, count: 26, winRate: 46.15, upCount: 12, downCount: null },
  '工銀國際融資有限公司': { rate: 50.0, count: 24, winRate: 62.50, upCount: 15, downCount: null },
  '信達國際融資有限公司': { rate: 45.0, count: 24, winRate: 58.33, upCount: 14, downCount: null },
  '力高企業融資有限公司': { rate: 50.0, count: 24, winRate: 62.50, upCount: 15, downCount: null },
  '大有融資有限公司': { rate: 75.0, count: 24, winRate: 87.50, upCount: 21, downCount: null },
  '德健融資有限公司': { rate: 65.0, count: 24, winRate: 79.17, upCount: 19, downCount: null },
  '申萬宏源融資(香港)有限公司': { rate: 50.0, count: 22, winRate: 63.64, upCount: 14, downCount: null },
  '德意志證券亞洲有限公司': { rate: 40.0, count: 21, winRate: 52.38, upCount: 11, downCount: null },
  '同人融資有限公司': { rate: 65.0, count: 21, winRate: 76.19, upCount: 16, downCount: null },
  '瑞士銀行香港分行': { rate: 30.0, count: 21, winRate: 47.62, upCount: 10, downCount: null },
  '廣發融資(香港)有限公司': { rate: 60.0, count: 19, winRate: 73.68, upCount: 14, downCount: null },
  '美林(亞太)有限公司': { rate: 22.0, count: 18, winRate: 38.89, upCount: 7, downCount: null },
  '摩根大通證券(亞太)有限公司': { rate: 35.0, count: 18, winRate: 50.00, upCount: 9, downCount: null },
  '派杰亞洲有限公司': { rate: 48.0, count: 18, winRate: 61.11, upCount: 11, downCount: null },
  
  // 41-60名
  '富比資本有限公司': { rate: 55.0, count: 16, winRate: 68.75, upCount: 11, downCount: null },
  '浩德融資有限公司': { rate: 60.0, count: 16, winRate: 75.00, upCount: 12, downCount: null },
  '巧益融資有限公司': { rate: 28.0, count: 16, winRate: 43.75, upCount: 7, downCount: null },
  '民銀資本有限公司': { rate: 50.0, count: 16, winRate: 62.50, upCount: 10, downCount: null },
  '德意志銀行香港分行': { rate: 42.0, count: 16, winRate: 56.25, upCount: 9, downCount: null },
  '富通金融資本有限公司': { rate: 42.0, count: 16, winRate: 56.25, upCount: 9, downCount: null },
  '中國銀河國際證券(香港)有限公司': { rate: 75.0, count: 15, winRate: 86.67, upCount: 13, downCount: null },
  '星展亞洲融資有限公司': { rate: 32.0, count: 15, winRate: 46.67, upCount: 7, downCount: null },
  '西證(香港)融資有限公司': { rate: 55.0, count: 13, winRate: 69.23, upCount: 9, downCount: null },
  '鎧盛資本有限公司': { rate: 45.0, count: 13, winRate: 61.54, upCount: 8, downCount: null },
  '創升國際有限公司': { rate: 55.0, count: 13, winRate: 69.23, upCount: 9, downCount: null },
  '中信證券融資(香港)有限公司': { rate: 45.0, count: 13, winRate: 61.54, upCount: 8, downCount: null },
  '富瑞金融集團香港有限公司': { rate: 28.0, count: 12, winRate: 41.67, upCount: 5, downCount: null },
  '華富嘉洛企業融資有限公司': { rate: 80.0, count: 12, winRate: 91.67, upCount: 11, downCount: null },
  '東興證券(香港)有限公司': { rate: 42.0, count: 12, winRate: 58.33, upCount: 7, downCount: null },
  '天財資本國際有限公司': { rate: 70.0, count: 12, winRate: 83.33, upCount: 10, downCount: null },
  '中泰國際融資有限公司': { rate: 22.0, count: 11, winRate: 36.36, upCount: 4, downCount: null },
  '第一上海融資有限公司': { rate: 38.0, count: 11, winRate: 54.55, upCount: 6, downCount: null },
  '南華融資有限公司': { rate: 65.0, count: 10, winRate: 80.00, upCount: 8, downCount: null },
  '安信融資(香港)有限公司': { rate: 18.0, count: 10, winRate: 30.00, upCount: 3, downCount: null },
  
  // 61-80名
  '中國平安資本(香港)有限公司': { rate: 55.0, count: 9, winRate: 66.67, upCount: 6, downCount: null },
  '浦銀國際融資有限公司': { rate: 32.0, count: 9, winRate: 44.44, upCount: 4, downCount: null },
  '紅杉資本有限公司': { rate: 15.0, count: 9, winRate: 22.22, upCount: 2, downCount: null },
  '建泉融資有限公司': { rate: 32.0, count: 9, winRate: 44.44, upCount: 4, downCount: null },
  '智富融資有限公司': { rate: 40.0, count: 9, winRate: 55.56, upCount: 5, downCount: null },
  '六福金融(香港)有限公司': { rate: 50.0, count: 9, winRate: 62.50, upCount: 5, downCount: null },
  '誠高融資有限公司': { rate: 35.0, count: 8, winRate: 50.00, upCount: 4, downCount: null },
  '六證國際融資有限公司': { rate: 35.0, count: 8, winRate: 50.00, upCount: 4, downCount: null },
  '百銀萬國融資(香港)有限公司': { rate: 60.0, count: 8, winRate: 75.00, upCount: 6, downCount: null },
  '興業金融融資有限公司': { rate: 42.0, count: 7, winRate: 57.14, upCount: 4, downCount: null },
  '終經資本有限公司': { rate: 70.0, count: 7, winRate: 85.71, upCount: 6, downCount: null },
  '八五金融有限公司': { rate: 70.0, count: 7, winRate: 85.71, upCount: 6, downCount: null },
  '凱基金融亞洲有限公司': { rate: 70.0, count: 7, winRate: 85.71, upCount: 6, downCount: null },
  '國金證券(香港)有限公司': { rate: 30.0, count: 7, winRate: 42.86, upCount: 3, downCount: null },
  '華高和升財務顧問有限公司': { rate: 30.0, count: 7, winRate: 42.86, upCount: 3, downCount: null },
  '野村國際(香港)有限公司': { rate: 10.0, count: 6, winRate: 16.67, upCount: 1, downCount: null },
  '聯昌證券有限公司': { rate: 55.0, count: 6, winRate: 66.67, upCount: 4, downCount: null },
  '力泰金融服務有限公司': { rate: 70.0, count: 6, winRate: 83.33, upCount: 5, downCount: null },
  '中匯資本有限公司': { rate: 65.0, count: 5, winRate: 80.00, upCount: 4, downCount: null },
  '光銀國際資本有限公司': { rate: 45.0, count: 5, winRate: 60.00, upCount: 3, downCount: null },
  
  // 81-100名
  '上銀國際有限公司': { rate: 65.0, count: 5, winRate: 80.00, upCount: 4, downCount: null },
  '長江證券融資(香港)有限公司': { rate: 45.0, count: 5, winRate: 60.00, upCount: 3, downCount: null },
  '金利豐財務顧問有限公司': { rate: 85.0, count: 4, winRate: 100.00, upCount: 4, downCount: null },
  '里昂證券資本市場有限公司': { rate: 55.0, count: 4, winRate: 75.00, upCount: 3, downCount: null },
  '鼎佩證券有限公司': { rate: 35.0, count: 4, winRate: 50.00, upCount: 2, downCount: null },
  '耀盛資本有限公司': { rate: 85.0, count: 4, winRate: 100.00, upCount: 4, downCount: null },
  '國元融資(香港)有限公司': { rate: 55.0, count: 4, winRate: 75.00, upCount: 3, downCount: null },
  '大唐融資有限公司': { rate: 85.0, count: 4, winRate: 100.00, upCount: 4, downCount: null },
  '冶和證券(香港)有限公司': { rate: 15.0, count: 4, winRate: 25.00, upCount: 1, downCount: null },
  '華匯證券(香港)有限公司': { rate: 35.0, count: 4, winRate: 50.00, upCount: 2, downCount: null },
  '有銀證券(香港)有限公司': { rate: 85.0, count: 4, winRate: 100.00, upCount: 4, downCount: null },
  '方富財務有限公司': { rate: 85.0, count: 4, winRate: 100.00, upCount: 4, downCount: null },
  '時富融資有限公司': { rate: 55.0, count: 4, winRate: 75.00, upCount: 3, downCount: null },
  '博匯融資有限公司': { rate: 15.0, count: 4, winRate: 25.00, upCount: 1, downCount: null },
  '新利融資有限公司': { rate: 85.0, count: 3, winRate: 100.00, upCount: 3, downCount: null },
  '匯盈證券有限公司': { rate: 22.0, count: 3, winRate: 33.33, upCount: 1, downCount: null },
  '東亞亞洲有限公司': { rate: 55.0, count: 3, winRate: 66.67, upCount: 2, downCount: null },
  '中國海通企業融資有限公司': { rate: 85.0, count: 3, winRate: 100.00, upCount: 3, downCount: null },
  '聯旺有限公司': { rate: 55.0, count: 3, winRate: 66.67, upCount: 2, downCount: null },
  '大新融資(香港)有限公司': { rate: 28.0, count: 3, winRate: 33.33, upCount: 1, downCount: null },
  
  // 101-116名
  '新輝資本有限公司': { rate: 85.0, count: 3, winRate: 100.00, upCount: 3, downCount: null },
  '懷生有限公司': { rate: 0.0, count: 2, winRate: 0.00, upCount: 0, downCount: null },
  '麥格理證券股份有限公司': { rate: 35.0, count: 2, winRate: 50.00, upCount: 1, downCount: null },
  '花旗融資有限公司': { rate: 35.0, count: 2, winRate: 50.00, upCount: 1, downCount: null },
  '中信證券融資有限公司': { rate: 35.0, count: 2, winRate: 50.00, upCount: 1, downCount: null },
  '建銀環球金融有限公司': { rate: 35.0, count: 2, winRate: 50.00, upCount: 1, downCount: null },
  '招商證券有限公司': { rate: 0.0, count: 2, winRate: 0.00, upCount: 0, downCount: null },
  '創銀證券有限公司': { rate: 35.0, count: 2, winRate: 50.00, upCount: 1, downCount: null },
  '古川國際融資有限公司': { rate: 0.0, count: 2, winRate: 0.00, upCount: 0, downCount: null },
  '白鯨企業有限公司': { rate: 85.0, count: 2, winRate: 100.00, upCount: 2, downCount: null },
  '青企企業融資有限公司': { rate: 0.0, count: 2, winRate: 0.00, upCount: 0, downCount: null },

  // ========== 简称映射（繁体）==========
  '中金': { rate: 25.0, count: 238, winRate: 48.74 },
  '中金公司': { rate: 25.0, count: 238, winRate: 48.74 },
  '中國國際金融': { rate: 25.0, count: 238, winRate: 48.74 },
  'CICC': { rate: 25.0, count: 238, winRate: 48.74 },
  '中信': { rate: 60.0, count: 50, winRate: 76.00 },
  '中信證券': { rate: 60.0, count: 50, winRate: 76.00 },
  '中信里昂': { rate: 30.0, count: 59, winRate: 47.46 },
  '華泰': { rate: 35.0, count: 73, winRate: 50.68 },
  '華泰金融': { rate: 35.0, count: 73, winRate: 50.68 },
  '高盛': { rate: 35.0, count: 114, winRate: 50.88 },
  'Goldman': { rate: 35.0, count: 114, winRate: 50.88 },
  '摩根士丹利': { rate: 45.0, count: 141, winRate: 64.54 },
  'Morgan Stanley': { rate: 45.0, count: 141, winRate: 64.54 },
  '大摩': { rate: 45.0, count: 141, winRate: 64.54 },
  '海通': { rate: 55.0, count: 93, winRate: 63.44 },
  '海通國際': { rate: 55.0, count: 93, winRate: 63.44 },
  '瑞銀': { rate: 25.0, count: 64, winRate: 40.63 },
  'UBS': { rate: 25.0, count: 64, winRate: 40.63 },
  '國泰君安': { rate: 50.0, count: 79, winRate: 64.56 },
  '建銀國際': { rate: 30.0, count: 80, winRate: 48.75 },
  '招銀國際': { rate: 50.0, count: 56, winRate: 60.71 },
  '招商證券': { rate: 50.0, count: 41, winRate: 63.41 },
  '招商': { rate: 50.0, count: 41, winRate: 63.41 },
  '花旗': { rate: 32.0, count: 70, winRate: 48.57 },
  'Citi': { rate: 32.0, count: 70, winRate: 48.57 },
  '廣發': { rate: 60.0, count: 19, winRate: 73.68 },
  '農銀國際': { rate: 42.0, count: 46, winRate: 52.17 },
  '交銀國際': { rate: 40.0, count: 39, winRate: 51.28 },
  '工銀國際': { rate: 50.0, count: 24, winRate: 62.50 },
  '申萬宏源': { rate: 50.0, count: 22, winRate: 63.64 },
  '中銀國際': { rate: 40.0, count: 45, winRate: 51.11 },
  '光大': { rate: 50.0, count: 40, winRate: 62.50 },
  '摩根大通': { rate: 28.0, count: 53, winRate: 41.51 },
  'J.P. Morgan': { rate: 28.0, count: 53, winRate: 41.51 },
  'JPMorgan': { rate: 28.0, count: 53, winRate: 41.51 },
  '小摩': { rate: 28.0, count: 53, winRate: 41.51 },
  '中信建投': { rate: 45.0, count: 47, winRate: 55.32 },
  '東方證券': { rate: 42.0, count: 12, winRate: 58.33 },
  '興證國際': { rate: 42.0, count: 12, winRate: 58.33 },
  '國信證券': { rate: 45.0, count: 13, winRate: 61.54 },
  '長江證券': { rate: 45.0, count: 5, winRate: 60.00 },
  '方正證券': { rate: 35.0, count: 4, winRate: 50.00 },
  '豐盛': { rate: 70.0, count: 41, winRate: 82.93 },
  '創升': { rate: 55.0, count: 33, winRate: 69.70 },
  '大有': { rate: 75.0, count: 24, winRate: 87.50 },
  '德健': { rate: 65.0, count: 24, winRate: 79.17 },
  '同人': { rate: 65.0, count: 21, winRate: 76.19 },
  '派杰': { rate: 48.0, count: 18, winRate: 61.11 },
  '浩德': { rate: 60.0, count: 16, winRate: 75.00 },
  '華富嘉洛': { rate: 80.0, count: 12, winRate: 91.67 },
  '天財資本': { rate: 70.0, count: 12, winRate: 83.33 },
  '南華': { rate: 65.0, count: 10, winRate: 80.00 },
  '中國銀河': { rate: 75.0, count: 15, winRate: 86.67 },
  '星展': { rate: 32.0, count: 15, winRate: 46.67 },
  '西證': { rate: 55.0, count: 13, winRate: 69.23 },
  '鎧盛': { rate: 45.0, count: 13, winRate: 61.54 },
  '終經': { rate: 70.0, count: 7, winRate: 85.71 },
  '八五金融': { rate: 70.0, count: 7, winRate: 85.71 },
  '凱基': { rate: 70.0, count: 7, winRate: 85.71 },
  '野村': { rate: 10.0, count: 6, winRate: 16.67 },
  '聯昌': { rate: 55.0, count: 6, winRate: 66.67 },
  '力泰': { rate: 70.0, count: 6, winRate: 83.33 },
  '金利豐': { rate: 85.0, count: 4, winRate: 100.00 },
  '耀盛': { rate: 85.0, count: 4, winRate: 100.00 },
  '大唐': { rate: 85.0, count: 4, winRate: 100.00 },
  '新利': { rate: 85.0, count: 3, winRate: 100.00 },
  '新輝': { rate: 85.0, count: 3, winRate: 100.00 },
  '白鯨': { rate: 85.0, count: 2, winRate: 100.00 },

  // ========== 简称映射（简体）==========
  '中信证券': { rate: 60.0, count: 50, winRate: 76.00 },
  '华泰': { rate: 35.0, count: 73, winRate: 50.68 },
  '海通国际': { rate: 55.0, count: 93, winRate: 63.44 },
  '瑞银': { rate: 25.0, count: 64, winRate: 40.63 },
  '国泰君安': { rate: 50.0, count: 79, winRate: 64.56 },
  '建银国际': { rate: 30.0, count: 80, winRate: 48.75 },
  '招银国际': { rate: 50.0, count: 56, winRate: 60.71 },
  '招商证券': { rate: 50.0, count: 41, winRate: 63.41 },
  '广发': { rate: 60.0, count: 19, winRate: 73.68 },
  '农银国际': { rate: 42.0, count: 46, winRate: 52.17 },
  '交银国际': { rate: 40.0, count: 39, winRate: 51.28 },
  '工银国际': { rate: 50.0, count: 24, winRate: 62.50 },
  '申万宏源': { rate: 50.0, count: 22, winRate: 63.64 },
  '中银国际': { rate: 40.0, count: 45, winRate: 51.11 },
  '民银资本': { rate: 50.0, count: 16, winRate: 62.50 },
  '摩根大通': { rate: 28.0, count: 53, winRate: 41.51 },
  '中信建投': { rate: 45.0, count: 47, winRate: 55.32 },
  '东方证券': { rate: 42.0, count: 12, winRate: 58.33 },
  '兴证国际': { rate: 42.0, count: 12, winRate: 58.33 },
  '国信证券': { rate: 45.0, count: 13, winRate: 61.54 },
  '长江证券': { rate: 45.0, count: 5, winRate: 60.00 },
  '方正证券': { rate: 35.0, count: 4, winRate: 50.00 },
  '丰盛': { rate: 70.0, count: 41, winRate: 82.93 },
  '创升': { rate: 55.0, count: 33, winRate: 69.70 },
  '德健': { rate: 65.0, count: 24, winRate: 79.17 },
  '南华': { rate: 65.0, count: 10, winRate: 80.00 },
  '中国银河': { rate: 75.0, count: 15, winRate: 86.67 },
  '西证': { rate: 55.0, count: 13, winRate: 69.23 },
  '终经': { rate: 70.0, count: 7, winRate: 85.71 },
  '凯基': { rate: 70.0, count: 7, winRate: 85.71 },
  '野村': { rate: 10.0, count: 6, winRate: 16.67 },
  '联昌': { rate: 55.0, count: 6, winRate: 66.67 },
  '力泰': { rate: 70.0, count: 6, winRate: 83.33 },
  '金利丰': { rate: 85.0, count: 4, winRate: 100.00 },
  '耀盛': { rate: 85.0, count: 4, winRate: 100.00 },
  '新辉': { rate: 85.0, count: 3, winRate: 100.00 },
  '白鲸': { rate: 85.0, count: 2, winRate: 100.00 },
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

// ==================== 行业识别引擎 v3（标题权重 + 关键词密度）====================
/**
 * 行业评分规则:
 * +2 情绪驱动型热门赛道：强题材、资金愿意炒、FOMO情绪
 * +1 成长叙事型赛道：有故事但热度一般
 *  0 中性赛道：无明显偏好
 * -1 低弹性赛道：缺乏想象空间
 * -2 资金回避型赛道：破发率高、监管风险
 *
 * 识别算法（五步骤）：
 * Step 1  从章节标题提取行业名（正则匹配"XXX行业/市场/产业"）→ 每次命中 ×5
 * Step 2  统计全文各类别关键词出现总频次 → 每次出现 ×1
 * Step 3  关键词归一化到标准行业类别（MCU→半导体, SaaS→软件服务 等）
 * Step 4  多行业并存时按置信度得分（titleMatches×5 + kwCount×1）竞争
 * Step 5  得分最高者为主导行业，映射到赛道评分（-2 ~ +2）
 *
 * 每个定义包含:
 *   name          标准行业名称
 *   trackScore    赛道得分（-2/-1/0/+1/+2）
 *   trackType     赛道类型（hot/growth/neutral/low/avoid）
 *   trackReason   展示原因
 *   trackDetails  展示详情
 *   priority      同分时优先级（数字越大越优先）
 *   keywords      关键词列表（含简繁体双版本）—— 均贡献到本类别得分
 */
const INDUSTRY_DEFS = [
  // ───── +2 热门赛道 ─────
  {
    name: '半导体/芯片',
    trackScore: 2, trackType: 'hot',
    trackReason: '🔥 热门赛道', trackDetails: '情绪驱动型: 半导体/芯片',
    priority: 100,
    keywords: [
      // MCU/SoC/GPU类
      'MCU','SoC','ASIC','GPU','FPGA','EDA',
      // 芯片/晶圆
      '芯片','晶片','晶圓','晶圆','半導體','半导体',
      // 集成电路/IC
      '集成電路','集成电路','IC設計','IC设计',
      // MCU别名
      '微控制器','微控制單元','微控制单元',
      // 制造模式
      'Fabless','IDM',
      // 封装
      '封裝測試','封装测试','先進封裝','先进封装',
      // 功率/模拟/射频
      '功率半導體','功率半导体','模擬芯片','模拟芯片','射頻芯片','射频芯片',
      // 存储
      '存儲芯片','存储芯片','內存芯片','内存芯片','NAND','DRAM','SRAM','HBM',
      // 接口/互联
      'DDR5','PCIe','CXL','SerDes','CPO',
      'AI芯片','AI晶片',
      '高速互連','高速互联','互連芯片','互联芯片',
      '國產替代','国产替代',
    ],
  },
  {
    name: 'AI/人工智能',
    trackScore: 2, trackType: 'hot',
    trackReason: '🔥 热门赛道', trackDetails: '情绪驱动型: AI/人工智能',
    priority: 90,
    keywords: [
      '人工智能','人工智慧','大模型','大語言模型','大语言模型',
      'LLM','GPT','AIGC',
      '算力','算力租賃','算力租赁','智算中心','液冷',
      '光模塊','光模块',
      '機器學習','机器学习','深度學習','深度学习',
      'AI應用','AI应用',
    ],
  },
  {
    name: '机器人/自动驾驶',
    trackScore: 2, trackType: 'hot',
    trackReason: '🔥 热门赛道', trackDetails: '情绪驱动型: 机器人/自动驾驶',
    priority: 85,
    keywords: [
      '機器人','机器人','人形機器人','人形机器人','具身智能',
      '機器人關節','機器人減速器',
      '自動駕駛','自动驾驶','智能駕駛','智能驾驶',
      '車聯網','车联网','Robotaxi',
    ],
  },
  {
    name: '低空经济/航天',
    trackScore: 2, trackType: 'hot',
    trackReason: '🔥 热门赛道', trackDetails: '情绪驱动型: 低空经济/航天',
    priority: 80,
    keywords: [
      '低空經濟','低空经济','eVTOL','飛行汽車','飞行汽车',
      '无人机','UAV',
      '衛星互聯網','卫星互联网','商业航天',
    ],
  },
  {
    name: '创新药/生物医药',
    trackScore: 2, trackType: 'hot',
    trackReason: '🔥 热门赛道', trackDetails: '情绪驱动型: 创新药/生物医药',
    priority: 75,
    keywords: [
      '創新藥','创新药','ADC','CAR-T','mRNA','雙抗','双抗','PROTAC','RNAi',
    ],
  },
  // ───── +1 成长赛道 ─────
  {
    name: '软件服务/SaaS',
    trackScore: 1, trackType: 'growth',
    trackReason: '📈 成长赛道', trackDetails: '成长叙事型: 软件服务/SaaS',
    priority: 70,
    keywords: [
      'SaaS',
      '企業服務','企业服务','工業軟件','工业软件',
      '網絡安全','网络安全',
      '軟件服務','软件服务',
      '信息技術服務','信息技术服务','IT服務','IT服务',
      '企業軟件','企业软件',
      '數字化轉型','数字化转型',
      '大數據','大数据',
      '數據中心','数据中心',
      '雲計算','云计算','雲服務','云服务','雲端','云端',
    ],
  },
  {
    name: '医疗器械/CXO',
    trackScore: 1, trackType: 'growth',
    trackReason: '📈 成长赛道', trackDetails: '成长叙事型: 医疗器械/CXO',
    priority: 65,
    keywords: [
      '醫療器械','医疗器械','醫療設備','医疗设备','診斷','诊断',
      'CXO','CDMO',
    ],
  },
  {
    name: '新能源',
    trackScore: 1, trackType: 'growth',
    trackReason: '📈 成长赛道', trackDetails: '成长叙事型: 新能源',
    priority: 60,
    keywords: [
      '新能源','儲能','储能','光伏','風電','风电','充電樁','充电桩',
    ],
  },
  {
    name: '新消费',
    trackScore: 1, trackType: 'growth',
    trackReason: '📈 成长赛道', trackDetails: '成长叙事型: 新消费品牌',
    priority: 45,
    keywords: [
      '新茶飲','新茶饮','咖啡連鎖','咖啡连锁','零食連鎖','零食连锁',
    ],
  },
  // ───── -1 低弹性赛道 ─────
  {
    name: '传统消费/食品',
    trackScore: -1, trackType: 'low',
    trackReason: '📉 低弹性赛道', trackDetails: '缺乏想象空间: 传统消费/食品',
    priority: 20,
    keywords: [
      '食品','食品加工','飲料','饮料','调味品','乳制品','酒类','零食','糖果','烘焙',
      '餐飲','餐饮','快餐','團餐','团餐','預製菜','预制菜',
    ],
  },
  {
    name: '传统制造/建材',
    trackScore: -1, trackType: 'low',
    trackReason: '📉 低弹性赛道', trackDetails: '缺乏想象空间: 传统制造/建材',
    priority: 15,
    keywords: [
      '機械製造','机械制造','工业设备','包装','印刷','造紙','造纸',
      '建材','水泥','玻璃','钢铁','铝业','陶瓷',
    ],
  },
  {
    name: '公用事业/物流',
    trackScore: -1, trackType: 'low',
    trackReason: '📉 低弹性赛道', trackDetails: '缺乏想象空间: 公用事业/物流',
    priority: 12,
    keywords: [
      '水务','燃气','电力','环保','污水處理','污水处理','垃圾處理','垃圾处理',
      '物流','航运','港口','机场','货运','快遞','快递',
    ],
  },
  // ───── -2 回避赛道 ─────
  {
    name: '房地产/物管',
    trackScore: -2, trackType: 'avoid',
    trackReason: '❌ 资金回避', trackDetails: '高破发风险: 房地产/物管',
    priority: 10,
    keywords: [
      '物業管理','物业管理','物管',
      '房地產','房地产','内房','地产开发','商業地產','商业地产',
    ],
  },
  {
    name: '小贷/消费金融',
    trackScore: -2, trackType: 'avoid',
    trackReason: '❌ 资金回避', trackDetails: '高破发风险: 小贷/消费金融',
    priority: 10,
    keywords: [
      '小额贷款','消费金融','融资租赁','P2P','网贷',
    ],
  },
  {
    name: '教育培训',
    trackScore: -2, trackType: 'avoid',
    trackReason: '❌ 资金回避', trackDetails: '高破发风险: 教育培训',
    priority: 10,
    keywords: [
      '教育培训','教育培訓','K12','学科培训','職業教育','职业教育',
    ],
  },
  {
    name: '其他回避',
    trackScore: -2, trackType: 'avoid',
    trackReason: '❌ 资金回避', trackDetails: '高破发风险',
    priority: 10,
    keywords: [
      '纺织','服装制造','制衣','鞋履制造',
      '博彩','赌场',
      '殯葬','殡葬','墓园',
    ],
  },
];

// ==================== 明星基石投资者名单 ====================
// 注意：D1 Partners使用特殊标记，需要边界匹配避免误匹配"附錄D1A"等内容
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

// ==================== 明星基石投资者识别库（增强版） ====================
const STAR_CORNERSTONE_MAP = {
  '高瓴资本 Hillhouse': ['Hillhouse', 'Hillhouse Capital', 'Hillhouse Investment', 'HHHL', '高瓴'],
  '红杉资本 Sequoia': ['Sequoia', 'Sequoia Capital', 'HongShan', 'Hongshan', '红杉'],
  '淡马锡 Temasek': ['Temasek', 'Temasek Holdings', '淡马锡'],
  'GIC 新加坡政府投资公司': ['GIC', 'GIC Private Limited'],
  '阿布扎比投资局 ADIA': ['ADIA', 'Abu Dhabi Investment Authority'],
  '穆巴达拉 Mubadala': ['Mubadala', 'Mubadala Investment Company'],
  '卡塔尔投资局 QIA': ['QIA', 'Qatar Investment Authority'],
  '沙特主权基金 PIF': ['PIF', 'Public Investment Fund'],
  '黑石 Blackstone': ['Blackstone', 'Blackstone Group'],
  '贝莱德 BlackRock': ['BlackRock', 'BlackRock Asset Management'],
  '富达 Fidelity': ['Fidelity', 'Fidelity International', 'FMR'],
  '惠灵顿 Wellington': ['Wellington', 'Wellington Management'],
  'Capital Group 资本集团': ['Capital Group', 'Capital International'],
  '中投公司 CIC': ['China Investment Corporation', 'CIC', 'CIC International'],
  '全国社保基金': ['National Council for Social Security Fund', 'Social Security Fund', '社保基金', '全国社保'],
  '国家大基金': ['China Integrated Circuit Industry Investment Fund', '国家集成电路产业投资基金', '国家大基金', '大基金'],
  '丝路基金': ['Silk Road Fund', '丝路基金'],
  '国调基金': ['China Structural Reform Fund', '国调基金'],
  '中国国新': ['China Reform Holdings', '中国国新'],
  '中保投': ['China Insurance Investment Fund', '中保投'],
  'Tiger Global': ['Tiger Global'],
  'Coatue': ['Coatue'],
  'D1 Capital': ['D1 Capital'], // 有边界匹配保护，不会误伤附录D1A
  'Viking Global': ['Viking Global'],
  '博裕资本 Boyu': ['Boyu Capital', '博裕资本'],
  '春华资本 Primavera': ['Primavera', '春华资本'],
  '厚朴投资 Hopu': ['Hopu', '厚朴投资'],
  '鼎晖投资 CDH': ['CDH', 'CDH Investments', '鼎晖'],
  '中信产业基金 CITIC PE': ['CITIC Private Equity', '中信产业基金'],
  '橡树资本 Oaktree': ['Oaktree', 'Oaktree Capital', 'Oaktree Capital Management'] // ✅ 新增
};


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
 * 通过目录定位章节位置
 * 招股书目录格式通常是：董事、監事及參與全球發售的各方.............. 215
 * @param {string} text - 全文(已去空格)
 * @param {Array} tocPatterns - 目录匹配模式（章节名+页码）
 * @param {Array} titlePatterns - 章节标题模式
 * @param {number} maxLength - 最大章节长度
 * @returns {string} 章节内容
 */
function extractSectionByTOC(text, tocPatterns, titlePatterns, endPatterns, maxLength = 50000) {
  // 步骤1：从目录中找到章节页码
  let targetPage = null;
  for (const pattern of tocPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      targetPage = parseInt(match[1], 10);
      console.log(`[目录定位] 找到目录条目，章节在第 ${targetPage} 页`);
      break;
    }
  }

  if (!targetPage) {
    console.log(`[目录定位] 未找到目录页码，回退到普通搜索`);
    return null;
  }

  // 步骤2：在全文中搜索页码标记 "– 82 –" 或 "- 82 -"
  // 招股书页码格式通常是：– 82 – 或 - 82 - 或 —82—
  const pageMarkerPatterns = [
    new RegExp(`[–—-]\\s*${targetPage}\\s*[–—-]`, 'g'),
    new RegExp(`-\\s*${targetPage}\\s*-`, 'g'),
  ];

  let pageMarkerIndex = -1;
  for (const pattern of pageMarkerPatterns) {
    const match = text.match(pattern);
    if (match) {
      pageMarkerIndex = text.indexOf(match[0]);
      console.log(`[目录定位] 找到页码标记 "${match[0]}"，位置: ${pageMarkerIndex}`);
      break;
    }
  }

  if (pageMarkerIndex === -1) {
    console.log(`[目录定位] 未找到页码标记 – ${targetPage} –`);
    return null;
  }

  // 步骤3：在页码标记附近搜索章节标题（扩大搜索范围）
  const searchStart = Math.max(0, pageMarkerIndex - 5000); // 页码前5000字符
  const searchEnd = Math.min(text.length, pageMarkerIndex + 50000); // 页码后50000字符（约10页）
  const searchText = text.slice(searchStart, searchEnd);

  console.log(`[目录定位] 搜索范围: ${searchStart}-${searchEnd}，长度: ${searchEnd - searchStart}`);

  for (const titlePattern of titlePatterns) {
    const regex = new RegExp(titlePattern.source, 'gi');
    let match;

    while ((match = regex.exec(searchText)) !== null) {
      const absolutePosition = searchStart + match.index;

      // 检查是否是目录格式（标题后跟点号）
      const afterMatch = searchText.slice(match.index + match[0].length, match.index + match[0].length + 30);
      if (/^\.{2,}|^\s*\.[\s.]*\./.test(afterMatch)) {
        continue; // 跳过目录条目
      }

      // 检查是否是释义引用（标题前有「或"）
      const beforeMatch = searchText.slice(Math.max(0, match.index - 5), match.index);
      if (/[「"']$/.test(beforeMatch)) {
        continue; // 跳过释义中的引用
      }

      console.log(`[目录定位] ✓ 找到章节标题，绝对位置: ${absolutePosition}`);

      // 关键修改：从全文中截取章节内容，而不是从searchText中截取
      // 这样可以获取完整的章节内容
      const sectionStart = absolutePosition;
      let sectionEnd = Math.min(sectionStart + maxLength, text.length);

      // 在章节内容中查找结束标记
      const sectionContent = text.slice(sectionStart, sectionEnd);
      for (const ep of endPatterns) {
        const endRegex = new RegExp(ep.source, 'i');
        const titleLength = match[0].length;
        const afterTitle = sectionContent.slice(titleLength);
        const endMatch = afterTitle.match(endRegex);
        if (endMatch) {
          const newEnd = sectionStart + titleLength + endMatch.index;
          if (newEnd > sectionStart + 1000) { // 确保至少有1000字符
            sectionEnd = Math.min(sectionEnd, newEnd);
          }
        }
      }

      const result = text.slice(sectionStart, sectionEnd);
      console.log(`[目录定位] 章节长度: ${result.length}，截取范围: ${sectionStart}-${sectionEnd}`);
      return result;
    }
  }

  console.log(`[目录定位] 未在页码附近找到章节标题`);
  return null;
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
          const candidateEnd = start + match[0].length + endMatch.index;
          // 确保至少有1000字符，避免结束标记紧跟章节标题（如页眉连续出现）
          if (candidateEnd > start + 1000) {
            end = Math.min(end, candidateEnd);
          }
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
 * 判断链接文本是否为最终版招股书（排除PHIP/申請版本/摘要等）
 * @param {string} text - 链接文本
 * @returns {boolean}
 */
function isFinalProspectus(text) {
  if (!text) return false;
  const t = text.toLowerCase();

  // 排除项：PHIP、申請版本、摘要、補充、結果、公告等
  const excludePatterns = [
    'phip', '聆訊後', '聆讯后', 'post hearing',
    '申請版本', '申请版本', 'application proof',
    '摘要', 'summary',
    '補充', '补充', 'supplemental',
    '修訂', '修订', 'amendment',
    '勘誤', '勘误', 'errata',
    '澄清', 'clarification',
    // 排除公告、结果类文件
    '結果', '结果', 'results', 'allotment',
    '公告', 'announcement', 'notice',
    '配發', '配发',
  ];

  for (const p of excludePatterns) {
    if (t.includes(p)) return false;
  }

  // 包含项：招股章程、Prospectus
  const includePatterns = ['招股章程', '招股書', '招股书', 'prospectus'];
  for (const p of includePatterns) {
    if (t.includes(p)) return true;
  }

  return false;
}

/**
 * 从港交所搜索招股书PDF链接
 */
async function searchProspectus(stockCode) {
  const formattedCode = formatStockCode(stockCode);
  // 使用已清理后的纯数字代码（formatStockCode已去除字母前缀如AI/GEM等）
  const codeNum = parseInt(formattedCode, 10).toString();

  console.log(`[搜索] 股票代码: ${formattedCode}`);

  let results = [];
  let $ = null;
  let response = null;

  try {
    // 方法1: 先搜索主板新上市列表
    console.log('[搜索] 方法1: 尝试主板新上市列表...');
    const mainBoardUrl = 'https://www2.hkexnews.hk/New-Listings/New-Listing-Information/Main-Board?sc_lang=zh-HK';
    response = await axios.get(mainBoardUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 30000,
    });

    $ = cheerio.load(response.data);

    // 解析表格 - 收集所有候选PDF，优先级排序
    $('table tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 2) {
        const code = $(cells[0]).text().trim();
        const name = $(cells[1]).text().trim();

        if (code === codeNum || code === formattedCode) {
          const priorityResults = []; // 语义匹配的高优先级
          const fallbackResults = []; // 其他PDF作为备选

          // 扫描该行所有PDF链接
          $(row).find('td a').each((j, link) => {
            const href = $(link).attr('href');
            const linkText = $(link).text().trim();

            if (!href || !href.toLowerCase().includes('.pdf')) return;

            const pdfUrl = href.startsWith('http') ? href : `https://www1.hkexnews.hk${href}`;
            const item = {
              title: `${name} 招股章程`,
              link: pdfUrl,
              code: formattedCode,
              name: name,
              linkText: linkText,
            };

            if (isFinalProspectus(linkText)) {
              if (!priorityResults.find(r => r.link === pdfUrl)) {
                console.log(`[搜索] 高优先级(语义匹配): ${linkText} -> ${pdfUrl.substring(0, 60)}...`);
                priorityResults.push(item);
              }
            } else {
              if (!fallbackResults.find(r => r.link === pdfUrl)) {
                console.log(`[搜索] 低优先级(备选): ${linkText} -> ${pdfUrl.substring(0, 60)}...`);
                fallbackResults.push(item);
              }
            }
          });

          // 合并结果：高优先级在前，备选在后
          results.push(...priorityResults, ...fallbackResults);
        }
      }
    });
    
    // 如果主板没找到，搜索创业板
    if (results.length === 0) {
      console.log('[搜索] 方法1: 主板未找到，尝试创业板...');

      const gemUrl = 'https://www2.hkexnews.hk/New-Listings/New-Listing-Information/GEM?sc_lang=zh-HK';
      response = await axios.get(gemUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 30000,
      });

      $ = cheerio.load(response.data);

      // GEM - 同样收集所有候选PDF，优先级排序
      $('table tr').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 2) {
          const code = $(cells[0]).text().trim();
          const name = $(cells[1]).text().trim();

          if (code === codeNum || code === formattedCode) {
            const priorityResults = []; // 语义匹配的高优先级
            const fallbackResults = []; // 其他PDF作为备选

            // 扫描该行所有PDF链接
            $(row).find('td a').each((j, link) => {
              const href = $(link).attr('href');
              const linkText = $(link).text().trim();

              if (!href || !href.toLowerCase().includes('.pdf')) return;

              const pdfUrl = href.startsWith('http') ? href : `https://www1.hkexnews.hk${href}`;
              const item = {
                title: `${name} 招股章程`,
                link: pdfUrl,
                code: formattedCode,
                name: name,
                linkText: linkText,
              };

              if (isFinalProspectus(linkText)) {
                if (!priorityResults.find(r => r.link === pdfUrl)) {
                  console.log(`[搜索] 高优先级(语义匹配,GEM): ${linkText} -> ${pdfUrl.substring(0, 60)}...`);
                  priorityResults.push(item);
                }
              } else {
                if (!fallbackResults.find(r => r.link === pdfUrl)) {
                  console.log(`[搜索] 低优先级(备选,GEM): ${linkText} -> ${pdfUrl.substring(0, 60)}...`);
                  fallbackResults.push(item);
                }
              }
            });

            // 合并结果：高优先级在前，备选在后
            results.push(...priorityResults, ...fallbackResults);
          }
        }
      });
    }

    if (results.length > 0) {
      console.log(`[搜索] 方法1成功: 找到 ${results.length} 个结果`);
    }
  } catch (method1Error) {
    console.log(`[搜索] 方法1失败: ${method1Error.message}，继续尝试其他方法...`);
  }

  try {
    // 如果新上市列表都没找到，尝试获取股票上市日期并搜索历史招股书
    if (results.length === 0) {
      console.log('[搜索] 方法2: 尝试获取上市日期并搜索历史招股书...');

      try {
        // 从Yahoo Finance获取首个交易日期
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

                // 方法3A: 先尝试Application Proof路径（适用于新上市/H股二次上市）
                console.log('[搜索] 方法3A: 尝试Application Proof路径...');
                const apUrls = [];

                // Application Proof通常在上市前1-3周发布
                for (let d = 7; d <= 21; d++) {
                  const apDate = new Date(ipoDate);
                  apDate.setDate(apDate.getDate() - d);
                  const year = apDate.getFullYear();
                  const month = String(apDate.getMonth() + 1).padStart(2, '0');
                  const day = String(apDate.getDate()).padStart(2, '0');
                  const mmdd = `${month}${day}`;

                  // Application Proof格式: /app/sehk/YYYY/MMDD/STOCKCODE.pdf
                  apUrls.push(`https://www1.hkexnews.hk/app/sehk/${year}/${mmdd}/${formattedCode}.pdf`);
                  apUrls.push(`https://www1.hkexnews.hk/app/sehk/${year}/${mmdd}/${codeNum}.pdf`);
                }

                console.log(`[搜索] 生成 ${apUrls.length} 个AP探测URL`);

                // 方法3B: 探测listconews路径（常规上市公告）
                console.log('[搜索] 方法3B: 尝试直接探测招股书URL...');

                // 生成上市前5-14天的日期列表（优化：减少探测范围）
                const probeUrls = [];
                const probeStartTime = Date.now();
                for (let d = 5; d <= 14; d++) {
                  const probeDate = new Date(ipoDate);
                  probeDate.setDate(probeDate.getDate() - d);
                  const year = probeDate.getFullYear();
                  const month = String(probeDate.getMonth() + 1).padStart(2, '0');
                  const day = String(probeDate.getDate()).padStart(2, '0');
                  const mmdd = `${month}${day}`;

                  // 每天尝试序号 00001-00050（使用正确的5位序号格式，不含ltn前缀和_c后缀）
                  for (let seq = 1; seq <= 50; seq++) {
                    const seqStr = String(seq).padStart(5, '0');
                    // 使用www1域名，正确的招股书URL格式
                    probeUrls.push(`https://www1.hkexnews.hk/listedco/listconews/sehk/${year}/${mmdd}/${year}${mmdd}${seqStr}.pdf`);
                  }
                }

                // 合并AP URLs和listconews URLs（AP优先）
                const allProbeUrls = [...apUrls, ...probeUrls];
                console.log(`[搜索] 总共生成 ${allProbeUrls.length} 个探测URL (${apUrls.length} AP + ${allProbeUrls.length} listconews)`);

                // 使用curl探测文件大小（降低超时加速探测）
                const checkUrl = (url) => {
                  try {
                    const result = execSync(
                      `curl -s -I -H 'Range: bytes=0-10' '${url}' -H 'User-Agent: Mozilla/5.0' --connect-timeout 3 --max-time 5`,
                      { encoding: 'utf8', timeout: 8000 }
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

                // 第2层：快速指纹验证（只下载前100KB，在二进制中搜索文本）
                const quickFingerprintCheck = async (url, stockCode, stockName) => {
                  try {
                    const resp = await axios.get(url, {
                      responseType: 'arraybuffer',
                      timeout: 15000, // 15秒超时
                      headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Range': 'bytes=0-102400', // 只下载前100KB
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
                const PROBE_TIMEOUT_MS = 30000; // 探测阶段最多30秒（优化）
                for (let i = 0; i < allProbeUrls.length && candidateUrls.length < 5; i += batchSize) {
                  // 超时保护：如果探测超过60秒则中断
                  if (Date.now() - probeStartTime > PROBE_TIMEOUT_MS) {
                    console.log(`[搜索] URL探测超时(${PROBE_TIMEOUT_MS/1000}s)，已探测 ${i}/${allProbeUrls.length} 个URL，找到 ${candidateUrls.length} 个候选`);
                    break;
                  }

                  const batch = allProbeUrls.slice(i, i + batchSize);

                  for (const url of batch) {
                    const fileSize = checkUrl(url);
                    // 招股书通常较大（至少3MB）
                    if (fileSize > 3000000) {
                      candidateUrls.push({ url, fileSize });
                    }
                  }
                }

                // 按文件大小降序排序，但不完全依赖大小
                // 招股书通常较大但不一定是最大的
                candidateUrls.sort((a, b) => b.fileSize - a.fileSize);

                console.log(`[搜索] 发现 ${candidateUrls.length} 个候选PDF`);

                // ========== 快速指纹验证（并行验证前15个）==========
                // 招股书不一定是最大的文件，需要验证更多候选
                // 100KB×15=1.5MB并行下载，非常快
                const topCandidates = candidateUrls.slice(0, 15);
                console.log(`[搜索] 并行指纹验证前${topCandidates.length}个PDF...`);

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
  } catch (method2Error) {
    console.log(`[搜索] 方法2失败: ${method2Error.message}`);
  }

  console.log(`[搜索] 最终找到 ${results.length} 个结果`);
  return results;
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

  // 验证pdfUrl
  if (!pdfUrl) {
    throw new Error('PDF链接为空，无法下载');
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
    // 完整招股书通常有100万+字符，至少应有10万字符
    // 如果只有几千字符，可能是公告/通知而非招股书
    if (!text || text.length < 5000) {
      throw new Error('PDF可能为扫描版，无法提取文字内容');
    }

    // 检查是否为完整招股书（而非公告）
    const frontPages = text.slice(0, 30000); // 前几页
    const frontPagesNoSpace = frontPages.replace(/\s+/g, '').toLowerCase();

    // 1️⃣ 前几页必须含 Prospectus / 招股章程
    const prospectusKeywords = ['prospectus', '招股章程', '招股書', '招股书'];
    const hasProspectusKeyword = prospectusKeywords.some(k => frontPagesNoSpace.includes(k.toLowerCase()));
    console.log(`[PDF验证] 前几页含招股章程关键字: ${hasProspectusKeyword}`);

    // 2️⃣ 招股书应该包含特定章节
    const prospectusMarkers = ['全球發售', '風險因素', '行業概覽', '董事', '財務資料'];
    const markersFound = prospectusMarkers.filter(m => text.includes(m) || text.replace(/\s+/g, '').includes(m));
    console.log(`[PDF验证] 文本长度: ${text.length}, 招股书章节标记: ${markersFound.length}/5 (${markersFound.join(', ')})`);

    // 验证失败条件
    if (!hasProspectusKeyword) {
      throw new Error(`PDF前几页未找到"招股章程/Prospectus"关键字，可能下载的是公告而非招股书`);
    }

    if (text.length < 50000 && markersFound.length < 3) {
      throw new Error(`PDF内容太少(${text.length}字符)且缺少招股书章节标记，可能下载的是公告而非完整招股书`);
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


function extractCornerstoneInvestorsFromSection(cornerstoneSection) {
  console.log('\n[基石投资者] ====== 表格解析阶段(无换行终极版) ======');

  if (!cornerstoneSection || cornerstoneSection.length < 1000) {
    console.log('[基石投资者] ❌ 章节文本异常或过短');
    return [];
  }

  // ===== 1️⃣ 定位表格区域 =====
  const anchorMatch = cornerstoneSection.match(/下表載列基石配售的詳情[:：]?/);
  if (!anchorMatch) {
    console.log('[表格定位] ❌ 没找到表格锚点');
    return [];
  }

  let tableText = cornerstoneSection.slice(anchorMatch.index, anchorMatch.index + 10000);

  // ===== 2️⃣ PDF 清洗 =====
  tableText = tableText
    .replace(/\.{2,}/g, ' ')          // 点线
    .replace(/–\s*\d+\s*–/g, ' ')     // 页码
    .replace(/\s+/g, ' ');            // 压缩空白

  console.log('[表格文本预览]', tableText.slice(0, 400));

  // ===== 3️⃣ 核心识别正则（全局扫描） =====
  /**
   * 结构：
   * 名字 + 空格 + 金额 + 股份数 + 百分比%
   *
   * 例如：
   * Oaktree 30 5,106,200 5.45%
   * 歐萬達基金 20 3,404,100 3.64%
   */
  const rowRegex = /([A-Z][A-Za-z&().\-\s]{1,40}|[\u4e00-\u9fa5（）()及]{2,40})\s+(\d{1,3})\s*([\d,]{6,})\s*\d+\.\d+%/g;

  const investors = [];
  let match;

  while ((match = rowRegex.exec(tableText)) !== null) {
    let name = match[1].replace(/\s+/g, ' ').trim();

    // 过滤總計
    if (name.includes('總計')) continue;

    console.log(`[识别] ✅ ${name}`);
    investors.push(name);
  }

  const unique = [...new Set(investors)];

  console.log(`\n[基石投资者] 🎯 成功识别 ${unique.length} 个基石投资者`);
  console.log(unique);
  console.log('[基石投资者] ====== 解析结束 ======\n');

  return unique.map(name => ({ name }));
}

// 使用示例
// const investors = extractCornerstoneInvestors(cornerstoneSection);





// ==================== V5：PDF 总股本提取 ====================
/**
 * 从招股书文本中提取发行后总股本（股数）
 * 必须用总股本（而非H股股本）计算总市值，否则PE会被严重低估。
 *
 * 策略优先级：
 *   A  股本章节定位 "緊隨全球發售完成後" 附近数字
 *   B  "股份結構" / "股本結構" 表格
 *   C  EPS 反推（净利润 / 每股收益）
 * @returns {{ totalShares: number|null, confidence: string, source: string }}
 */
function extractTotalShares(text) {
  const noSpace = text.replace(/\s+/g, '');

  // 辅助：从数字字符串解析整数
  const parseShares = (raw) => parseInt(raw.replace(/,/g, ''), 10);

  // 辅助：合理性校验（1千万 ~ 500亿）
  const isReasonable = (n) => n >= 1e7 && n <= 5e10;

  // ── 策略 A：搜索"緊隨全球發售完成後"相关表述 ──
  const anchorPatterns = [
    /緊隨全球發售(?:及資本化發行)?完成後/,
    /紧随全球发售(?:及资本化发行)?完成后/,
    /全球發售完成後/,
    /上市後已發行股份/,
  ];
  for (const anchor of anchorPatterns) {
    const m = anchor.exec(noSpace);
    if (!m) continue;
    const nearby = noSpace.slice(m.index, m.index + 3000);
    const patterns = [
      /已發行股份總數[^\d]*([\d,]+)\s*股/,
      /已發行股本[^\d]*([\d,]+)\s*股/,
      /將有\s*([\d,]+)\s*股/,
      /合共\s*([\d,]+)\s*股/,
      /總數為\s*([\d,]+)\s*股/,
      /共([\d,]+)股/,
    ];
    for (const p of patterns) {
      const hit = p.exec(nearby);
      if (hit) {
        const n = parseShares(hit[1]);
        if (isReasonable(n)) {
          console.log(`[totalShares] 策略A命中: ${n.toLocaleString()}股`);
          return { totalShares: n, confidence: 'high', source: '股本章节(緊隨全球發售完成後)' };
        }
      }
    }
  }

  // ── 策略 B：搜索"股本結構" / "股份結構" 表格 ──
  const structPatterns = [/股本結構/, /股份結構/, /股本结构/, /股份结构/];
  for (const sp of structPatterns) {
    const m = sp.exec(noSpace);
    if (!m) continue;
    const nearby = noSpace.slice(m.index, m.index + 2000);
    const hit = /已發行(?:及繳足)?(?:股份)?總數[^\d]*([\d,]+)\s*股/.exec(nearby)
             || /全部已發行股份[^\d]*([\d,]+)/.exec(nearby);
    if (hit) {
      const n = parseShares(hit[1]);
      if (isReasonable(n)) {
        console.log(`[totalShares] 策略B命中: ${n.toLocaleString()}股`);
        return { totalShares: n, confidence: 'medium', source: '股本結構表格' };
      }
    }
  }

  // ── 策略 C：EPS 反推（净利润 / 每股基本盈利）──
  const epsHit = /每股基本盈利[^\d]*([\d.]+)港仙/.exec(noSpace)
              || /每股盈利[^\d]*([\d.]+)仙/.exec(noSpace);
  if (epsHit) {
    const profit = extractNetProfit(text);
    if (profit && profit.hkdAmount > 0) {
      const epsHKD = parseFloat(epsHit[1]) / 100; // 港仙→港元
      if (epsHKD > 0) {
        const shares = Math.round(profit.hkdAmount / epsHKD);
        if (isReasonable(shares)) {
          console.log(`[totalShares] 策略C(EPS反推): ${shares.toLocaleString()}股`);
          return { totalShares: shares, confidence: 'low', source: 'EPS反推' };
        }
      }
    }
  }

  console.log('[totalShares] 未提取到总股本');
  return { totalShares: null, confidence: 'none', source: '未找到' };
}

// ==================== V5：PDF 净利润提取 ====================
/**
 * 从招股书提取最近完整财年归属母公司净利润（转换为港元）
 *
 * 优先级：股東應佔溢利 > 本年溢利 > 年內溢利 > 純利
 * 单位识别：人民币千元（最常见）/ 港元百万 / 港元千元
 * @returns {{ hkdAmount: number|null, currency: string, unit: string, source: string }}
 */
function extractNetProfit(text) {
  const noSpace = text.replace(/\s+/g, '');

  // 匹配负数（亏损）时捕获符号
  const NUM_RE = /[（(]?([\d,]+)[）)]?/;

  /**
   * 将原始数字字符串 + 单位描述 → 港元数值
   * 汇率简化：1 RMB ≈ 1.10 HKD（保守估算）
   */
  function toHKD(raw, currency, unit) {
    const n = parseInt(raw.replace(/,/g, ''), 10);
    if (isNaN(n) || n <= 0) return null;

    let multiplier = 1;
    if (/千/.test(unit)) multiplier = 1e3;
    else if (/百萬|百万/.test(unit)) multiplier = 1e6;
    else if (/億|亿/.test(unit)) multiplier = 1e8;

    const baseAmount = n * multiplier;

    if (/人民幣|人民币|RMB|CNY/.test(currency)) return Math.round(baseAmount * 1.10);
    if (/港/.test(currency)) return baseAmount;
    if (/美/.test(currency)) return Math.round(baseAmount * 7.80);
    return baseAmount; // 未知货币，原值返回
  }

  // 识别财务报告单位（页面通常有 "（人民幣千元）" 这样的表头）
  const unitHint = /（?(人民幣|港幣|港元|美元|RMB|HKD|USD)([千百萬億千万亿元]+)?）?/.exec(noSpace);
  const defaultCurrency = unitHint ? unitHint[1] : '人民幣';
  const defaultUnit     = unitHint ? (unitHint[2] || '千元') : '千元';

  // ── 策略 A：搜索財務資料概要章节 ──
  const summaryAnchors = [
    /財務資料概要/,
    /財務資料撮要/,
    /主要財務資料/,
    /财务资料概要/,
  ];

  const profitPatterns = [
    { re: /股東應佔溢利[^\d（(]*([\d,]+)/, label: '股東應佔溢利', isLoss: false },
    { re: /本公司擁有人應佔溢利[^\d（(]*([\d,]+)/, label: '本公司擁有人應佔溢利', isLoss: false },
    { re: /股東應佔虧損[^\d（(]*([\d,]+)/, label: '股東應佔虧損', isLoss: true },
    { re: /本年溢利[^\d（(]*([\d,]+)/, label: '本年溢利', isLoss: false },
    { re: /年內溢利[^\d（(]*([\d,]+)/, label: '年內溢利', isLoss: false },
    { re: /期內溢利[^\d（(]*([\d,]+)/, label: '期內溢利', isLoss: false },
    { re: /純利[^\d（(]*([\d,]+)/, label: '純利', isLoss: false },
    { re: /年內虧損[^\d（(]*([\d,]+)/, label: '年內虧損', isLoss: true },
  ];

  for (const anchor of summaryAnchors) {
    const m = anchor.exec(noSpace);
    if (!m) continue;
    const section = noSpace.slice(m.index, m.index + 8000);

    for (const { re, label, isLoss } of profitPatterns) {
      const hit = re.exec(section);
      if (!hit) continue;
      const hkd = toHKD(hit[1], defaultCurrency, defaultUnit);
      if (!hkd) continue;
      const amount = isLoss ? -hkd : hkd;
      console.log(`[netProfit] 策略A命中(${label}): ${amount.toLocaleString()} HKD`);
      return { hkdAmount: amount, currency: defaultCurrency, unit: defaultUnit, source: `財務概要(${label})` };
    }
  }

  // ── 策略 B：搜索"所得稅開支"向下找净利润 ──
  const taxIdx = noSpace.indexOf('所得稅開支');
  if (taxIdx !== -1) {
    const after = noSpace.slice(taxIdx, taxIdx + 500);
    for (const { re, label, isLoss } of profitPatterns) {
      const hit = re.exec(after);
      if (!hit) continue;
      const hkd = toHKD(hit[1], defaultCurrency, defaultUnit);
      if (!hkd) continue;
      const amount = isLoss ? -hkd : hkd;
      console.log(`[netProfit] 策略B命中(${label}): ${amount.toLocaleString()} HKD`);
      return { hkdAmount: amount, currency: defaultCurrency, unit: defaultUnit, source: `所得稅附近(${label})` };
    }
  }

  // ── 策略 C：全文搜索 ──
  for (const { re, label, isLoss } of profitPatterns) {
    const hit = re.exec(noSpace);
    if (!hit) continue;
    const hkd = toHKD(hit[1], defaultCurrency, defaultUnit);
    if (!hkd) continue;
    const amount = isLoss ? -hkd : hkd;
    console.log(`[netProfit] 策略C命中(${label}): ${amount.toLocaleString()} HKD`);
    return { hkdAmount: amount, currency: defaultCurrency, unit: defaultUnit, source: `全文搜索(${label})` };
  }

  console.log('[netProfit] 未提取到净利润');
  return { hkdAmount: null, currency: null, unit: null, source: '未找到' };
}

// ==================== V5：PE 评分函数（独立，供主流程调用）====================
/**
 * 根据发行价、总股本、净利润、同行PE，计算PE评分
 * @param {number|null} offerPriceMid  - 发行价中值（港元）
 * @param {number|null} totalShares    - 总股本（股）
 * @param {number|null} netProfitHKD   - 净利润（港元）
 * @param {number|null} peerMedianPE   - 同行PE中位数
 * @returns {{ score: number, reason: string, details: string, evidence: Object }}
 */
function scorePE(offerPriceMid, totalShares, netProfitHKD, peerMedianPE) {
  const evidence = { offerPriceMid, totalShares, netProfitHKD, peerMedianPE };

  // 亏损公司
  if (netProfitHKD !== null && netProfitHKD <= 0) {
    return { score: 0, reason: 'PE：未盈利', details: '净利润≤0，无法计算PE，中性评分', evidence };
  }

  // 数据缺失
  if (!offerPriceMid || !totalShares || !netProfitHKD) {
    return { score: 0, reason: 'PE：数据不足', details: '发行价/股本/利润数据缺失，无法计算', evidence };
  }

  if (!peerMedianPE || peerMedianPE <= 0) {
    return { score: 0, reason: 'PE：无法对标', details: '可比公司不足3家，无法对标', evidence };
  }

  const totalMarketCap = offerPriceMid * totalShares;
  const newIPOpe = parseFloat((totalMarketCap / netProfitHKD).toFixed(2));
  const ratio    = parseFloat((newIPOpe / peerMedianPE).toFixed(4));

  evidence.newIPOPE     = newIPOpe;
  evidence.peerMedianPE = peerMedianPE;
  evidence.ratio        = ratio;

  let score, reason, details;
  if (ratio < 0.70) {
    score  = 3;  reason = 'PE：大幅折让';   details = `新股PE ${newIPOpe.toFixed(1)}x vs 同行 ${peerMedianPE}x，折让${((1-ratio)*100).toFixed(0)}%（>30%）`;
  } else if (ratio < 0.85) {
    score  = 2;  reason = 'PE：明显折让';   details = `新股PE ${newIPOpe.toFixed(1)}x vs 同行 ${peerMedianPE}x，折让${((1-ratio)*100).toFixed(0)}%（15-30%）`;
  } else if (ratio < 0.95) {
    score  = 1;  reason = 'PE：轻微折让';   details = `新股PE ${newIPOpe.toFixed(1)}x vs 同行 ${peerMedianPE}x，折让${((1-ratio)*100).toFixed(0)}%（5-15%）`;
  } else if (ratio <= 1.05) {
    score  = 0;  reason = 'PE：基本持平';   details = `新股PE ${newIPOpe.toFixed(1)}x vs 同行 ${peerMedianPE}x，与市场持平`;
  } else if (ratio <= 1.15) {
    score  = -1; reason = 'PE：轻微溢价';   details = `新股PE ${newIPOpe.toFixed(1)}x vs 同行 ${peerMedianPE}x，溢价${((ratio-1)*100).toFixed(0)}%（5-15%）`;
  } else if (ratio <= 1.30) {
    score  = -2; reason = 'PE：明显溢价';   details = `新股PE ${newIPOpe.toFixed(1)}x vs 同行 ${peerMedianPE}x，溢价${((ratio-1)*100).toFixed(0)}%（15-30%）`;
  } else {
    score  = -3; reason = 'PE：大幅溢价';   details = `新股PE ${newIPOpe.toFixed(1)}x vs 同行 ${peerMedianPE}x，溢价${((ratio-1)*100).toFixed(0)}%（>30%）`;
  }

  console.log(`[PE] ${reason}: ${details}`);
  return { score, reason, details, evidence };
}

// ==================== 评分引擎 ====================

/**
 * 主评分函数（V5）
 * 新增维度：PE估值（-3~+3）、募资规模（-1~+1）
 * 绿鞋检测：展示项，不计分
 */
async function scoreProspectus(rawText, stockCode) {
  const text = rawText;
  const normalizedText = normalizeText(rawText);
  const SPONSORS = getAllSponsors();

  console.log(`[评分] 开始评分(V5): ${stockCode}, 文本长度: ${text.length}`);

  const scores = {
    oldShares:   { score: 0, reason: '', details: '' },
    sponsor:     { score: 0, reason: '', details: '', sponsors: [] },
    cornerstone: { score: 0, reason: '', details: '', investors: [] },
    lockup:      { score: 0, reason: '', details: '' },
    industry:    { score: 0, reason: '', details: '', track: '' },
    pe:          { score: 0, reason: 'PE：待计算', details: '' },    // V5 新增
    ipoSize:     { score: 0, reason: '募资规模：待计算', details: '' }, // V5 新增
  };

  // ── V5：提前爬取 etnet 数据（不阻塞失败，graceful降级）──
  let etnetData = null;
  try {
    const fmtCode = String(stockCode).replace(/\D/g, '').padStart(5, '0');
    etnetData = await crawlIPODetail(fmtCode);
    console.log(`[etnet] 数据获取${etnetData ? '成功' : '失败'}`);
  } catch (e) {
    console.warn(`[etnet] 数据获取异常: ${e.message}，降级为PDF提取`);
  }

  // ── V5：绿鞋检测（展示项，不计分）──
  const greenShoeKeywords = [
    '超額配股權', '超额配股权', '穩定價格操作', '稳定价格操作',
    '穩定價格經辦人', 'Over-allotment', 'Over allotment', 'Green Shoe', 'Greenshoe',
  ];
  const front80k = text.slice(0, 80000);
  const hasGreenShoe = greenShoeKeywords.some(k => front80k.includes(k));
  console.log(`[绿鞋] hasGreenShoe=${hasGreenShoe}`);
  
  // ========== 1. 旧股检测（优化版：基于PDF前几页的全球發售章节精准定位）==========
  // 核心判断逻辑：
  // - 在PDF前几页（约前20000字符）的"全球發售"区域查找"全球發售的發售股份數目"
  // - 如果该句包含"銷售股份"则有旧股，否则无旧股
  // - 示例：小米"包括 1,434,440,000 股新 B 類股份及 745,145,000 股銷售股份" → 有旧股
  // - 示例：卓正"全球發售的發售股份數目：4,750,000 股股份" → 无旧股

  console.log(`\n[旧股检测] ========== 开始 ==========`);

  let hasOldShares = false;
  let confidence = 'low';
  let evidenceList = [];
  let newSharesCount = null;
  let saleSharesCount = null;
  let globalOfferingStatement = ''; // 存储"全球發售的發售股份數目"原文

  // -------- 第一层：PDF前几页的"全球發售的發售股份數目"精准定位 --------
  // 招股书前几页（通常第2页）会有类似格式：
  // "全球發售的發售股份數目：XXX股股份（包括XXX股新股份及XXX股銷售股份）"
  const frontPages = text.slice(0, 25000); // 前25000字符约前几页
  // 同时准备去空格版本用于匹配（pdftotext -layout会在字符间加空格）
  const frontPagesNoSpace = frontPages.replace(/\s+/g, '');

  console.log(`[旧股检测] 前25000字符长度: ${frontPages.length}, 去空格后: ${frontPagesNoSpace.length}`);
  console.log(`[旧股检测] 前200字符(原文): ${frontPages.slice(0, 200).replace(/\n/g, '↵')}`);
  console.log(`[旧股检测] 前200字符(去空格): ${frontPagesNoSpace.slice(0, 200)}`);

  // 查找"全球發售的發售股份數目"这一行 - 在去空格文本中搜索
  const offeringStatementPatterns = [
    /全球發售的發售股份數目[：:]/i,
    /全球发售的发售股份数目[：:]/i,
    /發售股份數目[：:]/i,
    /发售股份数目[：:]/i,
  ];

  for (const pattern of offeringStatementPatterns) {
    console.log(`[旧股检测] 尝试匹配: ${pattern}`);
    const match = frontPagesNoSpace.match(pattern);
    if (match) {
      console.log(`[旧股检测] ✓ 匹配成功: ${match[0]}`);
      // 找到匹配位置后，提取后续内容（约200字符）
      const matchIndex = match.index;
      const statementEnd = Math.min(matchIndex + 200, frontPagesNoSpace.length);
      globalOfferingStatement = frontPagesNoSpace.slice(matchIndex, statementEnd);
      console.log(`[旧股检测] 提取语句: ${globalOfferingStatement}`);

      // 检查是否包含"銷售股份"
      if (/銷售股份|销售股份/.test(globalOfferingStatement)) {
        hasOldShares = true;
        confidence = 'very_high';
        console.log(`[旧股检测] ✓ 发现銷售股份 → 有旧股`);
        evidenceList.push({
          source: '全球發售（PDF前几页）',
          keyword: '銷售股份',
          context: globalOfferingStatement,
        });

        // 提取数量（去空格后的文本）
        const saleMatch = globalOfferingStatement.match(/([\d,，]+)股銷售股份|([\d,，]+)股销售股份/);
        const newMatch = globalOfferingStatement.match(/([\d,，]+)股新[^股]*股份|([\d,，]+)股新股/);
        if (saleMatch) {
          saleSharesCount = (saleMatch[1] || saleMatch[2]).replace(/[,，]/g, '');
          console.log(`[旧股检测] 旧股数量: ${saleSharesCount}`);
        }
        if (newMatch) {
          newSharesCount = (newMatch[1] || newMatch[2]).replace(/[,，]/g, '');
          console.log(`[旧股检测] 新股数量: ${newSharesCount}`);
        }
      } else {
        // 找到了发售股份数目声明，但没有銷售股份 → 确认无旧股
        confidence = 'very_high';
        console.log(`[旧股检测] ✓ 未发现銷售股份 → 无旧股`);
        evidenceList.push({
          source: '全球發售（PDF前几页）',
          keyword: '无銷售股份',
          context: globalOfferingStatement,
        });
      }
      break;
    } else {
      console.log(`[旧股检测] ✗ 未匹配`);
    }
  }

  // -------- 第二层：如果第一层未找到，在全球發售章节扩大搜索 --------
  if (!globalOfferingStatement) {
    console.log(`[旧股检测] 第一层未匹配，进入第二层章节搜索...`);

    // 用去空格版本搜索章节
    const textNoSpace = text.replace(/\s+/g, '');
    const globalOfferingSection = extractSection(
      textNoSpace,
      [
        /全球發售的架構/i, /全球發售的結構/i, /全球发售的架构/i,
        /全球發售/i, /全球发售/i,
        /GLOBALOFFERING/i
      ],
      [/風險因素/i, /风险因素/i, /RISKFACTORS/i, /售股股東/i],
      50000
    );

    console.log(`[旧股检测] 全球發售章节长度: ${globalOfferingSection?.length || 0}`);

    const searchTextForOldShares = globalOfferingSection || textNoSpace.slice(0, 80000);
    const oldSharesKeywords = ['銷售股份', '销售股份'];

    for (const kw of oldSharesKeywords) {
      console.log(`[旧股检测] 搜索关键词: ${kw}`);
      if (searchTextForOldShares.includes(kw)) {
        hasOldShares = true;
        confidence = 'high';
        const kwIndex = searchTextForOldShares.indexOf(kw);
        const oldShareContext = searchTextForOldShares.slice(
          Math.max(0, kwIndex - 50),
          Math.min(searchTextForOldShares.length, kwIndex + 80)
        );
        console.log(`[旧股检测] ✓ 发现${kw}: ${oldShareContext}`);
        evidenceList.push({
          source: '《全球發售的架構》章节',
          keyword: kw,
          context: oldShareContext,
        });
        break;
      } else {
        console.log(`[旧股检测] ✗ 未发现${kw}`);
      }
    }
  }

  // -------- 第三层：检查《售股股東》章节是否存在 --------
  const textNoSpaceForSeller = text.replace(/\s+/g, '');
  const sellingShareholderSection = extractSection(
    textNoSpaceForSeller,
    [/售股股東/i, /售股股东/i, /SELLINGSHAREHOLDER/i],
    [/風險因素/i, /财务资料/i, /附錄/i],
    30000
  );

  console.log(`[旧股检测] 售股股東章节长度: ${sellingShareholderSection?.length || 0}`);

  if (sellingShareholderSection && sellingShareholderSection.length > 500) {
    if (!hasOldShares) {
      hasOldShares = true;
      confidence = 'very_high';
    }
    const shareholderContext = sellingShareholderSection.slice(0, 300);
    console.log(`[旧股检测] ✓ 发现售股股東章节`);
    evidenceList.push({
      source: '《售股股東》章节存在',
      keyword: '售股股東专属章节',
      context: shareholderContext,
    });
  }

  console.log(`[旧股检测] 结果: hasOldShares=${hasOldShares}, confidence=${confidence}`);

  // -------- 汇总旧股检测结果（V5：梯度评分）--------
  if (hasOldShares) {
    let oldShareScore = -2; // 默认：检测到旧股但无具体比例
    let details = '存在销售股份，原始股东套现';

    if (newSharesCount && saleSharesCount) {
      const newN  = parseInt(String(newSharesCount).replace(/,/g, ''), 10);
      const saleN = parseInt(String(saleSharesCount).replace(/,/g, ''), 10);
      if (!isNaN(newN) && !isNaN(saleN) && newN + saleN > 0) {
        const total     = newN + saleN;
        const saleRatio = saleN / total;
        const salePct   = (saleRatio * 100).toFixed(1);
        details = `新股${newSharesCount}股 + 旧股${saleSharesCount}股（旧股占比${salePct}%）`;
        // 梯度评分：占比 >50% → -2，20-50% → -1，<20% → 0
        if (saleRatio > 0.50)      oldShareScore = -2;
        else if (saleRatio > 0.20) oldShareScore = -1;
        else                       oldShareScore = 0;
        console.log(`[旧股检测] 旧股占比${salePct}% → 梯度分=${oldShareScore}`);
      }
    }

    scores.oldShares = {
      score: oldShareScore,
      reason: oldShareScore === 0 ? '旧股占比低' : oldShareScore === -1 ? '旧股适中' : '有旧股发售',
      details,
      evidence: {
        confidence,
        sources: evidenceList,
        originalStatement: globalOfferingStatement,
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
        confidence: confidence || 'high',
        originalStatement: globalOfferingStatement || '未找到明确的发售股份数目声明',
        sources: evidenceList,
        note: '未在全球發售章节发现銷售股份关键词',
      }
    };
  }
  
  // ========== 2. 保荐人评分（优化版：基于目录定位章节）==========
  // 核心判断逻辑：
  // - 通过目录页码定位"董事及參與全球發售的各方"章节
  // - 查找"聯席保薦人"或"獨家保薦人"后面跟的公司名称
  // - 输出：保荐人名称、保荐数量、首日涨幅、证据原文

  console.log(`\n[保荐人] ========== 开始 ==========`);

  let sponsorSection = '';
  let sponsorSectionTitle = '';
  let extractedSponsors = []; // 从文本中直接提取的保荐人名称

  // 用去空格版本搜索章节
  const textNoSpaceForSponsor = text.replace(/\s+/g, '');

  // -------- 策略1: 通过目录定位章节 --------
  const tocPatterns = [
    /董事、監事及參與全球發售的各方\.{2,}\s*(\d+)/i,
    /董事及參與全球發售的各方\.{2,}\s*(\d+)/i,
    /參與全球發售的各方\.{2,}\s*(\d+)/i,
    /董事、监事及参与全球发售的各方\.{2,}\s*(\d+)/i,
    /PARTIESINVOLVEDINTHEGLOBALOFFERING\.{2,}\s*(\d+)/i,
  ];

  const titlePatterns = [
    /董事、監事及參與全球發售的各方/i,
    /董事及參與全球發售的各方/i,
    /參與全球發售的各方/i,
    /参与全球发售的各方/i,
    /PARTIESINVOLVED/i,
  ];

  const endPatterns = [
    /公司資料/i, /公司资料/i,
    /行業概覽/i, /行业概览/i,
    /監管概覽/i, /监管概览/i,
    /CORPORATEINFORMATION/i,
    /INDUSTRYOVERVIEW/i,
  ];

  // 优先使用目录定位
  let partiesSection = extractSectionByTOC(
    textNoSpaceForSponsor,
    tocPatterns,
    titlePatterns,
    endPatterns,
    40000
  );

  // 如果目录定位失败，回退到普通搜索
  if (!partiesSection || partiesSection.length < 200) {
    console.log(`[保荐人] 目录定位失败，回退到普通搜索`);
    partiesSection = extractSection(
      textNoSpaceForSponsor,
      titlePatterns,
      endPatterns,
      40000,
      true // 跳过目录
    );
  }

  console.log(`[保荐人] 參與全球發售的各方章节长度: ${partiesSection?.length || 0}`);

  if (partiesSection && partiesSection.length > 200) {
    sponsorSection = partiesSection;
    sponsorSectionTitle = '參與全球發售的各方';
    console.log(`[保荐人] ✓ 找到章节，前300字: ${partiesSection.slice(0, 300)}`);

    // 从章节中提取保荐人名称
    // 策略：找到保薦人标题作为START，找到"協調人"/"保薦人兼"作为END
    // 校验START→END之间内容≥50字，不足则跳过继续找下一个END（防止合并标题内部误截断）
    // 兼容有换行（PDF正常解析）和无换行（PDF文本被压平）两种格式
    // 兜底：提取公司时遇到重复公司名即停止

    // ===== 步骤1：定位保荐人区块 =====

    // 1a. 匹配保荐人标题（START）
    const sponsorTitleRegex = new RegExp(
      `(?:` +
        // 合并标题优先匹配（防止被短模式截断）
        `聯\\s*席\\s*保\\s*薦\\s*人\\s*及\\s*保\\s*薦\\s*人\\s*兼\\s*整\\s*體\\s*協\\s*調\\s*人` +
        `|聯\\s*席\\s*保\\s*薦\\s*人\\s*兼\\s*整\\s*體\\s*協\\s*調\\s*人` +
        `|聯\\s*席\\s*保\\s*薦\\s*人` +
        `|獨\\s*家\\s*保\\s*薦\\s*人` +
        // 简体支持
        `|联\\s*席\\s*保\\s*荐\\s*人\\s*及\\s*保\\s*荐\\s*人\\s*兼\\s*整\\s*体\\s*协\\s*调\\s*人` +
        `|联\\s*席\\s*保\\s*荐\\s*人` +
        `|独\\s*家\\s*保\\s*荐\\s*人` +
      `)`,
      'i'
    );

    const titleMatch = sponsorSection.match(sponsorTitleRegex);

    if (!titleMatch) {
      console.warn('[Sponsor] 未匹配到保荐人标题');
      return [];
    }

    const titleStart = titleMatch.index;
    const titleEnd = titleMatch.index + titleMatch[0].length;

    console.log(`[保荐人] 标题: "${titleMatch[0].trim()}", 位置: ${titleStart}-${titleEnd}`);

    // 1b. 判断数据格式：有换行 vs 无换行（PDF解析后可能无换行）
    const afterTitle = sponsorSection.slice(titleEnd);
    const nonEmptyLines = afterTitle.split('\n').filter(l => l.trim()).length;
    const isMultiLine = afterTitle.includes('\n') && nonEmptyLines > 3;

    console.log(`[保荐人] 数据格式: ${isMultiLine ? '有换行' : '无换行'}, 非空行数: ${nonEmptyLines}`);

    // 1c. 查找END位置
    const endKeywords = [
      `保\\s*薦\\s*人\\s*兼`,
      `整\\s*體\\s*協\\s*調\\s*人`,
      `協\\s*調\\s*人`,
      `包\\s*銷\\s*商`,
      // 简体
      `保\\s*荐\\s*人\\s*兼`,
      `整\\s*体\\s*协\\s*调\\s*人`,
      `协\\s*调\\s*人`,
      `包\\s*销\\s*商`,
    ];

    let endPos = -1;
    const MIN_BLOCK_LENGTH = 50; // START→END之间最少字符数（一个公司名+地址约30-40字）

    if (isMultiLine) {
      // 有换行：只用换行锚定END（更精确，不会被行内内容干扰）
      const endRegex = new RegExp(`\\n[ \\t]*(?:${endKeywords.join('|')})`, 'gi');
      let candidateMatch;
      while ((candidateMatch = endRegex.exec(afterTitle)) !== null) {
        if (candidateMatch.index >= MIN_BLOCK_LENGTH) {
          endPos = titleEnd + candidateMatch.index;
          console.log(`[保荐人] 找到有效END(换行锚定), 位置: ${endPos}, 区块长度: ${candidateMatch.index}`);
          break;
        } else {
          console.log(`[保荐人] 跳过候选END(${candidateMatch.index}字): "${candidateMatch[0].trim()}"`);
        }
      }
      // 有换行但没找到合格END → 取到末尾（由重复公司名检测兜底，如分行角色格式）
      if (endPos < 0) {
        console.log(`[保荐人] 有换行模式-未找到合格END，取到章节末尾`);
      }
    } else {
      // 无换行：直接匹配关键词
      const endRegex = new RegExp(`(?:${endKeywords.join('|')})`, 'gi');
      let candidateMatch;
      while ((candidateMatch = endRegex.exec(afterTitle)) !== null) {
        if (candidateMatch.index >= MIN_BLOCK_LENGTH) {
          endPos = titleEnd + candidateMatch.index;
          console.log(`[保荐人] 找到有效END(无换行), 位置: ${endPos}, 区块长度: ${candidateMatch.index}`);
          break;
        } else {
          console.log(`[保荐人] 跳过候选END(${candidateMatch.index}字): "${candidateMatch[0]}"`);
        }
      }
      if (endPos < 0) {
        console.log(`[保荐人] 无换行模式-未找到合格END，取到章节末尾`);
      }
    }

    let sponsorBlock;
    if (endPos > 0) {
      sponsorBlock = sponsorSection.slice(titleStart, endPos);
    } else {
      sponsorBlock = sponsorSection.slice(titleStart);
    }

    console.log('✅ Sponsor区块匹配成功');
    console.log('[保荐人] 区块长度:', sponsorBlock.length);
    console.log('[保荐人] 前200字:', sponsorBlock.slice(0, 200));

    // 后面所有 sponsorBlock 处理逻辑全部基于这个 sponsorBlock

    if (sponsorBlock) {
      console.log(`[保荐人] 保荐人区块长度: ${sponsorBlock.length}, 前200字: ${sponsorBlock.slice(0, 200)}`);

      // ===== 步骤2：提取公司名 =====
      // 兜底保护：遇到重复公司名即停止（防止取到末尾时多提取下一角色的公司）

      // 角色标题清理正则（去掉行内的角色前缀）
      const roleTitleCleanPattern = /(?:聯\s*席\s*保\s*薦\s*人\s*及\s*保\s*薦\s*人\s*兼\s*整\s*體\s*協\s*調\s*人|聯\s*席\s*保\s*薦\s*人|獨\s*家\s*保\s*薦\s*人|保\s*薦\s*人\s*兼\s*整\s*體\s*協\s*調\s*人|整\s*體\s*協\s*調\s*人|聯\s*席\s*全\s*球\s*協\s*調\s*人|聯\s*席\s*賬\s*簿\s*管\s*理\s*人|聯\s*席\s*牽\s*頭\s*經\s*辦\s*人|資\s*本\s*市\s*場\s*中\s*介\s*人|按英文首字母排序)/g;

      let hitDuplicate = false;

      if (isMultiLine) {
        // ---- 有换行：逐行提取（每行独立匹配，避免跨行粘连） ----
        const lines = sponsorBlock.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || hitDuplicate) continue;

          // 步骤2a：英文公司名（以Limited结尾）
          const enMatch = trimmed.match(/([A-Z][A-Za-z0-9.()&',\-\s]+Limited)/);
          if (enMatch) {
            let companyName = enMatch[1].trim();
            const isLikelyAddress = /^(Floor|Room|Suite|Level|Unit)/i.test(companyName);
            if (companyName.length >= 15 && companyName.length <= 80 && !isLikelyAddress) {
              if (extractedSponsors.includes(companyName)) {
                hitDuplicate = true;
                console.log(`[保荐人] 重复公司名停止: ${companyName}`);
              } else {
                extractedSponsors.push(companyName);
                console.log(`[保荐人] 提取(英文): ${companyName}`);
              }
            }
            continue;
          }

          // 步骤2b：中文公司名（以有限公司/有限責任公司结尾）
          const cnMatch = trimmed.match(/([\u4e00-\u9fa5（）()\s]+有\s*限\s*(?:責\s*任\s*)?公\s*司)/);
          if (cnMatch) {
            let companyName = cnMatch[1];
            companyName = companyName.replace(roleTitleCleanPattern, '');
            companyName = companyName.replace(/^[\s,、，及兼]+/, '');
            companyName = companyName.replace(/\s+/g, '');
            if (companyName.length < 6 || companyName.length > 50) continue;
            if (!/有限(責任)?公司$/.test(companyName)) continue;
            if (/^(香港|九龍|新界|中環)/.test(companyName)) continue;

            if (extractedSponsors.includes(companyName)) {
              hitDuplicate = true;
              console.log(`[保荐人] 重复公司名停止: ${companyName}`);
            } else {
              extractedSponsors.push(companyName);
              console.log(`[保荐人] 提取: ${companyName}`);
            }
          }
        }
      } else {
        // ---- 无换行：全局正则提取（适配PDF文本被压平的情况） ----
        console.log(`[保荐人] 使用无换行全局提取模式`);

        // 英文公司（支持无空格如 J.P.MorganSecurities(FarEast)Limited）
        const enRegex = /([A-Z][A-Za-z0-9.()&',\-\s]*?Limited)/g;
        let enMatch;
        while ((enMatch = enRegex.exec(sponsorBlock)) !== null) {
          let companyName = enMatch[1].trim();
          const isLikelyAddress = /^(Floor|Room|Suite|Level|Unit)/i.test(companyName);
          if (companyName.length >= 10 && companyName.length <= 80 && !isLikelyAddress) {
            if (extractedSponsors.includes(companyName)) {
              hitDuplicate = true;
              console.log(`[保荐人] 重复公司名停止: ${companyName}`);
              break;
            } else {
              extractedSponsors.push(companyName);
              console.log(`[保荐人] 提取(英文): ${companyName}`);
            }
          }
        }

        // 中文公司（无换行格式，全局匹配）
        const cnRegex = /([\u4e00-\u9fa5（）()]+有限(?:責任)?公司)/g;
        let cnMatch;
        while ((cnMatch = cnRegex.exec(sponsorBlock)) !== null && !hitDuplicate) {
          let companyName = cnMatch[1];
          companyName = companyName.replace(roleTitleCleanPattern, '');
          companyName = companyName.replace(/^[,、，及兼]+/, '');
          // 去掉地址尾巴粘连（如"29樓中信建投..." → 开头的"樓"/"號"/"室"/"座"）
          companyName = companyName.replace(/^[樓號室座層]+/, '');
          companyName = companyName.replace(/\s+/g, '');

          if (companyName.length < 6 || companyName.length > 50) continue;
          if (!/有限(責任)?公司$/.test(companyName)) continue;
          if (/^(香港|九龍|新界|中環)/.test(companyName)) continue;

          if (extractedSponsors.includes(companyName)) {
            hitDuplicate = true;
            console.log(`[保荐人] 重复公司名停止: ${companyName}`);
          } else {
            extractedSponsors.push(companyName);
            console.log(`[保荐人] 提取: ${companyName}`);
          }
        }
      }
    }

    // 备用策略：如果上面没提取到，尝试直接匹配"XXX證券/資本/金融有限公司"
    if (extractedSponsors.length === 0) {
      const fallbackMatches = sponsorSection.match(/[\u4e00-\u9fa5]+(?:證券|证券|資本|资本|融資|融资|金融|投資|投资)[\u4e00-\u9fa5]*有限公司/gi);
      if (fallbackMatches) {
        for (const company of fallbackMatches) {
          const cleanName = company.trim().replace(/\s+/g, '');
          if (cleanName.length >= 6 && !extractedSponsors.includes(cleanName)) {
            extractedSponsors.push(cleanName);
            console.log(`[保荐人] 备用提取: ${cleanName}`);
          }
        }
      }
    }
  }


  // -------- 策略2: 在釋義章节查找定义格式 --------
  if (extractedSponsors.length === 0) {
    // 查找「聯席保薦人」指 XXX 的定义格式
    const defPatterns = [
      /「聯席保薦人」\s*指\s*([^「」]+?)(?=「|$)/gi,
      /「獨家保薦人」\s*指\s*([^「」]+?)(?=「|$)/gi,
      /「联席保荐人」\s*指\s*([^「」]+?)(?=「|$)/gi,
    ];

    for (const pattern of defPatterns) {
      const match = text.match(pattern);
      if (match) {
        const defText = match[1];
        sponsorSectionTitle = '釋義章节';
        // 解析保荐人名称（可能用"、"或"及"分隔）
        const names = defText.split(/[、及和,，]/);
        for (const name of names) {
          const cleanName = name.trim()
            .replace(/\s+/g, '')
            .replace(/[（(][^）)]*[）)]$/, ''); // 去除尾部括号
          if (cleanName.length >= 4 &&
              (cleanName.includes('公司') || cleanName.includes('Limited'))) {
            if (!extractedSponsors.includes(cleanName)) {
              extractedSponsors.push(cleanName);
            }
          }
        }
        break;
      }
    }
  }

  // -------- 策略3: 兜底 - 在全文搜索保荐人关键词 --------
  if (extractedSponsors.length === 0) {
    sponsorSection = textNoSpaceForSponsor.slice(0, 120000);
    sponsorSectionTitle = '招股书前120000字（兜底）';
    console.log(`[保荐人] ✗ 未从章节提取到保荐人，使用兜底策略`);
  }

  console.log(`[保荐人] 提取到的保荐人: ${extractedSponsors.length > 0 ? extractedSponsors.join(', ') : '无'}`);

  const searchTextForSponsor = sponsorSection || textNoSpaceForSponsor.slice(0, 120000);
  const foundSponsors = [];

  // 如果已从文本中提取到保荐人名称，优先使用这些名称在数据库中查找业绩
  if (extractedSponsors.length > 0) {
    for (const extractedName of extractedSponsors) {
      // 在保荐人数据库中查找匹配
      let matched = false;
      console.log(`[保荐人匹配] 尝试匹配: "${extractedName}"`);
      console.log(`[保荐人匹配] 标准化后: "${normalizeText(extractedName)}"`);
      for (const [dbName, data] of Object.entries(SPONSORS)) {
        const match1 = matchSponsorName(extractedName, dbName);
        const match2 = matchSponsorName(dbName, extractedName);
        if (match1 || match2) {
          console.log(`[保荐人匹配] ✓ 匹配成功: "${extractedName}" <-> "${dbName}"`);
          // 找到匹配的保荐人数据
          if (!foundSponsors.some(s => s.extractedName === extractedName)) {
            foundSponsors.push({
              extractedName, // 从招股书中提取的原始名称
              name: dbName,  // 数据库中的名称
              ...data,
              matchContext: extractedName,
            });
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        console.log(`[保荐人匹配] ✗ 未找到匹配，数据库中的保荐人列表:`);
        const dbNames = Object.keys(SPONSORS).slice(0, 10);
        for (const dbName of dbNames) {
          console.log(`[保荐人匹配]   - "${dbName}" (标准化: "${normalizeText(dbName)}")`);
        }
      }
      // 即使数据库中没有匹配，也记录提取到的名称
      if (!matched && !foundSponsors.some(s => s.extractedName === extractedName)) {
        foundSponsors.push({
          extractedName,
          name: extractedName,
          rate: null,
          count: null,
          winRate: null,
          matchContext: extractedName,
        });
      }
    }
  } else {
    // 使用原来的数据库遍历匹配方式
    for (const [name, data] of Object.entries(SPONSORS)) {
      if (matchSponsorName(searchTextForSponsor, name)) {
        if (!foundSponsors.some(s => Math.abs((s.rate || 0) - (data.rate || 0)) < 0.01 && s.count === data.count)) {
          const nameIndex = searchTextForSponsor.indexOf(name);
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
  }

  const sponsorEvidence = {
    section: sponsorSectionTitle || '參與全球發售的各方章节',
    extractedFromText: extractedSponsors, // 直接从文本提取的保荐人名称
    matchedCount: foundSponsors.length,
    allMatched: foundSponsors.map(s => ({
      extractedName: s.extractedName,
      dbName: s.name,
      name: s.name,  // 前端使用 name 字段
      avgFirstDay: s.rate,
      rate: s.rate,  // 前端使用 rate 字段
      count: s.count,
      winRate: s.winRate,
    })),
  };

  if (foundSponsors.length > 0) {
    // 使用加权平均涨幅（按承销案例数量加权），更准确反映联席保荐人整体质量
    const sponsorsWithData = foundSponsors.filter(s => s.rate !== null && s.count && s.count >= 8);
    const allSponsorsSorted = foundSponsors.slice().sort((a, b) => (b.count || 0) - (a.count || 0));

    let weightedRate = 0;
    let totalCount = 0;
    let sponsorRate = 0;
    let sponsorCount = 0;

    if (sponsorsWithData.length > 0) {
      // 加权平均：每个保荐人的权重为其历史案例数
      totalCount = sponsorsWithData.reduce((sum, s) => sum + s.count, 0);
      weightedRate = sponsorsWithData.reduce((sum, s) => sum + s.rate * s.count, 0) / totalCount;
      sponsorRate = weightedRate;
      sponsorCount = totalCount;
    } else {
      // 所有保荐人数据不足，使用案例数最多的那个
      const mainSponsor = allSponsorsSorted[0];
      sponsorRate = mainSponsor.rate || 0;
      sponsorCount = mainSponsor.count || 0;
    }

    const sponsorNamesStr = allSponsorsSorted.slice(0, 2).map(s => (s.name || '未知').substring(0, 12)).join('、');
    const rateStr = `加权平均 ${sponsorRate >= 0 ? '+' : ''}${sponsorRate.toFixed(1)}%`;

    // V5：破发率检查 — winRate < 0.4 直接 -2（首日破发概率 > 60%）
    const weightedWinRate = sponsorsWithData.length > 0
      ? sponsorsWithData.reduce((s, sp) => s + (sp.winRate || 0) * sp.count, 0) / totalCount
      : (allSponsorsSorted[0]?.winRate || 1);

    if (sponsorsWithData.length === 0 && sponsorCount < 5) { // V5: 阈值从8降至5
      scores.sponsor = {
        score: 0,
        reason: '数据不足',
        details: `${sponsorNamesStr} (数据不足，需≥5单)`,
        sponsors: allSponsorsSorted.slice(0, 3),
        evidence: { ...sponsorEvidence, scoreRule: '保荐人历史案例<5单，数据不足不评分', weightedRate: null },
      };
    } else if (weightedWinRate < 0.40) {
      // V5: 破发率>60% 直接最低分
      scores.sponsor = {
        score: -2,
        reason: '低质保荐团队（高破发率）',
        details: `${sponsorNamesStr} 加权首日上涨率${(weightedWinRate * 100).toFixed(0)}%（破发率>60%）`,
        sponsors: allSponsorsSorted.slice(0, 3),
        evidence: { ...sponsorEvidence, scoreRule: '加权首日上涨率<40%（破发率>60%），-2分', weightedRate: sponsorRate.toFixed(1) },
      };
    } else if (sponsorRate >= 70) {
      scores.sponsor = {
        score: 2,
        reason: '优质保荐团队',
        details: `${sponsorNamesStr} ${rateStr}`,
        sponsors: allSponsorsSorted.slice(0, 3),
        evidence: { ...sponsorEvidence, scoreRule: '加权平均涨幅≥70%，+2分', weightedRate: sponsorRate.toFixed(1) },
      };
    } else if (sponsorRate >= 40) {
      scores.sponsor = {
        score: 0,
        reason: '中等保荐团队',
        details: `${sponsorNamesStr} ${rateStr}`,
        sponsors: allSponsorsSorted.slice(0, 3),
        evidence: { ...sponsorEvidence, scoreRule: '加权平均涨幅40-70%，0分', weightedRate: sponsorRate.toFixed(1) },
      };
    } else {
      scores.sponsor = {
        score: -2,
        reason: '低质保荐团队',
        details: `${sponsorNamesStr} ${rateStr}`,
        sponsors: allSponsorsSorted.slice(0, 3),
        evidence: { ...sponsorEvidence, scoreRule: '加权平均涨幅<40%，-2分', weightedRate: sponsorRate.toFixed(1) },
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
        const fallbackSorted = fallbackFoundSponsors.slice().sort((a, b) => (b.count || 0) - (a.count || 0));
        const fbWithData = fallbackFoundSponsors.filter(s => s.rate !== null && s.count && s.count >= 8);

        let rate = 0;
        let count = 0;
        if (fbWithData.length > 0) {
          const totalCnt = fbWithData.reduce((sum, s) => sum + s.count, 0);
          rate = fbWithData.reduce((sum, s) => sum + s.rate * s.count, 0) / totalCnt;
          count = totalCnt;
        } else {
          const mainSponsor = fallbackSorted[0];
          rate = mainSponsor.rate || 0;
          count = mainSponsor.count || 0;
        }

        const fallbackName = fallbackSorted.slice(0, 2).map(s => (s.name || '未知').substring(0, 12)).join('、');
        const rateStr = `加权平均 ${rate >= 0 ? '+' : ''}${rate.toFixed(1)}%`;

        sponsorEvidence.source = 'IPO映射表（备用方案）';
        sponsorEvidence.stockCode = stockCodeFromText;
        sponsorEvidence.matchedCount = fallbackFoundSponsors.length;
        sponsorEvidence.allMatched = fallbackFoundSponsors.map(s => ({
          name: s.name,
          rate: s.rate,
          count: s.count,
          winRate: s.winRate,
        }));

        if (fbWithData.length === 0 && count < 8) {
          scores.sponsor = {
            score: 0,
            reason: '数据不足',
            details: `${fallbackName} (数据不足，需≥8单) [备用]`,
            sponsors: fallbackSorted.slice(0, 3),
            evidence: { ...sponsorEvidence, scoreRule: '保荐人历史案例<8单，数据不足不评分' },
          };
        } else if (rate >= 70) {
          scores.sponsor = {
            score: 2,
            reason: '优质保荐团队',
            details: `${fallbackName} ${rateStr} [备用]`,
            sponsors: fallbackSorted.slice(0, 3),
            evidence: { ...sponsorEvidence, scoreRule: '加权平均涨幅≥70%，+2分', weightedRate: rate.toFixed(1) },
          };
        } else if (rate >= 40) {
          scores.sponsor = {
            score: 0,
            reason: '中等保荐团队',
            details: `${fallbackName} ${rateStr} [备用]`,
            sponsors: fallbackSorted.slice(0, 3),
            evidence: { ...sponsorEvidence, scoreRule: '加权平均涨幅40-70%，0分', weightedRate: rate.toFixed(1) },
          };
        } else {
          scores.sponsor = {
            score: -2,
            reason: '低质保荐团队',
            details: `${fallbackName} ${rateStr} [备用]`,
            sponsors: fallbackSorted.slice(0, 3),
            evidence: { ...sponsorEvidence, scoreRule: '加权平均涨幅<40%，-2分', weightedRate: rate.toFixed(1) },
          };
        }
      } else {
        // 从映射表找到了保荐人名称，但在数据库中没有业绩记录
        const fallbackList = (fallbackSponsors || []).join('、') || '未知';
        scores.sponsor = {
          score: 0,
          reason: '无业绩记录',
          details: `保荐人: ${fallbackList.substring(0, 40)}... (无历史业绩)`,
          sponsors: (fallbackSponsors || []).map(name => ({ name })),
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

  // V5：头部保荐人加分（如果基础分 < +2，且命中顶级保荐人，则 +1，封顶 +2）
  const TOP_SPONSORS = [
    '高盛', 'Goldman Sachs', 'Goldman',
    '摩根士丹利', 'Morgan Stanley',
    '摩根大通', 'J.P. Morgan', 'JPMorgan',
    '瑞银', 'UBS',
    '中金', '中国国际金融', 'CICC',
    '中信里昂', '中信证券', 'CLSA', 'CITIC',
    '海通国际', 'Haitong',
    '华泰国际', 'HTSC',
    '招银国际', 'CMBI',
    '建银国际', 'CCBI',
  ];
  const allExtractedNames = (scores.sponsor.sponsors || []).map(s => s.name || '').join(' ');
  const isTopSponsor = TOP_SPONSORS.some(ts =>
    allExtractedNames.includes(ts) || extractedSponsors.some(n => n.includes(ts))
  );
  if (isTopSponsor && scores.sponsor.score < 2) {
    scores.sponsor.score = Math.min(2, scores.sponsor.score + 1);
    scores.sponsor.reason += '（含头部保荐人+1）';
    console.log(`[保荐人] V5头部保荐人加分 → score=${scores.sponsor.score}`);
  }

  // ========== 3. 基石投资者（优化版：基于目录定位章节+表格解析）==========
  console.log(`\n[基石投资者] ========== 开始 ==========`);

  // 使用去空格版本搜索
  const textNoSpaceForCornerstone = text.replace(/\s+/g, '');

  // -------- 策略1: 通过目录定位基石投资者章节 --------
  console.log(`[基石投资者] 尝试目录定位...`);

  // 目录中基石投资者的模式（包含页码）
  const cornerstone_tocPatterns = [
    /基石投資者\.{2,}\s*(\d+)/i,
    /基石投资者\.{2,}\s*(\d+)/i,
    /CORNERSTONEINVESTORS?\.{2,}\s*(\d+)/i,
    /基石投資\.{2,}\s*(\d+)/i,
  ];

  // 章节标题模式
  const cornerstone_titlePatterns = [
    /基石投資者/i,
    /基石投资者/i,
    /CORNERSTONEINVESTORS?/i,
  ];

  // 结束标记模式
  const cornerstone_endPatterns = [
    /風險因素/i, /风险因素/i,
    /行業概覽/i, /行业概览/i,
    /概要/i, /SUMMARY/i,
    /歷史、重組/i, /历史、重组/i,
    /業務/i, /业务/i,
  ];

  // 优先使用目录定位
  let cornerstoneSection = extractSectionByTOC(
    textNoSpaceForCornerstone,
    cornerstone_tocPatterns,
    cornerstone_titlePatterns,
    cornerstone_endPatterns,
    80000  // 基石投资者章节可能较长，包含表格
  );

  // 如果目录定位失败，回退到普通搜索
  if (!cornerstoneSection || cornerstoneSection.length < 200) {
    console.log(`[基石投资者] 目录定位失败，回退到普通搜索`);
    cornerstoneSection = extractSection(
      textNoSpaceForCornerstone,
      cornerstone_titlePatterns,
      cornerstone_endPatterns,
      50000,
      true // 跳过目录
    );
  }

  console.log(`[基石投资者] 基石章节长度: ${cornerstoneSection?.length || 0}`);

  // -------- 策略2: 从表格中提取投资者名称 --------

    // ===== 新版表格解析 =====
    const tableInvestors = extractCornerstoneInvestorsFromSection(cornerstoneSection);

 

    console.log(`[基石投资者] 表格/列表共提取 ${tableInvestors.length} 个投资者`);
    if (tableInvestors.length > 0) {
      console.log(`[基石投资者] 提取结果: ${tableInvestors.map(inv => inv.name).join(', ')}`);
    }
  

  // 如果没有基石投资者章节，只在摘要/概要部分搜索（前15万字）
  // 避免在财务数据等无关内容中误匹配
  let investorSearchText = cornerstoneSection;
  if (!cornerstoneSection) {
    console.log(`[基石投资者] 无基石专属章节，使用概要/摘要搜索`);
    // 备用：在招股书概要部分搜索
    const summarySection = extractSection(
      textNoSpaceForCornerstone,
      [/概要/i, /摘要/i, /SUMMARY/i],
      [/風險因素/i, /风险因素/i, /行業概覽/i],
      100000
    );
    investorSearchText = summarySection || textNoSpaceForCornerstone.slice(0, 150000);
    console.log(`[基石投资者] 概要章节长度: ${summarySection?.length || 0}`);
  }
  const normalizedInvestorText = normalizeText(investorSearchText);

  // 词边界检查函数（用于短英文缩写，避免GIC匹配AGIC，CIC匹配CICC等）
  const isInvestorWordBoundaryMatch = (text, keyword) => {
    // 纯中文关键词不需要词边界检查
    if (/^[\u4e00-\u9fa5]+$/.test(keyword)) {
      return text.includes(keyword);
    }
    // 短的英文/数字关键词（<=5字符）需要严格的词边界检查
    if (/^[A-Za-z0-9]+$/.test(keyword) && keyword.length <= 5) {
      // 使用词边界正则匹配
      const regex = new RegExp(`(?:^|[^A-Za-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^A-Za-z0-9])`, 'i');
      return regex.test(text);
    }
    // 其他关键词用普通的includes
    return text.includes(keyword);
  };

  // 验证匹配是否在基石投资者相关上下文中（避免在公司名称、缩写词表等处误匹配）
  const isValidCornerstoneContext = (searchText, keyword, index) => {
    if (index === -1) return false;



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

    // 排除缩写词表上下文（多个连续的大写缩写）
    const words = context.split(/\s+/);
    let upperCount = 0;
    for (const w of words) {
      if (/^[A-Z0-9\-]{2,}$/.test(w)) upperCount++;
    }
    if (words.length > 5 && upperCount / words.length > 0.6) return false;
    return true;
  };

  const foundInvestorDetails = [];


 // -------- 策略3: 明星基石匹配（双重来源 + 别名库）--------
console.log(`[基石投资者] 开始明星基石匹配...`);

for (const [starName, aliases] of Object.entries(STAR_CORNERSTONE_MAP)) {

  let matched = false;
  let matchContext = '';
  let matchSource = '';
  let hitAlias = '';

  for (const alias of aliases) {
    const normalizedAlias = normalizeText(alias);

    // ===== 来源1：正文匹配 =====
    if (
      isInvestorWordBoundaryMatch(investorSearchText, alias) ||
      isInvestorWordBoundaryMatch(normalizedInvestorText, normalizedAlias)
    ) {
      const invIndex = investorSearchText.toLowerCase().indexOf(alias.toLowerCase());

      if (isValidCornerstoneContext(investorSearchText, alias, invIndex)) {
        matched = true;
        matchSource = '原文匹配';
        hitAlias = alias;
        matchContext = invIndex !== -1
          ? investorSearchText.slice(Math.max(0, invIndex - 20), Math.min(investorSearchText.length, invIndex + alias.length + 40)).replace(/\s+/g, ' ')
          : '';
      }
    }

    // ===== 来源2：表格投资者匹配 =====
    if (!matched && tableInvestors.length > 0) {
      for (const tableInv of tableInvestors) {
        const tableInvName = tableInv.name;
        const normalizedTableInv = normalizeText(tableInvName);

        if (
          isInvestorWordBoundaryMatch(tableInvName, alias) ||
          normalizedTableInv.includes(normalizedAlias)
        ) {
          matched = true;
          matchSource = '表格匹配';
          hitAlias = alias;
          matchContext = `表格投资者: ${tableInvName} (${tableInv.amount}百万)`;
          console.log(`[基石投资者] ✓ 表格匹配: "${alias}" -> "${tableInvName}"`);
          break;
        }
      }
    }

    if (matched) break; // 命中一个别名就不再继续该明星机构
  }

  if (matched) {
    foundInvestorDetails.push({
      keyword: starName,
      alias: hitAlias,
      context: matchContext,
      source: matchSource
    });
    console.log(`[基石投资者] ✓ 匹配明星基石: ${starName} (命中别名: ${hitAlias}, 来源: ${matchSource})`);
  }
}


// -------- 表格反向匹配（补漏机制）--------
if (tableInvestors.length > 0) {
  console.log(`[基石投资者] 反向匹配表格投资者...`);

  for (const tableInv of tableInvestors) {
    const tableInvName = tableInv.name;
    const normalizedTableInv = normalizeText(tableInvName);

    for (const [starName, aliases] of Object.entries(STAR_CORNERSTONE_MAP)) {

      if (foundInvestorDetails.find(d => d.keyword === starName)) continue;

      for (const alias of aliases) {
        const normalizedAlias = normalizeText(alias);

        if (
          tableInvName.toLowerCase().includes(alias.toLowerCase()) ||
          normalizedTableInv.includes(normalizedAlias)
        ) {
          foundInvestorDetails.push({
            keyword: starName,
            alias,
            context: `表格投资者: ${tableInvName} (${tableInv.amount}百万)`,
            source: '表格反向匹配'
          });
          console.log(`[基石投资者] ✓ 表格反向匹配: "${tableInvName}" 命中 "${alias}" (${starName})`);
          break;
        }
      }
    }
  }
}

console.log(`[基石投资者] 匹配结果: ${foundInvestorDetails.length}个 - ${foundInvestorDetails.map(d => d.keyword).join(', ') || '无'}`);


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
    section: cornerstoneSection ? '基石投資者章节（目录定位）' : '招股书概要/前15万字',
    sectionLength: investorSearchText.length,
    matchedKeywords: foundInvestorDetails.map(d => d.keyword),
    matchedContexts: foundInvestorDetails.slice(0, 3).map(d => d.context),
    matchSources: foundInvestorDetails.slice(0, 3).map(d => d.source || '原文匹配'),
    tableExtracted: tableInvestors.map(inv => `${inv.name} (${inv.amount}百万)`),
    starList: '高瓴、红杉、淡马锡、GIC、黑石、贝莱德、中投公司、社保基金等',
  };

  console.log(`[基石投资者] ========== 完成 ==========`);

  // V5：区分明星基石数量（≥3家 +2，1-2家 +1，无 0）
  if (uniqueInvestors.length >= 3) {
    scores.cornerstone = {
      score: 2,
      reason: `有明星基石(${uniqueInvestors.length}家)`,
      details: uniqueInvestors.join(', '),
      investors: uniqueInvestors,
      evidence: { ...cornerstoneEvidence, scoreRule: `≥3家明星基石，+2分` },
    };
  } else if (uniqueInvestors.length > 0) {
    scores.cornerstone = {
      score: 1,
      reason: `有明星基石(${uniqueInvestors.length}家)`,
      details: uniqueInvestors.join(', '),
      investors: uniqueInvestors,
      evidence: { ...cornerstoneEvidence, scoreRule: `1-2家明星基石，+1分` },
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
  
  // ========== 4. Pre-IPO禁售期（风控优先：仅限历史发展章节）==========
  console.log(`\n[禁售期] ========== 开始 ==========`);

  const textNoSpaceForLockup = text.replace(/\s+/g, '');

  // 只允许在指定章节识别（禁止跨章节）
  const HISTORY_SECTION_START_PATTERNS = [
    /歷史與發展/i,
    /歷史及發展/i,
    /歷史、重組及公司架構/i,
    /歷史、重組及公司發展/i,
    /歷史、重組及企業架構/i,
    /公司歷史、重組及公司架構/i,
    /公司歷史及重組/i,
    /發展歷程/i,
    /業務發展歷史/i,
    /历史与发展/i,
    /历史及发展/i,
    /历史、重组及公司架构/i,
    /历史、重组及公司发展/i,
    /历史、重组及企业架构/i,
    /公司历史、重组及公司架构/i,
    /公司历史及重组/i,
    /发展历程/i,
    /业务发展历史/i,
  ];
  const HISTORY_SECTION_END_PATTERNS = [
    // 注意：不能使用 /業務|业务/ 这类短词，否则会在历史章节正文中误触发提前截断
    /行業概覽/i, /行业概览/i, /INDUSTRYOVERVIEW/i,
    /基石投資者/i, /基石投资者/i, /CORNERSTONEINVESTORS?/i,
    /全球發售的架構/i, /全球发售的架构/i, /STRUCTUREOFTHEGLOBALOFFERING/i,
    /股份發售的架構/i, /股份发售的架构/i,
  ];

  // Step 1：Pre-IPO识别关键词
  const PREIPO_PATTERNS = [
    /首次公開發售前投資者/i,
    /首次公開發售前投資/i,
    /首次公开发售前投资者/i,
    /首次公开发售前投资/i,
    /上市前投資者/i,
    /上市前投資/i,
    /上市前投资者/i,
    /上市前投资/i,
    /Pre-IPO\s*Investment/i,
    /Pre-IPO\s*Investors?/i,
    /上市前引入投資者/i,
    /上市前引入投资者/i,
    /上市前融資/i,
    /上市前融资/i,
    /投資者於上市前入股/i,
    /投资者于上市前入股/i,
  ];

  const STRATEGIC_PREIPO_RE = /引入戰略投資者|引入战略投资者/i;

  // Step 2：禁售关键词（强信号）
  const LOCKUP_POSITIVE_PATTERNS = [
    /禁售期/i,
    /鎖定期/i,
    /锁定期/i,
    /禁售安排/i,
    /lock-up/i,
    /不得出售/i,
    /不得轉讓/i,
    /不得转让/i,
    /出售限制/i,
    /受禁售限制/i,
    /受若干禁售承諾所規限/i,
    /受若干禁售承诺所规限/i,
    /六個月|6個月|六个月|6个月|180天/i,
    /十二個月|12個月|十二个月|12个月/i,
    /二十四個月|24個月|二十四个月|24个月/i,
    /自上市日期起.{0,30}不得出售/i,
    /上市後.{0,30}不得出售/i,
    /上市后.{0,30}不得出售/i,
  ];

  // 明确无禁售（强负面）
  const LOCKUP_NEGATIVE_PATTERNS = [
    /並無任何禁售安排/i,
    /并无任何禁售安排/i,
    /未設禁售期/i,
    /未设禁售期/i,
    /不受任何出售限制/i,
    /並不受任何出售限制/i,
    /不受任何轉讓限制/i,
    /不受任何转让限制/i,
  ];

  // 强制防误判：非Pre-IPO主体
  const EXCLUDE_SUBJECT_MARKERS = [
    '控股股東', '控股股东',
    '基石投資者', '基石投资者',
    '承銷協議', '承销协议',
    '綠鞋', '绿鞋', '借股',
  ];
  const PREIPO_SUBJECT_MARKERS = [
    '首次公開發售前投資者', '首次公開發售前投資',
    '首次公开发售前投资者', '首次公开发售前投资',
    '上市前投資者', '上市前投資', '上市前投资者', '上市前投资',
    'Pre-IPO',
  ];

  let hasPreIPOInvestment = false;
  let hasLockup = false;
  let preIPOContext = '';
  let lockupContext = '';
  let lockupNegativeContext = '';
  let preIPOSectionTitle = '';
  let lockupConfidence = 'medium';
  let lockupScore = 0;
  let lockupReason = '';
  let lockupDetails = '';
  let lockupScoreRule = '';
  const decisionPath = [];

  const historySection = extractSection(
    textNoSpaceForLockup,
    HISTORY_SECTION_START_PATTERNS,
    HISTORY_SECTION_END_PATTERNS,
    260000,
    true
  );

  console.log(`[禁售期] 历史发展章节长度: ${historySection?.length || 0}`);
  if (historySection) {
    console.log(`[禁售期] 历史发展章节前120字: ${historySection.slice(0, 120)}`);
    console.log(`[禁售期] 历史发展章节后120字: ${historySection.slice(Math.max(0, historySection.length - 120))}`);
    const quickLockupProbes = ['禁售', '鎖定', '锁定', 'lock-up', '不得出售', '不得轉讓', '出售限制'];
    const probeSummary = quickLockupProbes.map(k => `${k}:${historySection.includes(k) ? 'Y' : 'N'}`).join(', ');
    console.log(`[禁售期] 历史章节禁售探针: ${probeSummary}`);

    // 额外诊断：检查“从历史章节标题起260k窗口”的探针，确认是否因章节截断导致漏检
    let historyStartIdx = -1;
    for (const sp of HISTORY_SECTION_START_PATTERNS) {
      const m = textNoSpaceForLockup.match(sp);
      if (m && m.index !== undefined) {
        historyStartIdx = m.index;
        break;
      }
    }
    if (historyStartIdx >= 0) {
      const rawHistoryWindow = textNoSpaceForLockup.slice(historyStartIdx, Math.min(textNoSpaceForLockup.length, historyStartIdx + 260000));
      const rawProbeSummary = quickLockupProbes.map(k => `${k}:${rawHistoryWindow.includes(k) ? 'Y' : 'N'}`).join(', ');
      console.log(`[禁售期] 历史标题后260k窗口禁售探针: ${rawProbeSummary}`);
      console.log(`[禁售期] 截断诊断: extractedLen=${historySection.length}, rawWindowLen=${rawHistoryWindow.length}`);
    }
  }

  if (!historySection) {
    decisionPath.push('未找到限定历史发展章节 -> 不做跨章节识别');
  } else {
    preIPOSectionTitle = '歷史/發展相关章节';
    decisionPath.push('已定位限定章节（历史发展范围）');

    let preIPOMatch = null;
    for (const re of PREIPO_PATTERNS) {
      const m = historySection.match(re);
      if (m) {
        preIPOMatch = m;
        console.log(`[禁售期] ✓ 命中Pre-IPO模式: ${re} -> "${m[0]}"`);
        break;
      }
    }

    if (!preIPOMatch) {
      const strategicMatch = historySection.match(STRATEGIC_PREIPO_RE);
      if (strategicMatch) {
        const idx = strategicMatch.index || 0;
        const nearby = historySection.slice(Math.max(0, idx - 50), Math.min(historySection.length, idx + 80));
        if (/上市前/.test(nearby)) {
          preIPOMatch = strategicMatch;
          console.log(`[禁售期] ✓ 命中战略投资者语义补充: "${strategicMatch[0]}" (含上市前语境)`);
        } else {
          console.log(`[禁售期] ✗ 命中战略投资者词但无上市前语境，忽略`);
        }
      }
    }

    if (preIPOMatch) {
      hasPreIPOInvestment = true;
      const idx = preIPOMatch.index || 0;
      preIPOContext = historySection.slice(Math.max(0, idx - 60), Math.min(historySection.length, idx + 160));
      decisionPath.push(`命中Pre-IPO关键词: "${preIPOMatch[0]}"`);
      console.log(`[禁售期] Pre-IPO上下文: ${preIPOContext.slice(0, 180)}`);

      // 按最新规则：禁售识别范围改为整个“历史/发展”章节（不再限制Pre-IPO附近窗口）
      const lockupBlock = historySection;
      const isPreIPOInvestorContext = (snippet) => {
        const hasPreIPOMarker = PREIPO_SUBJECT_MARKERS.some(m => snippet.includes(m));
        const hasExclude = EXCLUDE_SUBJECT_MARKERS.some(m => snippet.includes(m));
        // 全章节扫描时：优先排除明显非Pre-IPO主体；若附近未出现Pre-IPO标记，
        // 但本章节已确认存在Pre-IPO投资者，也可继续判定禁售（满足“全章节查找”要求）
        return !hasExclude && (hasPreIPOMarker || hasPreIPOInvestment);
      };

      const findValidMatchWithLog = (patterns, tag) => {
        let rawHitCount = 0;
        let rejectedCount = 0;
        for (const re of patterns) {
          const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
          const gRe = new RegExp(re.source, flags);
          let mm;
          while ((mm = gRe.exec(lockupBlock)) !== null) {
            rawHitCount++;
            const hitIdx = mm.index || 0;
            const near = lockupBlock.slice(Math.max(0, hitIdx - 120), Math.min(lockupBlock.length, hitIdx + 220));
            const hasExclude = EXCLUDE_SUBJECT_MARKERS.some(m => near.includes(m));
            const hasPreIPOMarker = PREIPO_SUBJECT_MARKERS.some(m => near.includes(m));
            if (!isPreIPOInvestorContext(near)) {
              rejectedCount++;
              console.log(`[禁售期] ✗ ${tag}命中但被过滤: "${mm[0]}", hasExclude=${hasExclude}, hasPreIPOMarker=${hasPreIPOMarker}, 上下文=${near.slice(0, 120)}`);
              continue;
            }
            console.log(`[禁售期] ✓ ${tag}有效命中: "${mm[0]}", 上下文=${near.slice(0, 160)}`);
            return { match: mm, near, rawHitCount, rejectedCount };
          }
        }
        console.log(`[禁售期] ${tag}扫描结束: 原始命中=${rawHitCount}, 过滤=${rejectedCount}, 有效=0`);
        return { match: null, near: '', rawHitCount, rejectedCount };
      };

      // CASE 2：明确无禁售（强负面）
      const negHit = findValidMatchWithLog(LOCKUP_NEGATIVE_PATTERNS, '负面禁售');
      if (negHit.match) {
        const m = negHit.match;
        const near = negHit.near;
        hasLockup = false;
        lockupNegativeContext = near.slice(0, 220);
        decisionPath.push(`命中明确无禁售表达: "${m[0]}"`);
      }

      // CASE 1：明确有禁售
      if (!lockupNegativeContext) {
        const posHit = findValidMatchWithLog(LOCKUP_POSITIVE_PATTERNS, '正面禁售');
        if (posHit.match) {
          const m = posHit.match;
          const near = posHit.near;
          hasLockup = true;
          lockupContext = near.slice(0, 260);
          decisionPath.push(`命中禁售强信号: "${m[0]}"`);
        }
      }
    } else {
      decisionPath.push('限定章节内未命中Pre-IPO关键词');
      console.log(`[禁售期] ✗ 未识别到Pre-IPO关键词，跳过禁售识别`);
    }
  }

  // Step 3：风控优先评分
  if (!hasPreIPOInvestment) {
    hasLockup = false;
    lockupScore = 0;
    lockupConfidence = 'medium';
    lockupReason = '无Pre-IPO';
    lockupDetails = '限定历史发展章节内未识别到Pre-IPO投资者';
    lockupScoreRule = '无Pre-IPO投资者，0分';
  } else if (lockupNegativeContext) {
    hasLockup = false;
    lockupScore = -2;
    lockupConfidence = 'high';
    lockupReason = 'Pre-IPO明确无禁售';
    lockupDetails = '检测到“并无任何禁售安排/未设禁售期/不受出售限制”等明确负面表达';
    lockupScoreRule = '明确无禁售，-2分（高风险）';
  } else if (hasLockup) {
    lockupScore = 0;
    lockupConfidence = 'high';
    lockupReason = 'Pre-IPO有禁售安排';
    lockupDetails = '检测到禁售强信号（禁售期/锁定期/不得出售/时间型约束）';
    lockupScoreRule = '明确有禁售，0分（安全）';
  } else {
    // CASE 3：风控优先 - 未明确披露禁售即视为无禁售
    hasLockup = false;
    lockupScore = -2;
    lockupConfidence = 'medium';
    lockupReason = 'Pre-IPO未披露禁售';
    lockupDetails = '存在Pre-IPO投资者，但未检测到明确禁售安排（按风控规则视为无禁售）';
    lockupScoreRule = '存在Pre-IPO但未披露禁售，-2分（风控）';
    decisionPath.push('Pre-IPO存在但未命中禁售强信号 -> 风控判定为无禁售');
  }

  console.log(`[禁售期] 结果: hasPreIPO=${hasPreIPOInvestment}, hasLockup=${hasLockup}, score=${lockupScore}, confidence=${lockupConfidence}`);

  const lockupEvidence = {
    hasPreIPO: hasPreIPOInvestment,
    hasLockup,
    score: lockupScore,
    confidence: lockupConfidence,
    evidence: lockupNegativeContext || lockupContext || preIPOContext || '',
    reason: lockupScoreRule,
    decisionPath,
    section: preIPOSectionTitle || '未找到限定章节',
    preIPOContext,
    lockupContext,
    negativeLockupContext: lockupNegativeContext,
  };

  scores.lockup = {
    score: lockupScore,
    reason: lockupReason,
    details: lockupDetails,
    evidence: lockupEvidence,
  };

  // ========== 5. 行业评分（基于炒作逻辑）==========
  console.log(`\n[行业] ========== 开始 ==========`);

  // 使用去空格版本搜索
  const textNoSpaceForIndustry = text.replace(/\s+/g, '');
  const industrySection = extractSection(
    textNoSpaceForIndustry,
    [/行業概覽/i, /行业概览/i, /INDUSTRYOVERVIEW/i, /業務/i, /业务/i, /BUSINESS/i],
    [/監管/i, /监管/i, /董事/i, /REGULATORY/i, /DIRECTOR/i],
    100000
  );

  console.log(`[行业] 行業概覽章节长度: ${industrySection?.length || 0}`);

  const industrySearchText = (industrySection && industrySection.length > 500) ? industrySection : textNoSpaceForIndustry.slice(0, 250000);
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

  // ===== 行业识别引擎 v3（标题权重 + 关键词密度竞争）=====
  //
  // 为什么用竞争式评分而非"回避覆盖一切"：
  //   半导体MCU公司招股书后段会提到"房地産"作为智能门锁的应用市场，
  //   但该公司的MCU关键词出现次数远超"房地産"，竞争评分天然过滤此类噪声。
  //   真正的房地产公司，其"房地産"/"物業管理"在行业概览开头高密度出现，
  //   得分会远超任何正面赛道关键词，自然胜出。
  //
  // 算法：
  //   1. 从章节标题提取行业名（"XXX行业/市场/产业"）→ 每次命中 ×5
  //   2. 统计全文各类别关键词总频次 → 每次出现 ×1
  //   3. 综合得分 = titleScore + kwScore，取最高分类别为主导行业

  const escapeForRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 计算关键词在文本中的出现次数（短英文词使用词边界匹配）
  const countKw = (text, kw) => {
    const escaped = escapeForRegex(kw);
    if (/^[A-Za-z0-9]+$/.test(kw) && kw.length <= 5) {
      // 短英文词：词边界匹配，避免"MCUS"误匹配"MCU"
      const re = new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^A-Za-z0-9])`, 'gi');
      return (text.match(re) || []).length;
    }
    const re = new RegExp(escaped, 'g');
    return (text.match(re) || []).length;
  };

  // Step 1: 从标题提取行业名（匹配"XXX行业/行業/产业/產業/市场/市場"前缀词）
  const TITLE_SUFFIX_RE = /([A-Za-z0-9\u4e00-\u9fa5]{2,20}?)(行業|行业|產業|产业|市場|市场)/g;
  const extractedTitles = [];
  let tm;
  while ((tm = TITLE_SUFFIX_RE.exec(industrySearchText)) !== null) {
    extractedTitles.push(tm[1]);
  }
  const uniqueTitles = [...new Set(extractedTitles)];
  console.log(`[行业] 标题词(${uniqueTitles.length}个): ${uniqueTitles.slice(0, 8).join(' / ') || '无'}`);

  // Step 2+3: 对每个行业类别计算综合得分
  const industryRankings = INDUSTRY_DEFS.map(def => {
    // 关键词频次统计（在原始文本 + 归一化文本中各查一遍，取最大值避免重复计算）
    let kwCount = 0;
    const matchedKws = [];
    for (const kw of def.keywords) {
      const cnt = Math.max(
        countKw(industrySearchText, kw),
        countKw(normalizedIndustryText, normalizeText(kw))
      );
      if (cnt > 0) {
        kwCount += cnt;
        matchedKws.push(`${kw}(${cnt})`);
      }
    }

    // 标题匹配：提取的标题词中是否包含本类别的关键词
    let titleCount = 0;
    for (const titleWord of extractedTitles) {
      const matched = def.keywords.some(kw =>
        titleWord.includes(kw) ||
        kw.includes(titleWord) ||
        normalizeText(titleWord).includes(normalizeText(kw)) ||
        normalizeText(kw).includes(normalizeText(titleWord))
      );
      if (matched) titleCount++;
    }

    const totalScore = titleCount * 5 + kwCount;
    return { def, titleCount, kwCount, matchedKws, totalScore };
  });

  // 过滤零分，按综合得分降序，同分按priority降序
  const ranked = industryRankings
    .filter(r => r.totalScore > 0)
    .sort((a, b) =>
      b.totalScore !== a.totalScore
        ? b.totalScore - a.totalScore
        : b.def.priority - a.def.priority
    );

  // 日志：打印前5名
  console.log(`[行业] 行业得分排名(前5):`);
  ranked.slice(0, 5).forEach((r, i) => {
    console.log(`  #${i + 1} ${r.def.name}: 总分=${r.totalScore}(标题×5=${r.titleCount * 5}, 关键词=${r.kwCount}), 匹配=[${r.matchedKws.slice(0, 4).join(', ')}]`);
  });

  // Step 4: 选出主导行业，写入评分变量
  const winner = ranked.length > 0 ? ranked[0] : null;
  if (winner) {
    const d = winner.def;
    industryScore = d.trackScore;
    industryReason = d.trackReason;
    industryDetails = d.trackDetails;
    trackType = d.trackType;
    // 取频次最高的关键词作为代表词
    const topKwEntry = winner.matchedKws[0] || '';
    matchedKeyword = topKwEntry.replace(/\(\d+\)$/, '');
    matchedContext = getContext(matchedKeyword);
    console.log(`[行业] ✓ 主导行业: ${d.name}, 总分=${winner.totalScore}, 赛道=${d.trackType}(${d.trackScore}分)`);
  } else {
    console.log(`[行业] ✗ 未识别出明确行业，中性评分(0分)`);
  }

  console.log(`[行业] 结果: score=${industryScore}, track=${trackType}, keyword=${matchedKeyword || '无'}`);

  // 构造结构化证据（供前端展示与调试）
  const industryCategory = winner ? winner.def.name : '未识别';
  const matchedKeywords = winner ? winner.matchedKws : [];
  const confidenceScore = winner ? winner.totalScore : 0;
  const titleMatchCount = winner ? winner.titleCount : 0;

  const industryEvidence = {
    section: industrySection ? '行業概覽/業務章节' : '招股书前250000字',
    sectionLength: industrySearchText.length,
    // v3新增字段
    industryCategory,           // 归一化后的标准行业名称
    matchedKeywords,            // 贡献得分的关键词列表（格式："词(次数)"）
    confidenceScore,            // 综合置信度得分（titleMatches×5 + kwCount×1）
    titleMatchCount,            // 标题命中次数
    // 兼容旧字段
    matchedKeyword,
    matchedContext,
    trackCategories: {
      hot: 'AI/机器人/自动驾驶/半导体/创新药/低空经济（+2分）',
      growth: '医疗器械/新能源/SaaS/软件服务/新消费（+1分）',
      neutral: '无明显偏好（0分）',
      low: '传统消费/制造/公用事业/物流（-1分）',
      avoid: '物管/房地产/小贷/教培/纺织/博彩（-2分）',
    },
    scoreRule: winner
      ? `主导行业"${industryCategory}"，置信度=${confidenceScore}（标题命中×5=${titleMatchCount * 5}，关键词总频次=${winner.kwCount}）`
      : '未匹配到任何行业关键词',
    // 全行业排名（调试用，前5名）
    industryRankTop5: ranked.slice(0, 5).map(r => ({
      name: r.def.name,
      score: r.totalScore,
      titleScore: r.titleCount * 5,
      kwScore: r.kwCount,
      topKeywords: r.matchedKws.slice(0, 3),
    })),
  };

  scores.industry = {
    score: industryScore,
    reason: industryReason,
    details: industryDetails,
    track: trackType,
    evidence: industryEvidence,
  };

  // ========== V5 新增：PE 估值评分 ==========
  console.log(`\n[PE] ========== 开始 ==========`);
  try {
    // 1. 发行价：优先 etnet，备选 PDF 提取
    let offerPriceMid = etnetData?.offerPriceMid || null;
    if (!offerPriceMid) {
      // PDF 中搜索发行价
      const priceMatch = /發售價[^\d]*\$([\d.]+)\s*至\s*\$([\d.]+)/.exec(text.replace(/\s+/g, ''))
                      || /招股價[^\d]*\$([\d.]+)/.exec(text.replace(/\s+/g, ''));
      if (priceMatch) {
        const nums = priceMatch.slice(1).map(Number).filter(n => n > 0);
        offerPriceMid = nums.length === 1 ? nums[0] : (nums[0] + nums[1]) / 2;
      }
    }

    // 2. 总股本：从 PDF 提取（关键：不能用 H 股市值）
    const sharesResult = extractTotalShares(text);
    const totalShares  = sharesResult.totalShares;

    // 3. 净利润：从 PDF 提取
    const profitResult  = extractNetProfit(text);
    const netProfitHKD  = profitResult.hkdAmount;

    // 4. 同行 PE：通过 etnet 行业代码查询
    let peerMedianPE = null;
    const industry = etnetData?.industry || null;
    if (industry) {
      try {
        const codeMap   = await buildIndustryCodeMap();
        const natureCode = codeMap[industry];
        if (natureCode) {
          const peData   = await getComparablePE(natureCode);
          peerMedianPE   = peData.median;
          console.log(`[PE] 行业"${industry}"(${natureCode}) 同行PE中位数=${peerMedianPE}`);
        } else {
          console.log(`[PE] 行业"${industry}"未找到nature代码`);
        }
      } catch (e) {
        console.warn(`[PE] 行业PE查询失败: ${e.message}`);
      }
    }

    console.log(`[PE] offerPriceMid=${offerPriceMid}, totalShares=${totalShares?.toLocaleString()}, netProfitHKD=${netProfitHKD?.toLocaleString()}, peerPE=${peerMedianPE}`);
    const peResult  = scorePE(offerPriceMid, totalShares, netProfitHKD, peerMedianPE);
    scores.pe = {
      score:   peResult.score,
      reason:  peResult.reason,
      details: peResult.details,
      evidence: {
        ...peResult.evidence,
        sharesSource:  sharesResult.source,
        sharesConfidence: sharesResult.confidence,
        profitSource:  profitResult.source,
        industry,
        scoreRule: `ratio=${peResult.evidence.ratio?.toFixed(3) || 'N/A'}，PE评分规则：<0.7→+3, <0.85→+2, <0.95→+1, 0.95-1.05→0, >1.05→-1, >1.15→-2, >1.3→-3`,
      },
    };
  } catch (e) {
    console.error(`[PE] 评分异常: ${e.message}`);
    scores.pe = { score: 0, reason: 'PE：计算异常', details: e.message, evidence: {} };
  }

  // ========== V5 新增：募资规模评分 ==========
  console.log(`\n[募资规模] ========== 开始 ==========`);
  try {
    // 优先 etnet ipoProceeds，备选 PDF 提取
    let ipoProceeds = etnetData?.ipoProceeds || null;

    if (!ipoProceeds) {
      // PDF 中搜索净募资额（港元）
      const noSpace = text.replace(/\s+/g, '');
      const m = /所得款項凈額約([\d.]+)(?:億|百萬)?港元/.exec(noSpace)
             || /净募资额约([\d.]+)億港元/.exec(noSpace);
      if (m) {
        const v = parseFloat(m[1]);
        ipoProceeds = m[0].includes('億') ? Math.round(v * 1e8) : Math.round(v * 1e6);
      }
    }

    let ipoSizeScore = 0;
    let ipoSizeReason = '募资规模';
    let ipoSizeDetails = '无募资数据';

    if (ipoProceeds && ipoProceeds > 0) {
      const proceedsHKDHundredMillion = ipoProceeds / 1e8;
      ipoSizeDetails = `募资约${proceedsHKDHundredMillion.toFixed(2)}亿港元`;

      if (ipoProceeds >= 3e8 && ipoProceeds <= 20e8) {
        // 3亿-20亿：最佳区间，流动性好且机构可参与
        ipoSizeScore  = 1;
        ipoSizeReason = '募资规模适中(+1)';
      } else if (ipoProceeds < 1e8) {
        // <1亿：迷你盘，流动性差
        ipoSizeScore  = -1;
        ipoSizeReason = '募资规模过小(-1)';
      } else if (ipoProceeds > 50e8) {
        // >50亿：巨型IPO，易破发
        ipoSizeScore  = -1;
        ipoSizeReason = '募资规模过大(-1)';
      } else {
        // 1-3亿 或 20-50亿：中性
        ipoSizeScore  = 0;
        ipoSizeReason = '募资规模中性(0)';
      }
    }

    scores.ipoSize = {
      score:   ipoSizeScore,
      reason:  ipoSizeReason,
      details: ipoSizeDetails,
      evidence: {
        ipoProceeds,
        source: etnetData?.ipoProceeds ? 'etnet' : 'PDF',
        scoreRule: '3-20亿→+1，1-3亿/20-50亿→0，<1亿/>50亿→-1',
      },
    };
    console.log(`[募资规模] ${ipoSizeReason}: ${ipoSizeDetails}`);
  } catch (e) {
    console.error(`[募资规模] 计算异常: ${e.message}`);
    scores.ipoSize = { score: 0, reason: '募资规模：计算异常', details: e.message, evidence: {} };
  }

  // ========== 计算总分（V5）==========
  // 总分范围: [-12, +10]
  // oldShares[-2,0] + sponsor[-2,+2] + cornerstone[0,+2] + lockup[-2,0] +
  // industry[-2,+2] + pe[-3,+3] + ipoSize[-1,+1]
  const totalScore = Object.values(scores).reduce((sum, item) => sum + item.score, 0);

  // V5 评级阈值（上调，因新增PE维度最高可+3）
  let rating;
  if      (totalScore >= 7)  rating = '强烈推荐';
  else if (totalScore >= 4)  rating = '建议申购';
  else if (totalScore >= 2)  rating = '可以考虑';
  else if (totalScore >= 0)  rating = '谨慎申购';
  else                       rating = '不建议';

  console.log(`[评分] V5完成: 总分${totalScore}, ${rating}`);
  console.log(`[评分] 各维度: 旧股${scores.oldShares.score} 保荐人${scores.sponsor.score} 基石${scores.cornerstone.score} 禁售${scores.lockup.score} 行业${scores.industry.score} PE${scores.pe.score} 募资${scores.ipoSize.score}`);

  return {
    stockCode:   formatStockCode(stockCode),
    totalScore,
    rating,
    scores,
    // 展示项（不计入总分）
    display: {
      hasGreenShoe,
      subscriptionMultiple: etnetData?.subscriptionMultiple || null,
      listingDate:          etnetData?.listingDate || null,
    },
    _version: 'v5',
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

// 带超时的Promise包装器
function withTimeout(promise, ms, message = '操作超时') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 自动保存评分记录到IPO列表（用户评分即数据）
function saveScoreToIPOList(stockCode, scoreResult, prospectusInfo) {
  try {
    const IPO_LIST_JSON = path.join(DATA_DIR, 'ipo-list.json');

    // 读取现有数据
    let data = {
      updateTime: new Date().toISOString(),
      count: 0,
      source: 'user-scored',
      ipos: []
    };

    if (fs.existsSync(IPO_LIST_JSON)) {
      try {
        data = JSON.parse(fs.readFileSync(IPO_LIST_JSON, 'utf-8'));
      } catch (e) {
        console.log('[保存] IPO列表读取失败，创建新列表');
      }
    }

    // 检查是否已存在（去重）
    let existingIPO = data.ipos.find(ipo => ipo.code === stockCode);

    if (existingIPO) {
      // 更新现有记录
      existingIPO.score = scoreResult.totalScore;
      existingIPO.rating = scoreResult.rating;
      existingIPO.scoreDetails = scoreResult.scores;
      existingIPO.lastUpdate = new Date().toISOString();
      if (prospectusInfo) {
        existingIPO.name = prospectusInfo.name || existingIPO.name;
      }
      console.log(`[保存] 更新现有记录: ${stockCode} - ${scoreResult.totalScore}分`);
    } else {
      // 添加新记录
      const newIPO = {
        code: stockCode,
        name: prospectusInfo?.name || `股票${stockCode}`,
        industry: '待分类',
        status: 'scored', // 标记为已评分
        score: scoreResult.totalScore,
        rating: scoreResult.rating,
        scoreDetails: scoreResult.scores,
        lastUpdate: new Date().toISOString(),
        prospectus: prospectusInfo ? {
          title: prospectusInfo.title,
          link: prospectusInfo.link
        } : null
      };

      data.ipos.unshift(newIPO); // 添加到开头
      console.log(`[保存] 新增记录: ${stockCode} - ${scoreResult.totalScore}分`);
    }

    // 更新元数据
    data.count = data.ipos.length;
    data.updateTime = new Date().toISOString();
    data.source = 'user-scored';

    // 保存到文件
    fs.writeFileSync(IPO_LIST_JSON, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[保存] ✓ 已保存到 ipo-list.json，共 ${data.count} 条记录`);

  } catch (error) {
    console.error(`[保存] 保存评分记录失败:`, error.message);
    // 不中断主流程，仅记录错误
  }
}

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
      // 搜索招股书（带120秒超时保护）
      const searchResults = await withTimeout(
        searchProspectus(code),
        120000,
        '搜索招股书超时，该股票可能暂无招股书或港交所响应缓慢，请稍后重试'
      );

      if (searchResults.length === 0) {
        return res.json({
          success: false,
          error: '未找到招股书，请确认股票代码正确且已上市',
        });
      }

      console.log(`[API] 找到 ${searchResults.length} 个候选PDF，逐个尝试验证...`);

      // 逐个尝试下载和验证PDF
      let lastError = null;
      for (let i = 0; i < searchResults.length; i++) {
        const candidate = searchResults[i];
        console.log(`[API] 尝试第 ${i + 1}/${searchResults.length} 个: ${candidate.link.substring(0, 60)}...`);

        try {
          pdfText = await downloadAndParsePDF(candidate.link, code, candidate.name || '');
          prospectusInfo = candidate;
          console.log(`[API] ✓ 第 ${i + 1} 个PDF验证通过`);
          break; // 找到有效的招股书，退出循环
        } catch (err) {
          console.log(`[API] ✗ 第 ${i + 1} 个PDF验证失败: ${err.message}`);
          lastError = err;
          // continue 到下一个PDF
        }
      }

      // 所有PDF都验证失败
      if (!pdfText) {
        return res.json({
          success: false,
          error: `尝试了 ${searchResults.length} 个PDF都验证失败，最后一个错误: ${lastError?.message || '未知错误'}`,
        });
      }
    }

    // 评分
    const scoreResult = await scoreProspectus(pdfText, code);

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

    // 🎯 自动保存评分记录（用户评分即数据）
    saveScoreToIPOList(code, scoreResult, prospectusInfo);

    res.json(response);

  } catch (error) {
    console.error(`[API] 错误: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ==================== 首页IPO数据层（ETNet列表 + 缓存） ====================
const HOME_IPO_CACHE_CONFIG = {
  current: {
    file: path.join(CACHE_DIR, 'home-ipo-current.json'),
    ttlMs: 20 * 60 * 1000,
  },
  top: {
    file: path.join(CACHE_DIR, 'home-ipo-top.json'),
    ttlMs: 20 * 60 * 1000,
  },
};
const TOP_MAX_SCORE_CANDIDATES = 8;
const TOP_MAX_SCORE_CANDIDATES_HARD_LIMIT = 12;

function readJSONSafely(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.warn(`[home-ipo] 读取缓存失败: ${file} - ${e.message}`);
    return null;
  }
}

function writeJSONSafely(file, payload) {
  try {
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.warn(`[home-ipo] 写入缓存失败: ${file} - ${e.message}`);
    return false;
  }
}

function readCachePayload(cfg) {
  const data = readJSONSafely(cfg.file);
  if (!data || !data.meta || !data.data) return null;
  const ageMs = Date.now() - new Date(data.meta.updatedAt).getTime();
  return {
    raw: data,
    expired: Number.isNaN(ageMs) ? true : ageMs > cfg.ttlMs,
  };
}

function getArrayCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

function pickIpoSample(item) {
  if (!item) return null;
  return {
    code: item.code ?? null,
    name: item.name ?? null,
    status: item.status ?? null,
    statusText: item.statusText ?? null,
    listingDate: item.listingDate ?? null,
    offerEndDate: item.offerEndDate ?? null,
    offerPrice: item.offerPrice ?? null,
    boardLot: item.boardLot ?? null,
    lotSize: item.lotSize ?? null,
    entryFee: item.entryFee ?? null,
    lotAmount: item.lotAmount ?? null,
    allotmentRate: item.allotmentRate ?? null,
    firstDayChangePct: item.firstDayChangePct ?? null,
  };
}

function normalizeCurrentIpoData(raw) {
  const safe = raw || {};
  if (IPO_DEBUG) {
    console.log('[ipo/debug][normalize-start]', JSON.stringify({
      entered: true,
      inputKeys: Object.keys(safe),
      inputDataKeys: safe && safe.data && typeof safe.data === 'object' ? Object.keys(safe.data) : null,
      legacyCounts: {
        subscribing: getArrayCount(safe.subscribing),
        listingSoon: getArrayCount(safe.listingSoon),
        recentListed: getArrayCount(safe.recentListed),
      },
      newGroupInitialCounts: {
        todayGreyMarket: getArrayCount(safe.todayGreyMarket),
        todayListed: getArrayCount(safe.todayListed),
        hearingPassed: getArrayCount(safe.hearingPassed),
        recentNewStocks: getArrayCount(safe.recentNewStocks),
      },
    }, null, 2));
  }
  const subscribing = Array.isArray(safe.subscribing) ? safe.subscribing : [];
  const listingSoon = Array.isArray(safe.listingSoon) ? safe.listingSoon : [];
  const recentListed = Array.isArray(safe.recentListed) ? safe.recentListed : [];
  const todayGreyMarketRaw = Array.isArray(safe.todayGreyMarket) ? safe.todayGreyMarket : [];
  const todayListedRaw = Array.isArray(safe.todayListed) ? safe.todayListed : [];
  const hearingPassed = Array.isArray(safe.hearingPassed) ? safe.hearingPassed : [];
  const recentNewStocksRaw = Array.isArray(safe.recentNewStocks) ? safe.recentNewStocks : [];

  const hkToday = (() => {
    const now = new Date();
    const hk = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }));
    const y = hk.getFullYear();
    const m = String(hk.getMonth() + 1).padStart(2, '0');
    const d = String(hk.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  })();

  const normalizeDateOnly = (value) => {
    const text = String(value || '').trim();
    if (!text) return null;
    const m = text.match(/(\d{4})[\/.\-年](\d{1,2})[\/.\-月](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const m2 = text.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
    if (m2) return `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`;
    return null;
  };

  const hasGreyLikeSignal = (item = {}) => {
    const name = String(item.name || '');
    const listingDate = normalizeDateOnly(item.listingDate);
    const hasBasic = (item.offerPrice !== null && item.offerPrice !== undefined && item.offerPrice !== '')
      && ((item.boardLot ?? item.lotSize) !== null && (item.boardLot ?? item.lotSize) !== undefined && (item.boardLot ?? item.lotSize) !== '')
      && ((item.entryFee ?? item.lotAmount) !== null && (item.entryFee ?? item.lotAmount) !== undefined && (item.entryFee ?? item.lotAmount) !== '');
    return hasBasic
      && (/明天上市|暗盘|暗盤/.test(name)
      || (listingDate && listingDate > hkToday));
  };

  const normalizedRecentListed = recentListed.map(item => ({
    code: item.code,
    name: item.name,
    status: item.status || 'recentListed',
    listingDate: item.listingDate || null,
    offerPrice: item.offerPrice || null,
    offerPriceRange: item.offerPriceRange || null,
    subscriptionMultiple: item.subscriptionMultiple || null,
    allotmentRate: item.allotmentRate || null,
    firstDayChangePct: item.firstDayChangePct || null,
    firstDayOpen: item.firstDayOpen || null,
    firstDayClose: item.firstDayClose || null,
    lotProfit: item.lotProfit || null,
    lotSize: item.lotSize || null,
    lotAmount: item.lotAmount || null,
    boardLot: item.boardLot || null,
    entryFee: item.entryFee || null,
    currency: item.currency || null,
  }));

  const derivedRecentNewStocks = normalizedRecentListed.map(item => ({
    code: item.code || '',
    name: item.name || '',
    listingDate: item.listingDate || null,
    currency: item.currency || null,
    offerPrice: item.offerPrice ?? null,
    boardLot: item.boardLot ?? item.lotSize ?? null,
    entryFee: item.entryFee ?? item.lotAmount ?? null,
    subscriptionMultiple: item.subscriptionMultiple ?? null,
    allotmentRate: item.allotmentRate ?? null,
    firstDayChangePct: item.firstDayChangePct ?? null,
  }));

  const derivedTodayListed = normalizedRecentListed
    .filter(item => normalizeDateOnly(item.listingDate) === hkToday)
    .map(item => ({
      code: item.code || '',
      name: item.name || '',
      listingDate: item.listingDate || null,
      firstDayOpen: item.firstDayOpen ?? null,
      firstDayClose: item.firstDayClose ?? null,
      firstDayChangePct: item.firstDayChangePct ?? null,
      lotProfit: item.lotProfit ?? null,
    }));

  const derivedTodayGreyMarket = normalizedRecentListed
    .filter(hasGreyLikeSignal)
    .map(item => ({
      code: item.code || '',
      name: item.name || '',
      statusText: '暗盘/待上市',
      listingDate: item.listingDate || null,
      currency: item.currency || null,
      offerPrice: item.offerPrice ?? null,
      boardLot: item.boardLot ?? item.lotSize ?? null,
      entryFee: item.entryFee ?? item.lotAmount ?? null,
    }));

  const todayGreyMarket = todayGreyMarketRaw.length > 0 ? todayGreyMarketRaw : derivedTodayGreyMarket;
  const todayListed = todayListedRaw.length > 0 ? todayListedRaw : derivedTodayListed;
  const recentNewStocks = recentNewStocksRaw.length > 0 ? recentNewStocksRaw : derivedRecentNewStocks;

  const normalizedResult = {
    subscribing,
    listingSoon,
    recentListed: normalizedRecentListed,
    todayGreyMarket: todayGreyMarket.map(item => ({
      code: item.code || '',
      name: item.name || '',
      statusText: item.statusText || '暗盘/待上市',
      listingDate: item.listingDate || null,
      currency: item.currency || null,
      offerPrice: item.offerPrice ?? null,
      boardLot: item.boardLot ?? null,
      entryFee: item.entryFee ?? null,
    })),
    todayListed: todayListed.map(item => ({
      code: item.code || '',
      name: item.name || '',
      listingDate: item.listingDate || null,
      firstDayOpen: item.firstDayOpen ?? null,
      firstDayClose: item.firstDayClose ?? null,
      firstDayChangePct: item.firstDayChangePct ?? null,
      lotProfit: item.lotProfit ?? null,
    })),
    hearingPassed: hearingPassed.map(item => ({
      code: item.code || '',
      name: item.name || '',
      statusText: item.statusText || '',
      listingDate: item.listingDate || null,
    })),
    recentNewStocks: recentNewStocks.map(item => ({
      code: item.code || '',
      name: item.name || '',
      listingDate: item.listingDate || null,
      currency: item.currency || null,
      offerPrice: item.offerPrice ?? null,
      boardLot: item.boardLot ?? null,
      entryFee: item.entryFee ?? null,
      subscriptionMultiple: item.subscriptionMultiple ?? null,
      allotmentRate: item.allotmentRate ?? null,
      firstDayChangePct: item.firstDayChangePct ?? null,
    })),
  };
  if (IPO_DEBUG) {
    console.log('[ipo/debug][normalize-end]', JSON.stringify({
      counts: {
        subscribingCount: getArrayCount(normalizedResult.subscribing),
        listingSoonCount: getArrayCount(normalizedResult.listingSoon),
        recentListedCount: getArrayCount(normalizedResult.recentListed),
        todayGreyMarketCount: getArrayCount(normalizedResult.todayGreyMarket),
        todayListedCount: getArrayCount(normalizedResult.todayListed),
        hearingPassedCount: getArrayCount(normalizedResult.hearingPassed),
        recentNewStocksCount: getArrayCount(normalizedResult.recentNewStocks),
      },
      samples: {
        todayGreyMarketFirst: pickIpoSample(normalizedResult.todayGreyMarket[0]),
        todayListedFirst: pickIpoSample(normalizedResult.todayListed[0]),
        hearingPassedFirst: pickIpoSample(normalizedResult.hearingPassed[0]),
        recentNewStocksFirst: pickIpoSample(normalizedResult.recentNewStocks[0]),
        recentListedFirst: pickIpoSample(normalizedResult.recentListed[0]),
      },
    }, null, 2));
  }
  return normalizedResult;
}

function toLegacyCurrentFields(currentData, updatedAt) {
  return {
    updateTime: updatedAt,
    total: (currentData.subscribing?.length || 0) + (currentData.listingSoon?.length || 0) + (currentData.recentListed?.length || 0),
    subscribing: currentData.subscribing || [],
    coming: currentData.listingSoon || [],
    listed: currentData.recentListed || [],
  };
}

async function rebuildCurrentIpoData() {
  const etnetData = await crawlIPOListFromETNet();
  const normalized = normalizeCurrentIpoData(etnetData);

  const totalItems = (normalized.subscribing?.length || 0)
    + (normalized.listingSoon?.length || 0)
    + (normalized.recentListed?.length || 0);
  if (totalItems === 0) {
    throw new Error('ETNet current IPO 解析结果为空，已拒绝覆盖缓存');
  }

  const updatedAt = new Date().toISOString();

  const payload = {
    meta: {
      updatedAt,
      source: 'etnet',
    },
    data: normalized,
  };

  writeJSONSafely(HOME_IPO_CACHE_CONFIG.current.file, payload);
  return payload;
}

async function getCurrentIpoDataWithCache(options = {}) {
  const forceRefresh = options.forceRefresh === true;
  const cache = readCachePayload(HOME_IPO_CACHE_CONFIG.current);
  if (cache && IPO_DEBUG) {
    const raw = cache.raw || {};
    const rawData = raw.data || {};
    console.log('[ipo/debug][cache-raw]', JSON.stringify({
      cacheExpired: cache.expired,
      forceRefresh,
      rawKeys: Object.keys(raw),
      rawDataKeys: rawData && typeof rawData === 'object' ? Object.keys(rawData) : null,
      counts: {
        subscribing: getArrayCount(rawData.subscribing),
        listingSoon: getArrayCount(rawData.listingSoon),
        recentListed: getArrayCount(rawData.recentListed),
        todayGreyMarket: getArrayCount(rawData.todayGreyMarket),
        todayListed: getArrayCount(rawData.todayListed),
        hearingPassed: getArrayCount(rawData.hearingPassed),
        recentNewStocks: getArrayCount(rawData.recentNewStocks),
      },
      samples: {
        recentListedFirst: pickIpoSample((rawData.recentListed || [])[0]),
        todayGreyMarketFirst: pickIpoSample((rawData.todayGreyMarket || [])[0]),
        todayListedFirst: pickIpoSample((rawData.todayListed || [])[0]),
        recentNewStocksFirst: pickIpoSample((rawData.recentNewStocks || [])[0]),
      },
    }, null, 2));
  }
  if (cache && !cache.expired && !forceRefresh) {
    const counts = {
      subscribing: cache.raw.data?.subscribing?.length || 0,
      listingSoon: cache.raw.data?.listingSoon?.length || 0,
      recentListed: cache.raw.data?.recentListed?.length || 0,
      todayGreyMarket: cache.raw.data?.todayGreyMarket?.length || 0,
      todayListed: cache.raw.data?.todayListed?.length || 0,
      hearingPassed: cache.raw.data?.hearingPassed?.length || 0,
      recentNewStocks: cache.raw.data?.recentNewStocks?.length || 0,
    };
    console.log(`[home-ipo] current cache命中: updatedAt=${cache.raw.meta.updatedAt}, counts=${JSON.stringify(counts)}`);
    return {
      data: cache.raw.data,
      updatedAt: cache.raw.meta.updatedAt,
      stale: false,
      fromCache: true,
    };
  }

  try {
    const rebuilt = await rebuildCurrentIpoData();
    const counts = {
      subscribing: rebuilt.data?.subscribing?.length || 0,
      listingSoon: rebuilt.data?.listingSoon?.length || 0,
      recentListed: rebuilt.data?.recentListed?.length || 0,
      todayGreyMarket: rebuilt.data?.todayGreyMarket?.length || 0,
      todayListed: rebuilt.data?.todayListed?.length || 0,
      hearingPassed: rebuilt.data?.hearingPassed?.length || 0,
      recentNewStocks: rebuilt.data?.recentNewStocks?.length || 0,
    };
    console.log(`[home-ipo] current 刷新成功: updatedAt=${rebuilt.meta.updatedAt}, counts=${JSON.stringify(counts)}, forceRefresh=${forceRefresh}`);
    return {
      data: rebuilt.data,
      updatedAt: rebuilt.meta.updatedAt,
      stale: false,
      fromCache: false,
    };
  } catch (e) {
    if (cache) {
      console.warn(`[home-ipo] current刷新失败，回退旧缓存: ${e.message}`);
      return {
        data: cache.raw.data,
        updatedAt: cache.raw.meta.updatedAt,
        stale: true,
        fromCache: true,
      };
    }
    throw e;
  }
}

async function scoreCodeForTopRanking(code) {
  const stockCode = String(code || '').replace(/\D/g, '').padStart(5, '0');
  if (!stockCode) return null;

  try {
    let pdfText = readCache(stockCode);
    if (!pdfText) {
      const searchResults = await withTimeout(
        searchProspectus(stockCode),
        120000,
        `Top榜评分(${stockCode})搜索招股书超时`
      );
      if (!searchResults || searchResults.length === 0) return null;

      let prospectusInfo = null;
      for (let i = 0; i < searchResults.length; i++) {
        const candidate = searchResults[i];
        try {
          pdfText = await downloadAndParsePDF(candidate.link, stockCode, candidate.name || '');
          prospectusInfo = candidate;
          break;
        } catch (_) {
          // continue
        }
      }
      if (!pdfText) return null;
      // 保存评分副产物，避免重复请求
      try {
        const result = await scoreProspectus(pdfText, stockCode);
        if (result) {
          saveScoreToIPOList(stockCode, result, prospectusInfo);
          return result;
        }
      } catch (_) {
        return null;
      }
    }

    const scoreResult = await scoreProspectus(pdfText, stockCode);
    return scoreResult || null;
  } catch (e) {
    console.warn(`[home-ipo] Top榜评分失败 ${stockCode}: ${e.message}`);
    return null;
  }
}

function normalizeTopItem(item) {
  return {
    code: item.code,
    name: item.name || `股票${item.code}`,
    totalScore: item.totalScore,
    rating: item.rating || '待评级',
    scoreDetails: item.scoreDetails || null,
    status: item.status || null,
    listingDate: item.listingDate || null,
  };
}

async function rebuildTopIpoData(limit) {
  const current = await getCurrentIpoDataWithCache();
  const pool = [
    ...(current.data.subscribing || []),
    ...(current.data.listingSoon || []),
  ];

  const unique = [];
  const seen = new Set();
  for (const item of pool) {
    if (!item?.code || seen.has(item.code)) continue;
    seen.add(item.code);
    unique.push(item);
  }

  const maxCandidates = Math.min(TOP_MAX_SCORE_CANDIDATES_HARD_LIMIT, TOP_MAX_SCORE_CANDIDATES);
  const candidates = unique.slice(0, maxCandidates);

  const scored = [];
  for (const item of candidates) {
    const scoreResult = await scoreCodeForTopRanking(item.code);
    if (!scoreResult) continue;
    scored.push(normalizeTopItem({
      code: item.code,
      name: item.name,
      totalScore: scoreResult.totalScore,
      rating: scoreResult.rating,
      scoreDetails: scoreResult.scores || null,
      status: item.status,
      listingDate: item.listingDate,
    }));
  }

  scored.sort((a, b) => b.totalScore - a.totalScore);
  const topData = scored.slice(0, Math.max(1, limit));

  const payload = {
    meta: {
      updatedAt: new Date().toISOString(),
      source: 'top-score-cache',
      candidates: candidates.length,
    },
    data: topData,
  };
  writeJSONSafely(HOME_IPO_CACHE_CONFIG.top.file, payload);
  return payload;
}

async function getTopIpoDataWithCache(limit = 5) {
  const cache = readCachePayload(HOME_IPO_CACHE_CONFIG.top);
  if (cache && !cache.expired) {
    return {
      data: (cache.raw.data || []).slice(0, limit),
      updatedAt: cache.raw.meta.updatedAt,
      stale: false,
      fromCache: true,
    };
  }

  try {
    const rebuilt = await rebuildTopIpoData(limit);
    return {
      data: (rebuilt.data || []).slice(0, limit),
      updatedAt: rebuilt.meta.updatedAt,
      stale: false,
      fromCache: false,
    };
  } catch (e) {
    if (cache) {
      console.warn(`[home-ipo] top刷新失败，回退旧缓存: ${e.message}`);
      return {
        data: (cache.raw.data || []).slice(0, limit),
        updatedAt: cache.raw.meta.updatedAt,
        stale: true,
        fromCache: true,
      };
    }
    throw e;
  }
}

// ==================== 新增API：数据展示 ====================

// 获取当前IPO列表（首页时间表）
app.get('/api/ipo/current', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.force === '1';
    const current = await getCurrentIpoDataWithCache({ forceRefresh });
    const legacy = toLegacyCurrentFields(current.data, current.updatedAt);
    const subscribing = current.data?.subscribing || [];
    const listingSoon = current.data?.listingSoon || [];
    const recentListed = current.data?.recentListed || [];
    const counts = {
      subscribingCount: subscribing.length,
      listingSoonCount: listingSoon.length,
      recentListedCount: recentListed.length,
      todayGreyMarketCount: current.data?.todayGreyMarket?.length || 0,
      todayListedCount: current.data?.todayListed?.length || 0,
      hearingPassedCount: current.data?.hearingPassed?.length || 0,
      recentNewStocksCount: current.data?.recentNewStocks?.length || 0,
    };
    const summarizeCurrentItem = (item) => item ? ({
      code: item.code || '--',
      name: item.name || '--',
      status: item.status || '--',
      listingDate: item.listingDate || '--',
      offerEndDate: item.offerEndDate || '--',
      offerPrice: item.offerPrice ?? '--',
      offerPriceRange: item.offerPriceRange ?? '--',
      lotSize: item.lotSize ?? '--',
      lotAmount: item.lotAmount ?? '--',
      subscriptionMultiple: item.subscriptionMultiple ?? '--',
      allotmentRate: item.allotmentRate ?? '--',
      firstDayChangePct: item.firstDayChangePct ?? '--',
      firstDayOpen: item.firstDayOpen ?? '--',
      firstDayClose: item.firstDayClose ?? '--',
      lotProfit: item.lotProfit ?? '--',
    }) : null;
    const summarizeSimpleItem = (item) => item ? ({
      code: item.code || '--',
      name: item.name || '--',
      listingDate: item.listingDate || '--',
    }) : null;
    console.log(`[ipo/current] summary fromCache=${current.fromCache}, stale=${current.stale}, forceRefresh=${forceRefresh}, counts=${JSON.stringify(counts)}, samples=${JSON.stringify({
      subscribingFirst: summarizeCurrentItem(subscribing[0]),
      recentListedFirst: summarizeCurrentItem(recentListed[0]),
      todayGreyMarketFirst: summarizeSimpleItem((current.data?.todayGreyMarket || [])[0]),
      todayListedFirst: summarizeSimpleItem((current.data?.todayListed || [])[0]),
      hearingPassedFirst: summarizeSimpleItem((current.data?.hearingPassed || [])[0]),
      recentNewStocksFirst: summarizeSimpleItem((current.data?.recentNewStocks || [])[0]),
    })}`);
    console.log(`[API:/api/ipo/current] fromCache=${current.fromCache}, stale=${current.stale}, forceRefresh=${forceRefresh}, counts=${JSON.stringify({
      subscribing: counts.subscribingCount,
      listingSoon: counts.listingSoonCount,
      recentListed: counts.recentListedCount,
    })}`);

    const responsePayload = {
      success: true,
      data: current.data,
      updatedAt: current.updatedAt,
      stale: current.stale,
      fromCache: current.fromCache,
      // 兼容旧字段
      ...legacy,
    };
    if (IPO_DEBUG) {
      console.log('[ipo/debug][api-response]', JSON.stringify({
        responseRootKeys: Object.keys(responsePayload),
        responseDataKeys: responsePayload.data && typeof responsePayload.data === 'object' ? Object.keys(responsePayload.data) : null,
        responseDataCounts: {
          todayGreyMarket: getArrayCount(responsePayload.data?.todayGreyMarket),
          todayListed: getArrayCount(responsePayload.data?.todayListed),
          subscribing: getArrayCount(responsePayload.data?.subscribing),
          listingSoon: getArrayCount(responsePayload.data?.listingSoon),
          hearingPassed: getArrayCount(responsePayload.data?.hearingPassed),
          recentNewStocks: getArrayCount(responsePayload.data?.recentNewStocks),
          recentListed: getArrayCount(responsePayload.data?.recentListed),
        },
        rootLevelCounts: {
          subscribing: getArrayCount(responsePayload.subscribing),
          coming: getArrayCount(responsePayload.coming),
          listed: getArrayCount(responsePayload.listed),
        },
        samples: {
          todayGreyMarketFirst: pickIpoSample((responsePayload.data?.todayGreyMarket || [])[0]),
          todayListedFirst: pickIpoSample((responsePayload.data?.todayListed || [])[0]),
          recentNewStocksFirst: pickIpoSample((responsePayload.data?.recentNewStocks || [])[0]),
        },
      }, null, 2));
    }
    res.json(responsePayload);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取Top评分IPO（首页评分榜）
app.get('/api/ipo/top', async (req, res) => {
  const reqLimit = parseInt(req.query.limit, 10);
  const limit = Number.isNaN(reqLimit) ? 5 : Math.max(1, Math.min(20, reqLimit));

  try {
    const top = await getTopIpoDataWithCache(limit);

    res.json({
      success: true,
      data: top.data,
      updatedAt: top.updatedAt,
      stale: top.stale,
      // 兼容旧字段
      count: top.data.length,
      total: top.data.length,
      ipos: top.data.map(item => ({
        code: item.code,
        name: item.name,
        score: item.totalScore,
        rating: item.rating,
        scoreDetails: item.scoreDetails || null,
        status: item.status,
        listingDate: item.listingDate,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取历史IPO表现数据
app.get('/api/ipo/history', (req, res) => {
  const HISTORY_JSON = path.join(DATA_DIR, 'ipo-history.json');

  if (fs.existsSync(HISTORY_JSON)) {
    try {
      const data = JSON.parse(fs.readFileSync(HISTORY_JSON, 'utf-8'));
      res.json({
        success: true,
        ...data
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  } else {
    res.json({
      success: false,
      message: '暂无历史数据，请运行 node scripts/init-history-data.js'
    });
  }
});

// 获取市场环境统计
app.get('/api/market/stats', (req, res) => {
  const HISTORY_JSON = path.join(DATA_DIR, 'ipo-history.json');
  const IPO_LIST_JSON = path.join(DATA_DIR, 'ipo-list.json');

  try {
    let stats = {
      avgReturn: '+0%',
      breakRate: '0%',
      heatIndex: 0,
      subscriptionMultiple: '0x',
      activeIPOs: 0
    };

    // 从历史数据计算近期表现
    if (fs.existsSync(HISTORY_JSON)) {
      const history = JSON.parse(fs.readFileSync(HISTORY_JSON, 'utf-8'));

      if (history.recentIPOs && history.recentIPOs.length > 0) {
        // 取最近10只
        const recent10 = history.recentIPOs.slice(0, 10);

        // 计算平均涨幅
        const returns = recent10.map(ipo => {
          const match = ipo.firstDayReturn.match(/([+-]?\d+\.?\d*)/);
          return match ? parseFloat(match[1]) : 0;
        });
        const avgReturn = (returns.reduce((a, b) => a + b, 0) / returns.length).toFixed(1);
        stats.avgReturn = `${avgReturn > 0 ? '+' : ''}${avgReturn}%`;

        // 计算破发率
        const breakCount = returns.filter(r => r < 0).length;
        stats.breakRate = `${Math.round(breakCount / returns.length * 100)}%`;

        // 打新热度指数（简化计算）
        const positiveRate = (returns.filter(r => r > 0).length / returns.length) * 100;
        stats.heatIndex = Math.round(positiveRate * 0.7 + Math.abs(avgReturn) * 0.3);

        // 模拟超额认购倍数
        stats.subscriptionMultiple = `${(8 + Math.random() * 12).toFixed(1)}x`;
      }
    }

    // 从当前IPO列表获取活跃数量
    if (fs.existsSync(IPO_LIST_JSON)) {
      const ipoList = JSON.parse(fs.readFileSync(IPO_LIST_JSON, 'utf-8'));
      stats.activeIPOs = ipoList.ipos.filter(ipo => ipo.status === 'subscribing').length;
    }

    res.json({
      success: true,
      updateTime: new Date().toISOString(),
      stats
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== 小程序API（Phase 0） ====================

function buildMiniProgramDimensions(scores = {}) {
  const defs = [
    { key: 'oldShares', label: '旧股发售' },
    { key: 'sponsor', label: '保荐人业绩' },
    { key: 'cornerstone', label: '基石投资者' },
    { key: 'lockup', label: 'Pre-IPO禁售' },
    { key: 'industry', label: '行业赛道' },
    { key: 'pe', label: 'PE估值' },
    { key: 'ipoSize', label: '募资规模' },
  ];

  return defs
    .map(def => {
      const item = scores?.[def.key];
      if (!item || !Number.isFinite(item.score)) return null;
      return {
        key: def.key,
        label: def.label,
        score: item.score,
        summary: item.reason || '',
        detail: item.details || '',
        // 兼容旧字段（Phase 1 首页/后续页面可能已依赖）
        reason: item.reason || '',
        details: item.details || '',
      };
    })
    .filter(Boolean);
}

function normalizeRating(ratingLabel = '', score = 0) {
  const text = String(ratingLabel || '').trim();
  if (text === '强烈推荐' || text === '建议申购') return { rating: 'buy', ratingLabel: text };
  if (text === '可以考虑' || text === '谨慎申购') return { rating: 'neutral', ratingLabel: text };
  if (text === '不建议') return { rating: 'avoid', ratingLabel: text };

  if (score >= 4) return { rating: 'buy', ratingLabel: '建议申购' };
  if (score >= 0) return { rating: 'neutral', ratingLabel: '可以考虑' };
  return { rating: 'avoid', ratingLabel: '不建议' };
}

function buildMiniProgramMarketStats() {
  const HISTORY_JSON = path.join(DATA_DIR, 'ipo-history.json');
  const fallback = {
    avgReturn: null,
    breakRate: null,
    heatIndex: null,
  };

  try {
    if (!fs.existsSync(HISTORY_JSON)) return fallback;
    const history = JSON.parse(fs.readFileSync(HISTORY_JSON, 'utf-8'));
    if (!history.recentIPOs || history.recentIPOs.length === 0) return fallback;

    const recent10 = history.recentIPOs.slice(0, 10);
    const returns = recent10.map(ipo => {
      const match = String(ipo.firstDayReturn || '').match(/([+-]?\d+\.?\d*)/);
      return match ? parseFloat(match[1]) : 0;
    });
    if (returns.length === 0) return fallback;

    const avgReturnNum = returns.reduce((a, b) => a + b, 0) / returns.length;
    const breakCount = returns.filter(r => r < 0).length;
    const positiveRate = (returns.filter(r => r > 0).length / returns.length) * 100;
    const heatIndex = Math.round(positiveRate * 0.7 + Math.abs(avgReturnNum) * 0.3);

    return {
      avgReturn: Number(avgReturnNum.toFixed(1)),
      breakRate: Math.round((breakCount / returns.length) * 100),
      heatIndex,
    };
  } catch (error) {
    console.warn(`[api/mp/home] market stats build failed: ${error.message}`);
    return fallback;
  }
}

// GET /api/mp/home
// 小程序首页聚合接口：轻量榜单 + 时间表摘要 + 市场快照
app.get('/api/mp/home', async (req, res) => {
  const degraded = { topList: false, timeline: false, market: false };
  const updatedAt = new Date().toISOString();

  let timelineSummary = {
    subscribing: [],
    listingSoon: [],
    recentListed: [],
  };
  let error = null;

  try {
    const current = await getCurrentIpoDataWithCache();
    timelineSummary = {
      subscribing: (current.data?.subscribing || []).slice(0, 5).map(item => ({
        code: item.code || '',
        name: item.name || '',
        listingDate: item.listingDate || '',
        offerEndDate: item.offerEndDate || '',
        lotAmount: item.lotAmount ?? null,
      })),
      listingSoon: (current.data?.listingSoon || []).slice(0, 5).map(item => ({
        code: item.code || '',
        name: item.name || '',
        listingDate: item.listingDate || '',
        lotAmount: item.lotAmount ?? null,
      })),
      recentListed: (current.data?.recentListed || [])
        .slice()
        .sort((a, b) => String(b?.listingDate || '').localeCompare(String(a?.listingDate || '')))
        .slice(0, 20)
        .map(item => ({
          code: item.code || '',
          name: item.name || '',
          listingDate: item.listingDate || '',
          firstDayChangePct: item.firstDayChangePct ?? null,
          offerPrice: item.offerPrice ?? null,
          subscriptionMultiple: item.subscriptionMultiple ?? null,
          allotmentRate: item.allotmentRate ?? null,
        })),
    };

    const timelineTotal = timelineSummary.subscribing.length
      + timelineSummary.listingSoon.length
      + timelineSummary.recentListed.length;
    if (timelineTotal === 0) {
      degraded.timeline = true;
      error = {
        type: 'timeline_empty',
        message: 'timeline summary is empty',
      };
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      updatedAt,
      degraded: { topList: true, timeline: true, market: true },
      topList: [],
      timelineSummary,
      market: { avgReturn: null, breakRate: null, heatIndex: null },
      error: {
        type: 'timeline_fetch_failed',
        message: error.message,
      },
      errorMessage: `timeline fetch failed: ${error.message}`,
    });
  }

  let topList = [];
  try {
    const top = await withTimeout(
      getTopIpoDataWithCache(5),
      2500,
      'top list fetch timeout'
    );
    topList = (top.data || []).slice(0, 5).map(item => ({
      ...normalizeRating(item.rating || '', item.totalScore),
      code: item.code || '',
      name: item.name || '',
      score: Number.isFinite(item.totalScore) ? item.totalScore : 0,
      listingDate: item.listingDate || '',
      // 兼容旧字段（保留原语义字符串）
      legacyRating: item.rating || '',
    }));
  } catch (error) {
    degraded.topList = true;
    console.warn(`[api/mp/home] top list degraded: ${error.message}`);
  }

  let market = { avgReturn: null, breakRate: null, heatIndex: null };
  try {
    market = buildMiniProgramMarketStats();
  } catch (error) {
    degraded.market = true;
    console.warn(`[api/mp/home] market degraded: ${error.message}`);
  }

  if (market.avgReturn === null && market.breakRate === null && market.heatIndex === null) {
    degraded.market = true;
  }

  res.json({
    success: true,
    updatedAt,
    degraded,
    topList,
    timelineSummary,
    market,
    error,
    errorMessage: error?.message || null,
  });
});

// GET /api/mp/score/:code
// 小程序评分接口：统一输出结构，便于前端直接渲染
app.get('/api/mp/score/:code', async (req, res) => {
  const rawCode = String(req.params.code || '').trim();
  const code = formatStockCode(rawCode);
  const startedAt = Date.now();

  if (!code) {
    return res.status(400).json({
      success: false,
      code: rawCode || '',
      name: '',
      totalScore: 0,
      rating: '',
      elapsed: 0,
      dimensions: [],
      display: {},
      error: { type: 'invalid_code', message: 'invalid stock code' },
      errorMessage: 'invalid stock code',
    });
  }

  try {
    let pdfText = readCache(code);
    let prospectusInfo = null;

    if (!pdfText) {
      const searchResults = await withTimeout(
        searchProspectus(code),
        120000,
        'search prospectus timeout'
      );

      if (!searchResults || searchResults.length === 0) {
        return res.status(404).json({
          success: false,
          code,
          name: '',
          totalScore: 0,
          rating: '',
          elapsed: Math.round((Date.now() - startedAt) / 1000),
          dimensions: [],
          display: {},
          error: { type: 'prospectus_not_found', message: 'prospectus not found' },
          errorMessage: 'prospectus not found',
        });
      }

      for (let i = 0; i < searchResults.length; i++) {
        const candidate = searchResults[i];
        try {
          pdfText = await downloadAndParsePDF(candidate.link, code, candidate.name || '');
          prospectusInfo = candidate;
          break;
        } catch (_) {
          // continue
        }
      }
    }

    if (!pdfText) {
      return res.status(502).json({
        success: false,
        code,
        name: '',
        totalScore: 0,
        rating: '',
        elapsed: Math.round((Date.now() - startedAt) / 1000),
        dimensions: [],
        display: {},
        error: { type: 'pdf_candidates_failed', message: 'all prospectus candidates failed' },
        errorMessage: 'all prospectus candidates failed',
      });
    }

    const scoreResult = await scoreProspectus(pdfText, code);
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const normalizedRating = normalizeRating(scoreResult.rating, scoreResult.totalScore);

    if (prospectusInfo) {
      saveScoreToIPOList(code, scoreResult, prospectusInfo);
    }

    res.json({
      success: true,
      code,
      name: prospectusInfo?.name || '',
      totalScore: scoreResult.totalScore ?? 0,
      rating: normalizedRating.rating,
      ratingLabel: normalizedRating.ratingLabel,
      elapsed,
      dimensions: buildMiniProgramDimensions(scoreResult.scores || {}),
      display: scoreResult.display || {},
      error: null,
      errorMessage: null,
      // 兼容旧字段
      legacyRating: scoreResult.rating || '',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      code,
      name: '',
      totalScore: 0,
      rating: '',
      elapsed: Math.round((Date.now() - startedAt) / 1000),
      dimensions: [],
      display: {},
      error: {
        type: 'score_failed',
        message: error.message || 'unknown error',
      },
      errorMessage: error.message || 'unknown error',
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
