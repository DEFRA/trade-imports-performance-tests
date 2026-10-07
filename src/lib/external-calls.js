import { PAGE_REQUEST_METRICS } from '../config/call-ratios.js'
import { EXTERNAL_CALL_STATISTICS } from '../config/external-calls.js'
import { PROFILES, QUANTILES } from '../config/stub-profiles.js'
import { subMetricKey } from '../config/thresholds.js'

const MILLISECONDS_PER_MINUTE = 60000
const MILLISECONDS_PER_SECOND = 1000
const PERCENT = 100
const PERCENT_DECIMALS = 2
const NOT_AVAILABLE = '-'
const NO_RESULTS_REASON = 'No CloudWatch results were written'

const parsedTime = (name, value) => {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN

  if (Number.isNaN(time)) {
    throw new Error(`${name} must be an ISO date-time`)
  }

  return time
}

const queryId = (index, key) => `c${index}_${key.toLowerCase()}`

const pageRequestQueryId = (index, key) => `p${index}_${key}`

const PAGE_REQUEST_STATISTICS = Object.freeze([
  {
    key: 'backend_sum',
    metric: PAGE_REQUEST_METRICS.backendCalls,
    stat: 'Sum'
  },
  {
    key: 'backend_count',
    metric: PAGE_REQUEST_METRICS.backendCalls,
    stat: 'SampleCount'
  },
  {
    key: 'session_sum',
    metric: PAGE_REQUEST_METRICS.sessionResolutions,
    stat: 'Sum'
  }
])

const pageRequestQueries = ({ service }, index, period) =>
  PAGE_REQUEST_STATISTICS.map(({ key, metric, stat }) => ({
    Id: pageRequestQueryId(index, key),
    ReturnData: true,
    MetricStat: {
      Metric: {
        Namespace: service,
        MetricName: metric,
        Dimensions: [PAGE_REQUEST_METRICS.dimension]
      },
      Period: period,
      Stat: stat
    }
  }))

/**
 * Builds the CloudWatch `GetMetricData` request for a run's external calls.
 *
 * The window is the run's start rounded down and its end rounded up to whole
 * minutes, and at least a minute long. `Period` is the whole window, so each
 * statistic comes back as one datapoint.
 *
 * @param {object} options - The request.
 * @param {Array<{ service: string, dependency: string, operation: string }>} options.externalCalls - The calls to read.
 * @param {string} options.runStartedAt - The run's start, as an ISO date-time.
 * @param {string} options.runEndedAt - The run's end, as an ISO date-time.
 * @param {Array<{ journey: string, service: string }>} [options.pageRequestServices] - The frontends whose per-page-request counts to read too.
 * @returns {{ StartTime: string, EndTime: string, ScanBy: string, MetricDataQueries: object[] }} The request, in the shape `aws cloudwatch get-metric-data --cli-input-json` reads.
 * @throws {Error} When a time is missing or unparseable, or the end is before the start.
 */
export const metricDataRequest = ({
  externalCalls,
  runStartedAt,
  runEndedAt,
  pageRequestServices = []
}) => {
  const startedAt = parsedTime('RUN_STARTED_AT', runStartedAt)
  const endedAt = parsedTime('RUN_ENDED_AT', runEndedAt)

  if (endedAt < startedAt) {
    throw new Error('RUN_ENDED_AT must not be before RUN_STARTED_AT')
  }

  const start =
    Math.floor(startedAt / MILLISECONDS_PER_MINUTE) * MILLISECONDS_PER_MINUTE
  const end = Math.max(
    Math.ceil(endedAt / MILLISECONDS_PER_MINUTE) * MILLISECONDS_PER_MINUTE,
    start + MILLISECONDS_PER_MINUTE
  )
  const period = (end - start) / MILLISECONDS_PER_SECOND

  return {
    StartTime: new Date(start).toISOString(),
    EndTime: new Date(end).toISOString(),
    ScanBy: 'TimestampAscending',
    MetricDataQueries: [
      ...externalCalls.flatMap(({ service, dependency, operation }, index) =>
        EXTERNAL_CALL_STATISTICS.map(({ key, metric, stat }) => ({
          Id: queryId(index, key),
          ReturnData: true,
          MetricStat: {
            Metric: {
              Namespace: service,
              MetricName: metric,
              Dimensions: [
                { Name: 'Dependency', Value: dependency },
                { Name: 'Operation', Value: operation }
              ]
            },
            Period: period,
            Stat: stat
          }
        }))
      ),
      ...pageRequestServices.flatMap((pageRequestService, index) =>
        pageRequestQueries(pageRequestService, index, period)
      )
    ]
  }
}

