#!/usr/bin/env bash
# Runs SRS 3.4.1 and 3.4.2 three times each, then the stress ramp, saving k6's
# end-of-test summaries. Usage: TOKEN=... ORG_ID=... OUT=dir tools/load/run-all.sh
set -u
K6=${K6:-k6}; OUT=${OUT:-load-results}; mkdir -p "$OUT"
here=$(dirname "$0")
for i in 1 2 3; do
  "$K6" run -q -e TOKEN="$TOKEN" --summary-export "$OUT/nearby-run$i.json" "$here/nearby.js" > "$OUT/nearby-run$i.txt" 2>&1
  sleep 10
done
for i in 1 2 3; do
  "$K6" run -q -e TOKEN="$TOKEN" -e ORG_ID="$ORG_ID" --summary-export "$OUT/crud-run$i.json" "$here/crud.js" > "$OUT/crud-run$i.txt" 2>&1
  sleep 10
done
"$K6" run -q -e TOKEN="$TOKEN" --summary-export "$OUT/stress.json" "$here/stress.js" > "$OUT/stress.txt" 2>&1
echo done
