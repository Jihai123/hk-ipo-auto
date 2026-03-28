const { request } = require('./api');

function fetchTimelineHome() {
  return request('/api/mp/home');
}

module.exports = {
  fetchTimelineHome,
};