/**
 * Reads a figure out of a run's k6 summary export.
 *
 * @param {{ metrics?: Record<string, { value?: number, values?: { value?: number } }> } | undefined} summaryExport - The parsed `--summary-export` file.
 * @param {string} key - The metric or sub-metric key.
 * @returns {number | null} The gauge's value, or null when the run did not report it.
 */
export const summaryMetricValue = (summaryExport, key) => {
  const entry = summaryExport?.metrics?.[key]

  return entry?.value ?? entry?.values?.value ?? null
}

const latenciesFrom = (summaryExport, integration, source) =>
  Object.fromEntries(
    QUANTILES.map((quantile) => [
      `${quantile}Ms`,
      summaryMetricValue(
        summaryExport,
        subMetricKey('stub_latency', { integration, source, quantile })
      )
    ])
  )

const profileOf = (summaryExport, integration) =>
  PROFILES.find(
    (profile) =>
      summaryMetricValue(
        summaryExport,
        subMetricKey('stub_profile', { integration, profile })
      ) === 1
  )

/**
 * Reads the stub profile each integration ran with from a run's own k6 summary
 * export, so the report records what the run really had without a second call
 * to the stubs.
 *
 * @param {{ metrics?: Record<string, object> } | undefined} summaryExport - The parsed `--summary-export` file, or undefined when the run wrote none.
 * @param {Array<{ integration: string }>} integrations - The integrations to read.
 * @returns {Record<string, { profile: string, targets: { p50Ms: number | null, p95Ms: number | null, p99Ms: number | null }, answered: { p50Ms: number | null, p95Ms: number | null, p99Ms: number | null } | null }>} Each integration the suite reported, keyed by its id. An integration the suite did not report is left out.
 */
export const stubProfilesFromSummary = (summaryExport, integrations) =>
  Object.fromEntries(
    integrations.flatMap(({ integration }) => {
      const profile = profileOf(summaryExport, integration)

      if (profile === undefined) {
        return []
      }

      const answeredCount = summaryMetricValue(
        summaryExport,
        subMetricKey('stub_latency_answered_count', { integration })
      )

      return [
        [
          integration,
          {
            profile,
            targets: latenciesFrom(summaryExport, integration, 'target'),
            answered: answeredCount
              ? latenciesFrom(summaryExport, integration, 'answered')
              : null
          }
        ]
      ]
    })
  )

const resultValue = (metricResults, id) => {
  const result = metricResults.MetricDataResults.find(
    (candidate) => candidate.Id === id
  )

  return result?.Values?.[0] ?? null
}

const pageRequestCountsOf = (metricResults, index) => {
  const pageRequests = resultValue(
    metricResults,
    pageRequestQueryId(index, 'backend_count')
  )

  return pageRequests
    ? {
        pageRequests,
        backendCalls:
          resultValue(
            metricResults,
            pageRequestQueryId(index, 'backend_sum')
          ) ?? 0,
        sessionResolutions:
          resultValue(
            metricResults,
            pageRequestQueryId(index, 'session_sum')
          ) ?? 0
      }
    : null
}

/**
 * Reads each journey frontend's page requests, backend calls and session
 * resolutions over the run window from CloudWatch's answer.
 *
 * @param {{ MetricDataResults?: Array<{ Id: string, Values?: number[] }> } | undefined} metricResults - CloudWatch's answer, or undefined when it could not be read.
 * @param {Array<{ journey: string }>} pageRequestServices - The frontends the request asked about, in the order it asked.
 * @returns {Record<string, { pageRequests: number, backendCalls: number, sessionResolutions: number } | null>} Each journey's counts, or null when its frontend published none.
 */
