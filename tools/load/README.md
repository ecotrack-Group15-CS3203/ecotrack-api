# Load tests (k6)

SRS 3.4.1 (nearby query, 50 VUs) and 3.4.2 (general reads, 100 VUs), each run three
times, plus a 10 → 150 VU stress ramp. Dataset: 10,000 incidents over Sri Lanka in a
dedicated `load-test-tenant` organisation.

```bash
pnpm exec ts-node tools/load/seed-load.ts        # prints ORG_ID
TOKEN=<access token for load-test-admin> ORG_ID=<id> K6=k6 OUT=load-results \
  tools/load/run-all.sh
k6 run -e TOKEN=... -e ORG_ID=... tools/load/crud-by-endpoint.js   # per-endpoint p95
pnpm exec ts-node tools/load/cleanup-load.ts
```

Locally the token comes from a mock issuer the API trusts (`OIDC_JWKS_URI`); against
a deployed API use a real access token for an account with the org_admin role in the
load-test tenant. Tokens live at most one hour (SRS 3.4.6), enough for all runs.
