#!/bin/sh
# Usage: run-suite.sh <suite-file>

REPORTS_DIR=${REPORTS_DIR:-/opt/perftest/reports}
script_dir=$(dirname "$0")

mkdir -p "$REPORTS_DIR"
rm -f "$REPORTS_DIR/relative-thresholds-failed.txt"

sampling_flag_file="$REPORTS_DIR/.generator-sampling"
touch "$sampling_flag_file"
sh "$script_dir/sample-generator.sh" "$REPORTS_DIR/generator-samples.txt" "$sampling_flag_file" &
sampler_pid=$!

run_started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
env K6_WEB_DASHBOARD=true \
  K6_WEB_DASHBOARD_EXPORT="$REPORTS_DIR/index.html" \
  K6_WEB_DASHBOARD_PERIOD="${K6_WEB_DASHBOARD_PERIOD:-1s}" \
  REPORTS_DIR="$REPORTS_DIR" \
  k6 run --no-usage-report \
  --summary-export="$REPORTS_DIR/summary.json" \
  --out json="$REPORTS_DIR/timeseries.json.gz" \
  "$1"
k6_exit_code=$?
run_ended_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

rm -f "$sampling_flag_file"
wait "$sampler_pid"

run_generator_verdict() {
  if [ -f "$REPORTS_DIR/summary.json" ]; then
    k6 run --quiet --no-usage-report \
      -e GENERATOR_SAMPLES="$REPORTS_DIR/generator-samples.txt" \
      -e SUMMARY_EXPORT="$REPORTS_DIR/summary.json" \
      -e GENERATOR_REPORT="$REPORTS_DIR/generator.json" \
      "$script_dir/../src/generator/generator-verdict.k6.js"
  else
    k6 run --quiet --no-usage-report \
      -e GENERATOR_SAMPLES="$REPORTS_DIR/generator-samples.txt" \
      -e GENERATOR_REPORT="$REPORTS_DIR/generator.json" \
      "$script_dir/../src/generator/generator-verdict.k6.js"
  fi
}

if ! run_generator_verdict; then
  echo "Generator trust: not judged: the generator verdict run failed"
fi

if ! REPORTS_DIR="$REPORTS_DIR" sh "$script_dir/external-call-report.sh" "$run_started_at" "$run_ended_at"; then
  echo "External calls: not reported: the external call report failed"
fi

if [ "$k6_exit_code" -eq 0 ] && [ -f "$REPORTS_DIR/relative-thresholds-failed.txt" ]; then
  echo "Relative thresholds failed:"
  cat "$REPORTS_DIR/relative-thresholds-failed.txt"
  k6_exit_code=99
fi

exit "$k6_exit_code"
