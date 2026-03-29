const { API_BASE } = require('../utils/constants');

function request(path, method = 'GET', data = {}, timeout = 10000) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE}${path}`,
      method,
      data,
      timeout,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        reject(new Error(`HTTP_${res.statusCode}`));
      },
      fail: (err) => {
        reject(new Error(err.errMsg || 'NETWORK_ERROR'));
      },
    });
  });
}

module.exports = {
  request,
};
