const { request } = require('./api');

function fetchScore(code) {
  return request(`/api/mp/score/${encodeURIComponent(code)}`);
}

module.exports = {
  fetchScore,
};
