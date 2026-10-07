import { EXTERNAL_CALLS } from '../config/external-calls.js'
import { STUBBED_INTEGRATIONS } from '../config/stub-profiles.js'
import {
  externalCallHtml,
  externalCallLines,
  externalCallReport,
  metricDataRequest,
  stubProfilesFromSummary
} from '../lib/external-calls.js'

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
      runEndedAt: __ENV.RUN_ENDED_AT
    }),
    null,
    2
  ),
  stdout: 'External calls: CloudWatch request written\n'
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

  return {
    [`${__ENV.REPORTS_DIR}/external-calls.json`]: JSON.stringify(
      report,
      null,
      2
    ),
    [`${__ENV.REPORTS_DIR}/external-calls.html`]: externalCallHtml(report),
    stdout: `${externalCallLines(report).join('\n')}\n`
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
