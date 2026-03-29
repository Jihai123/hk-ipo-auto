// 封版前最小环境切换：手动切换 ENV 即可
const ENV = 'dev'; // dev | test | prod

const API_BASE_MAP = {
  dev: 'http://localhost:3010',
  test: 'https://test.yourdomain.com',
  prod: 'https://www.yourdomain.com',
};

const API_BASE = API_BASE_MAP[ENV] || API_BASE_MAP.dev;

module.exports = {
  ENV,
  API_BASE_MAP,
  API_BASE,
};
