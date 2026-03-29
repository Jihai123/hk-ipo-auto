const { request } = require('./api');

function fetchTimelineHome() {
  return request('/api/mp/home');
}

function fetchTimelineCurrent() {
  return request('/api/ipo/current');
}

module.exports = {
  fetchTimelineHome,
  fetchTimelineCurrent,
};
