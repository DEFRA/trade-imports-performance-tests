#!/bin/sh
# Usage: external-call-report.sh <run-started-at> <run-ended-at>

script_dir=$(dirname "$0")
report_script="$script_dir/../src/external-calls/external-call-report.k6.js"
request_file="$REPORTS_DIR/external-call-metric-request.json"
results_file="$REPORTS_DIR/external-call-metric-results.json"
settle_seconds="${EXTERNAL_CALL_METRICS_SETTLE_SECONDS:-120}"

k6 run --quiet --no-usage-report \
  -e REPORT_STEP=request \
  -e RUN_STARTED_AT="$1" \
  -e RUN_ENDED_AT="$2" \
  -e METRIC_REQUEST="$request_file" \
  "$report_script" || exit 1

write_unavailable() {
  printf '%s\n' "{\"unavailableReason\":\"$1\"}" > "$results_file"
}

if [ "$ENVIRONMENT" = "local" ]; then
  write_unavailable "Local runs have no CloudWatch: the services' figures exist only in CDP"
elif ! command -v aws >/dev/null 2>&1; then
  write_unavailable "This runner has no AWS CLI, so it cannot read CloudWatch: read the figures in Grafana for the run window"
else
  echo "External calls: waiting ${settle_seconds}s for CloudWatch to ingest the services' metrics"
  sleep "$settle_seconds"
  if ! aws cloudwatch get-metric-data \
    --region "${AWS_REGION:-eu-west-2}" \
    --cli-input-json "file://$request_file" \
    --output json > "$results_file"; then
    write_unavailable "The CloudWatch query failed: see the run log"
  fi
fi

run_report_step() {
  if [ -f "$REPORTS_DIR/summary.json" ]; then
    k6 run --quiet --no-usage-report \
      -e REPORT_STEP=report \
      -e METRIC_RESULTS="$results_file" \
      -e REPORTS_DIR="$REPORTS_DIR" \
      -e ENVIRONMENT="$ENVIRONMENT" \
      -e RUN_STARTED_AT="$1" \
      -e RUN_ENDED_AT="$2" \
      -e SUMMARY_EXPORT="$REPORTS_DIR/summary.json" \
      "$report_script"
  else
    k6 run --quiet --no-usage-report \
      -e REPORT_STEP=report \
      -e METRIC_RESULTS="$results_file" \
      -e REPORTS_DIR="$REPORTS_DIR" \
      -e ENVIRONMENT="$ENVIRONMENT" \
      -e RUN_STARTED_AT="$1" \
      -e RUN_ENDED_AT="$2" \
      "$report_script"
  fi
}

run_report_step "$1" "$2"