export const pageRequestCountsFromResults = (
  metricResults,
  pageRequestServices
) =>
  Object.fromEntries(
    pageRequestServices.map(({ journey }, index) => [
      journey,
      Array.isArray(metricResults?.MetricDataResults)
        ? pageRequestCountsOf(metricResults, index)
        : null
    ])
  )

const rowOf = ({ externalCall, index, metricResults, stubProfiles }) => {
  const { service, dependency, operation, interfaceId } = externalCall
  const measured = Object.fromEntries(
    EXTERNAL_CALL_STATISTICS.map(({ key }) => [
      key,
      metricResults ? resultValue(metricResults, queryId(index, key)) : null
    ])
  )
  const unmeasured = !measured.calls

  return {
    service,
    dependency,
    operation,
    interfaceId,
    calls: measured.calls,
    p50Ms: unmeasured ? null : measured.p50Ms,
    p95Ms: unmeasured ? null : measured.p95Ms,
    p99Ms: unmeasured ? null : measured.p99Ms,
    errorRate: unmeasured ? null : measured.errorRate,
    stubProfile: stubProfiles?.[dependency] ?? null
  }
}

/**
 * Builds the external call report: each INS service's measured p50, p95, p99,
 * call count and error rate for each dependency and operation over the run
 * window, beside the stub profile that integration ran with.
 *
 * @param {object} options - The report.
 * @param {string} options.environment - The environment the run targeted.
 * @param {string} options.runStartedAt - The run's start.
 * @param {string} options.runEndedAt - The run's end.
 * @param {Array<{ service: string, dependency: string, operation: string, interfaceId: string | null }>} options.externalCalls - The calls the services measure.
 * @param {{ MetricDataResults?: Array<{ Id: string, Values?: number[] }>, unavailableReason?: string }} options.metricResults - CloudWatch's answer, or a reason it could not be read.
 * @param {ReturnType<typeof stubProfilesFromSummary>} options.stubProfiles - The stub profiles the run had.
 * @returns {{ environment: string, window: { startedAt: string, endedAt: string }, source: 'cloudwatch' | 'unavailable', unavailableReason: string | null, rows: object[] }} The report.
 */
export const externalCallReport = ({
  environment,
  runStartedAt,
  runEndedAt,
  externalCalls,
  metricResults,
  stubProfiles
}) => {
  const measured = Array.isArray(metricResults?.MetricDataResults)

  return {
    environment,
    window: { startedAt: runStartedAt, endedAt: runEndedAt },
    source: measured ? 'cloudwatch' : 'unavailable',
    unavailableReason: measured
      ? null
      : (metricResults?.unavailableReason ?? NO_RESULTS_REASON),
    rows: externalCalls.map((externalCall, index) =>
      rowOf({
        externalCall,
        index,
        metricResults: measured ? metricResults : null,
        stubProfiles
      })
    )
  }
}

const millisecondsText = (value) =>
  value === null ? NOT_AVAILABLE : `${Math.round(value)}ms`

const percentText = (rate) => `${(rate * PERCENT).toFixed(PERCENT_DECIMALS)}%`

const interfaceSuffix = (interfaceId) =>
  interfaceId === null || interfaceId === undefined ? '' : ` (${interfaceId})`

const latencyText = ({ p50Ms, p95Ms, p99Ms }) =>
  `p50 ${millisecondsText(p50Ms)}, p95 ${millisecondsText(p95Ms)}, p99 ${millisecondsText(p99Ms)}`

const errorRateText = (errorRate) =>
  errorRate === null
    ? 'error rate not measured'
    : `${percentText(errorRate)} failed`

const stubText = (stubProfile) => {
  if (stubProfile === null) {
    return 'stub profile not reported by this suite'
  }

  return `stub profile ${stubProfile.profile} targets ${latencyText(stubProfile.targets)}`
}

