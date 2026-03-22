const { normalizeIndustryName } = require('./industryCodeMap');

const LOCAL_INDUSTRY_PE_DICT = {
  半导体: 18,
  半導體: 18,
  半导体设备: 22,
  半導體設備: 22,
  软件服务: 14,
  軟件服務: 14,
  金融科技: 16,
  医疗器械: 20,
  醫療器械: 20,
  生物科技: 24,
  互联网服务: 15,
  互聯網服務: 15,
  消费: 12,
  消費: 12,
  新能源: 19,
  汽车: 11,
  汽車: 11,
};

const SECTOR_HARDCODED_PE = {
  科技: 16,
  医疗健康: 18,
  醫療健康: 18,
  金融服务: 10,
  金融服務: 10,
  消费: 12,
  消費: 12,
  工业: 9,
  工業: 9,
  能源: 8,
};

function buildNormalizedMap(dict) {
  const mapped = {};
  for (const [key, value] of Object.entries(dict)) {
    const normalized = normalizeIndustryName(key);
    if (normalized && Number.isFinite(value) && mapped[normalized] === undefined) {
      mapped[normalized] = value;
    }
  }
  return mapped;
}

const NORMALIZED_LOCAL_DICT = buildNormalizedMap(LOCAL_INDUSTRY_PE_DICT);
const NORMALIZED_SECTOR_DICT = buildNormalizedMap(SECTOR_HARDCODED_PE);

function resolveFallbackPeerPE(industry) {
  const normalized = normalizeIndustryName(industry);
  if (!normalized) {
    return { median: null, sourceLevel: 'none', fallbackUsed: false, reason: 'missing_industry' };
  }

  if (Number.isFinite(NORMALIZED_LOCAL_DICT[normalized])) {
    return {
      median: NORMALIZED_LOCAL_DICT[normalized],
      sourceLevel: 'local_industry_dict',
      fallbackUsed: true,
      reason: 'matched_local_industry_dict',
    };
  }

  for (const [key, value] of Object.entries(NORMALIZED_SECTOR_DICT)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return {
        median: value,
        sourceLevel: 'sector_hardcoded_pe',
        fallbackUsed: true,
        reason: 'matched_sector_hardcoded_pe',
      };
    }
  }

  return { median: null, sourceLevel: 'none', fallbackUsed: false, reason: 'no_fallback_match' };
}

module.exports = {
  LOCAL_INDUSTRY_PE_DICT,
  SECTOR_HARDCODED_PE,
  resolveFallbackPeerPE,
};
