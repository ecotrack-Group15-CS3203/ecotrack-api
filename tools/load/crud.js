// SRS 3.4.2: general API response time. 100 virtual users for 60 s, round-robin over
// the list endpoints. The SRS names /v1/incidents, /v1/tasks and /v1/organizations;
// the API's real equivalents are the org-scoped incident and task lists and the
// organisation directory. Pass: p95 <= 300 ms and error rate < 1%.
//   k6 run -e TOKEN=... -e ORG_ID=... tools/load/crud.js
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE || 'http://localhost:4100/v1';
const ORG = __ENV.ORG_ID;

export const options = {
  vus: 100,
  duration: '60s',
  thresholds: {
    http_req_duration: ['p(95)<=300'],
    http_req_failed: ['rate<0.01'],
  },
};

const endpoints = [
  [`/organisations/${ORG}/incidents?limit=20`, 'GET /organisations/:id/incidents'],
  [`/organisations/${ORG}/tasks?limit=20`, 'GET /organisations/:id/tasks'],
  ['/organisations/public?limit=20', 'GET /organisations/public'],
];

export default function () {
  const [path, name] = endpoints[__ITER % endpoints.length];
  const res = http.get(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${__ENV.TOKEN}` },
    tags: { name },
  });
  check(res, { 'status 200': (r) => r.status === 200 });
}
