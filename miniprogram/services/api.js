const { API_BASE } = require('../utils/constants');

function request(path, method = 'GET', data = {}, timeout = 10000, meta = {}) {
  const startedAt = Date.now();
  const url = `${API_BASE}${path}`;
  const triggerSource = meta.triggerSource || 'unknown';
  const code = meta.code || '';
  console.log('[score/front/mp][request][start]', {
    triggerSource,
    code,
    url,
    timeout,
  });
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      timeout,
      success: (res) => {
        console.log('[score/front/mp][request][end]', {
          triggerSource,
          code,
          url,
          timeout,
          duration: Date.now() - startedAt,
          statusCode: res.statusCode,
          requestId: (res.header && (res.header['X-Request-Id'] || res.header['x-request-id'])) || '',
        });
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        reject(new Error(`HTTP_${res.statusCode}`));
      },
      fail: (err) => {
        console.error('[score/front/mp][request][fail]', {
          triggerSource,
          code,
          url,
          timeout,
          duration: Date.now() - startedAt,
          errorMessage: err && err.errMsg,
        });
        reject(new Error(err.errMsg || 'NETWORK_ERROR'));
      },
    });
  });
}

module.exports = {
  request,
};
