import { PAGE_REQUEST_SERVICES } from '../config/call-ratios.js'
import { EXTERNAL_CALLS } from '../config/external-calls.js'
import { STUBBED_INTEGRATIONS } from '../config/stub-profiles.js'
import { TRAFFIC_DEFAULTS } from '../config/traffic.js'
import {
  callCountsFromCloudWatch,
  callCountsFromSummary,
  callRatioLinesFor
} from '../lib/call-ratios.js'
import {
  externalCallHtml,
  externalCallLines,
  externalCallReport,
  metricDataRequest,
  pageRequestCountsFromResults,
  stubProfilesFromSummary
} from '../lib/external-calls.js'
import {
  requiredSlaHtml,
  requiredSlaLines,
  requiredSlaStatement
} from '../lib/required-slas.js'

const step = __ENV.REPORT_STEP
const metricResults =
  step === 'report' ? JSON.parse(open(__ENV.METRIC_RESULTS)) : undefined
const summaryExport =
  step === 'report' && __ENV.SUMMARY_EXPORT
    ? JSON.parse(open(__ENV.SUMMARY_EXPORT))
    : undefined

export const options = { vus: 1, iterations: 1 }

export default function () {}

const requestOutput = () => ({
  [__ENV.METRIC_REQUEST]: JSON.stringify(
    metricDataRequest({
      externalCalls: EXTERNAL_CALLS,
      runStartedAt: __ENV.RUN_STARTED_AT,
      runEndedAt: __ENV.RUN_ENDED_AT,
      pageRequestServices: PAGE_REQUEST_SERVICES
    }),
    null,
    2
  ),
  stdout: 'External calls: CloudWatch request written\n'
})

const callCountsOf = (report) =>
  callCountsFromSummary(summaryExport) ??
  callCountsFromCloudWatch({
    pageRequestCounts: pageRequestCountsFromResults(
      metricResults,
      PAGE_REQUEST_SERVICES
    ),
    externalCallRows: report.rows
  })

const reportOutput = () => {
  const report = externalCallReport({
    environment: __ENV.ENVIRONMENT,
    runStartedAt: __ENV.RUN_STARTED_AT,
    runEndedAt: __ENV.RUN_ENDED_AT,
    externalCalls: EXTERNAL_CALLS,
    metricResults,
    stubProfiles: stubProfilesFromSummary(summaryExport, STUBBED_INTEGRATIONS)
  })
  const callCounts = callCountsOf(report)
  const statement = requiredSlaStatement({
    environment: __ENV.ENVIRONMENT,
    window: report.window,
    callCounts,
    summaryExport,
    externalReport: report,
    design: TRAFFIC_DEFAULTS
  })
  const callRatioLines =
    callCounts?.source === 'cloudwatch' ? callRatioLinesFor(callCounts) : []

  return {
    [`${__ENV.REPORTS_DIR}/external-calls.json`]: JSON.stringify(
      report,
      null,
      2
    ),
    [`${__ENV.REPORTS_DIR}/external-calls.html`]: externalCallHtml(report),
    [`${__ENV.REPORTS_DIR}/required-slas.json`]: JSON.stringify(
      statement,
      null,
      2
    ),
    [`${__ENV.REPORTS_DIR}/required-slas.html`]: requiredSlaHtml(statement),
    stdout: `${[
      ...externalCallLines(report),
      ...callRatioLines,
      ...requiredSlaLines(statement)
    ].join('\n')}\n`
  }
}

export function handleSummary() {
  if (step === 'request') {
    return requestOutput()
  }

  if (step === 'report') {
    return reportOutput()
  }

  throw new Error('REPORT_STEP must be request or report')
}
