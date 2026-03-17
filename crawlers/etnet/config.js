/**
 * etnet 经济通爬虫配置
 * 数据源: https://www.etnet.com.hk/www/sc/stocks
 */
module.exports = {
  baseURL: 'https://www.etnet.com.hk/www/sc/stocks',
  urls: {
    ipoDetail:      (code) => `/ci_ipo_detail.php?code=${code}`,
    ipoList:        '/ci_ipo.php',
    ipoInfo:        (page) => `/ci_ipo_info.php?page=${page}`,
    industryMain:   '/industry.php',
    industryDetail: (code) => `/industry_detail.php?nature=${code}&subtype=all`,
  },
  headers: {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Accept':          'text/html,application/xhtml+xml',
    'Referer':         'https://www.etnet.com.hk/',
  },
  requestDelay: 2500,   // 请求间隔 ms（礼貌性延迟，避免被封）
  timeout:      15000,  // 单次请求超时 ms
  maxRetries:   3,      // 失败最大重试次数
};
