// Diagnostic companion to crud.js: the same load, with latency reported per endpoint.
// (Declaring a threshold on a tagged sub-metric is what makes k6 export it.)
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE || 'http://localhost:4100/v1';
const ORG = __ENV.ORG_ID;
const endpoints = [
  [`/organisations/${ORG}/incidents?limit=20`, 'org-incidents'],
  [`/organisations/${ORG}/tasks?limit=20`, 'org-tasks'],
  ['/organisations/public?limit=20', 'org-directory'],
];

export const options = {
  vus: 100,
  duration: '60s',
  thresholds: Object.fromEntries(
    endpoints.map(([, name]) => [`http_req_duration{name:${name}}`, ['p(95)<=300']]),
  ),
};

export default function () {
  const [path, name] = endpoints[__ITER % endpoints.length];
  const res = http.get(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${__ENV.TOKEN}` },
    tags: { name },
  });
  check(res, { 'status 200': (r) => r.status === 200 });
}
