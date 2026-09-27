// SRS 3.4.1: geospatial query response time. 50 virtual users for 60 s against
// GET /v1/incidents/nearby (10 km around Colombo) over the 10,000-incident dataset.
// Pass: p95 <= 500 ms and error rate < 1%.
//   k6 run -e TOKEN=... [-e BASE=http://localhost:4100/v1] tools/load/nearby.js
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE || 'http://localhost:4100/v1';

export const options = {
  vus: 50,
  duration: '60s',
  thresholds: {
    http_req_duration: ['p(95)<=500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const res = http.get(`${BASE}/incidents/nearby?lat=6.9271&lng=79.8612&radius=10000`, {
    headers: { Authorization: `Bearer ${__ENV.TOKEN}` },
    tags: { name: 'GET /incidents/nearby' },
  });
  check(res, {
    'status 200': (r) => r.status === 200,
    'returns incidents': (r) => Array.isArray(r.json()) && r.json().length > 0,
  });
}
