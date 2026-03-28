const { request } = require('./api');

function fetchHome() {
  return request('/api/mp/home');
}

module.exports = {
  fetchHome,
};