const rowLine = (row) =>
  `External call: ${row.service} ${row.dependency} ${row.operation}${interfaceSuffix(row.interfaceId)} ${latencyText(row)} over ${row.calls} calls, ${errorRateText(row.errorRate)}, beside ${stubText(row.stubProfile)}`

/**
 * Words the external call report as lines for the run log.
 *
 * @param {ReturnType<typeof externalCallReport>} report - The report.
 * @returns {string[]} One line for each call that was measured, or one line saying none was or why the figures were not read.
 */
export const externalCallLines = (report) => {
  if (report.source === 'unavailable') {
    return [`External calls: not measured: ${report.unavailableReason}`]
  }

  const measured = report.rows.filter((row) => row.calls)

  return measured.length === 0
    ? ['External calls: none measured over the run window']
    : measured.map(rowLine)
}

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character])

const HEADER_CELL_STYLE =
  'border:1px solid #888;padding:4px 8px;text-align:left'
const BODY_CELL_STYLE = 'border:1px solid #888;padding:4px 8px'

const headerCell = (column) =>
  `<th style="${HEADER_CELL_STYLE}">${escapeHtml(column)}</th>`

const bodyCell = (cell) =>
  `<td style="${BODY_CELL_STYLE}">${escapeHtml(cell)}</td>`

const headerRow = (columns) => `<tr>${columns.map(headerCell).join('')}</tr>`

const tableRow = (cells) => `<tr>${cells.map(bodyCell).join('')}</tr>`

const table = (heading, columns, rows) =>
  `<h2>${escapeHtml(heading)}</h2>\n<table style="border-collapse:collapse">\n${headerRow(columns)}\n${rows.map(tableRow).join('\n')}\n</table>`

const COLUMNS = [
  'Service',
  'Dependency',
  'Operation',
  'Interface',
  'Calls',
  'p50 ms',
  'p95 ms',
  'p99 ms',
  'Error rate',
  'Stub profile',
  'Stub target p50/p95/p99 ms',
  'Stub answered p50/p95/p99 ms'
]

const cellText = (value, format = String) =>
  value === null || value === undefined ? NOT_AVAILABLE : format(value)

const wholeMilliseconds = (value) => String(Math.round(value))

const latencyTriple = (latencies) =>
  latencies === null || latencies === undefined
    ? NOT_AVAILABLE
    : [latencies.p50Ms, latencies.p95Ms, latencies.p99Ms]
        .map((value) => cellText(value, wholeMilliseconds))
        .join(' / ')

const htmlRow = (row) => [
  row.service,
  row.dependency,
  row.operation,
  cellText(row.interfaceId),
  cellText(row.calls),
  cellText(row.p50Ms, wholeMilliseconds),
  cellText(row.p95Ms, wholeMilliseconds),
  cellText(row.p99Ms, wholeMilliseconds),
  cellText(row.errorRate, percentText),
  cellText(row.stubProfile?.profile),
  latencyTriple(row.stubProfile?.targets),
  latencyTriple(row.stubProfile?.answered)
]

const runLine = (report) =>
  report.source === 'unavailable'
    ? `Environment ${report.environment}, window ${report.window.startedAt} to ${report.window.endedAt}. Not measured: ${report.unavailableReason}`
    : `Environment ${report.environment}, window ${report.window.startedAt} to ${report.window.endedAt}. Source: CloudWatch.`

/**
 * Writes the external call report as a complete HTML page.
 *
 * @param {ReturnType<typeof externalCallReport>} report - The report.
 * @returns {string} The page. Every value is escaped, and styles are inline.
 */
export const externalCallHtml = (report) =>
  [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>External calls</title>',
    '</head>',
    '<body style="font-family:sans-serif;margin:16px">',
    '<h1>External calls</h1>',
    `<p>${escapeHtml(runLine(report))}</p>`,
    table(
      'Each call, as measured by the service that makes it',
      COLUMNS,
      report.rows.map(htmlRow)
    ),
    '</body>',
    '</html>',
    ''
  ].join('\n')
