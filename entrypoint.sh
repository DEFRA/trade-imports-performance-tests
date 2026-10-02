#!/bin/sh

echo "run_id: $RUN_ID in $ENVIRONMENT"

PERFTEST_HOME=${PERFTEST_HOME:-/opt/perftest}
REPORTS_DIR=${PERFTEST_HOME}/reports

default_suite() {
  case "$ENVIRONMENT" in
    dev|test) echo "smoke" ;;
    *) echo "health-check" ;;
  esac
}

TEST_SUITE=${TEST_SUITE:-$(default_suite)}
SUITE_FILE=${PERFTEST_HOME}/src/suites/${TEST_SUITE}.k6.js

echo "Running suite $TEST_SUITE in $ENVIRONMENT"

mkdir -p "$REPORTS_DIR"

if [ -z "$RESULTS_OUTPUT_S3_PATH" ]; then
  echo "RESULTS_OUTPUT_S3_PATH is not set"
  exit 1
fi

if [ ! -f "$SUITE_FILE" ]; then
  echo "$SUITE_FILE is not found. Set TEST_SUITE to the name of a file in src/suites, without .k6.js"
  exit 1
fi

REPORTS_DIR="$REPORTS_DIR" sh "$PERFTEST_HOME/scripts/run-suite.sh" "$SUITE_FILE"
test_exit_code=$?

echo "The suite exited with code $test_exit_code"

if [ ! -f "$REPORTS_DIR/index.html" ]; then
  echo "$REPORTS_DIR/index.html is not found"
  exit 1
fi

if ! aws --endpoint-url="$S3_ENDPOINT" s3 cp "$REPORTS_DIR" "$RESULTS_OUTPUT_S3_PATH" --recursive; then
  echo "Failed to publish test results to $RESULTS_OUTPUT_S3_PATH"
  exit 1
fi

echo "Test results published to $RESULTS_OUTPUT_S3_PATH"

exit "$test_exit_code"
