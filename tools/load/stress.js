// Worst-case workload (beyond the SRS targets): ramp the nearby query from 10 to 150
// virtual users to find where latency degrades. Reported, not pass/fail.
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE || 'http://localhost:4100/v1';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '30s', target: 50 },
    { duration: '30s', target: 100 },
    { duration: '30s', target: 150 },
    { duration: '30s', target: 150 },
  ],
};

export default function () {
  const res = http.get(`${BASE}/incidents/nearby?lat=6.9271&lng=79.8612&radius=10000`, {
    headers: { Authorization: `Bearer ${__ENV.TOKEN}` },
  });
  check(res, { 'status 200': (r) => r.status === 200 });
}
