import {
  DRAIN_WATCH_SECONDS,
  EXTERNAL_EVENT_TYPES,
  SCHEMA_VERSIONS
} from '../config/eventing.js'
import { subMetricKey } from '../config/thresholds.js'
import { durationText } from '../config/traffic.js'
import { thresholdLines } from './summary-text.js'

const LIVE_ANIMALS = 'live-animals'
const HIGH_RISK_PLANTS = 'high-risk-plants'
const LABELS = Object.freeze({
  [LIVE_ANIMALS]: 'Live animals',
  [HIGH_RISK_PLANTS]: 'High-risk plants'
})
const FIRST_VERSION = SCHEMA_VERSIONS[0]
const LOCAL = 'local'
const ONE_INSTANCE_CAVEAT =
  'the forwarded count is read from one gateway instance, so a second instance would hold the rest'

const isCount = (value) => Number.isInteger(value) && value >= 0

/**
 * Reads the forwarded count out of the gateway's actuator answer for one
 * `notification.sqs.messages` counter.
 *
 * @param {{ measurements?: Array<{ statistic: string, value: number }> } | null | undefined} body - The parsed JSON.
 * @returns {number | null} The counter's value, or null when the answer has no count.
 */
export const forwardedCountFrom = (body) => {
  const count = body?.measurements?.find(
    ({ statistic }) => statistic === 'COUNT'
  )?.value

  return Number.isFinite(count) ? count : null
}

/**
 * Works out how many messages the gateway's source queue holds.
 *
 * @param {{ approximate_count?: number, approximate_in_flight_count?: number } | null | undefined} body - The parsed JSON of `GET /queue/notifications`.
 * @returns {number | null} Visible plus in-flight messages; null when either count is not a whole number.
 */
export const backlogDepthFrom = (body) =>
  isCount(body?.approximate_count) && isCount(body?.approximate_in_flight_count)
    ? body.approximate_count + body.approximate_in_flight_count
    : null

/**
 * Counts the events of a notification that the gateway forwards to Service Bus.
 *
 * @param {Array<{ eventType: string }> | null | undefined} events - The notification's outbox events.
 * @returns {number} How many are submitted or amended events; 0 for anything but a list.
 */
export const externalEventCount = (events) =>
  Array.isArray(events)
    ? events.filter(({ eventType }) => EXTERNAL_EVENT_TYPES.includes(eventType))
        .length
    : 0

/**
 * Finds the highest aggregate version among a notification's outbox events.
 *
 * @param {Array<{ aggregateVersion: number }> | null | undefined} events - The notification's outbox events.
 * @returns {number | null} The version; null when there are no events.
 */
export const latestVersion = (events) => {
  const versions = Array.isArray(events)
    ? events
        .map(({ aggregateVersion }) => aggregateVersion)
        .filter(Number.isInteger)
    : []

  return versions.length === 0 ? null : Math.max(...versions)
}

/**
 * Tells whether the read model holds a notification at a version or later.
 *
 * @param {{ content?: Array<{ aggregateVersion?: number }> } | null | undefined} readModelBody - The parsed JSON of the read model's list, filtered by reference number.
 * @param {number | null} version - The version the outbox reached.
 * @returns {boolean} True when the stored version is at least `version`.
 */
export const hasArrived = (readModelBody, version) => {
  const stored = readModelBody?.content?.[0]?.aggregateVersion

  return version !== null && Number.isInteger(stored) && stored >= version
}

/**
 * Works out how many messages the gateway forwarded between two readings.
 *
 * @param {object} options - The two readings.
 * @param {number | null} options.before - The count at the start, or null when it could not be read.
 * @param {number | null} options.after - The count at the end, or null when it could not be read.
 * @returns {number | null} The difference; null when a reading is missing or the count went down, which means the readings came from different gateway instances.
 */
export const forwardedDelta = ({ before, after }) =>
  before === null || after === null || after < before ? null : after - before

/**
 * Tells whether the eventing path has gone quiet: the backlog is back at or
 * below where the run started, and the forwarded count has stopped rising.
 *
 * @param {object} options - Two consecutive readings.
 * @param {number | null} options.startDepth - The backlog when the run started.
 * @param {number | null} options.depth - The backlog now.
 * @param {number | null} options.previousForwarded - The forwarded count one reading ago.
 * @param {number | null} options.forwarded - The forwarded count now.
 * @returns {boolean} True when settled.
 */
export const isSettled = ({
  startDepth,
  depth,
  previousForwarded,
  forwarded
}) =>
  depth !== null &&
  depth <= (startDepth ?? 0) &&
  forwarded !== null &&
  forwarded === previousForwarded

export const INITIAL_BACKLOG_STATE = Object.freeze({
  preBurstDepth: null,
  peakDepth: null,
  peakPerSecond: null,
  drainSeconds: null,
  windowOpened: false
})

const raised = (current, value) =>
  value !== null && (current === null || value > current)

const withPeaks = (state, { depth, forwardedDelta: perSecond }) => ({
  ...state,
  ...(raised(state.peakDepth, depth) ? { peakDepth: depth } : {}),
  ...(raised(state.peakPerSecond, perSecond)
    ? { peakPerSecond: perSecond }
    : {})
})

const hasDrained = (state, { seconds, depth }, window) =>
  seconds >= window.endSeconds &&
  state.preBurstDepth !== null &&
  depth !== null &&
  depth <= state.preBurstDepth

const changedGauge = (before, after, key) =>
  after[key] !== before[key] ? { [key]: after[key] } : {}

const gaugesBetween = (before, after) => ({
  ...(!before.windowOpened && after.preBurstDepth !== null
    ? { preBurstDepth: after.preBurstDepth }
    : {}),
  ...changedGauge(before, after, 'peakDepth'),
  ...changedGauge(before, after, 'peakPerSecond'),
  ...changedGauge(before, after, 'drainSeconds')
})

const beforeWindow = (state, { depth }) =>
  depth === null ? state : { ...state, preBurstDepth: depth }

/**
 * Folds one second's reading into the burst or spike watch.
 *
 * Before the window opens, the latest depth is the pre-burst depth. From the
 * window's start until the backlog drains, it keeps the peak depth and the peak
 * forwarded rate. From the window's end, the first reading at or below the
 * pre-burst depth gives the drain time. After that nothing changes.
 *
 * @param {object} state - The state so far; start from `INITIAL_BACKLOG_STATE`.
 * @param {object} sample - This second's reading.
 * @param {number} sample.seconds - Seconds since the scenarios started.
 * @param {number | null} sample.depth - The backlog, or null when it could not be read.
 * @param {number | null} sample.forwardedDelta - Messages forwarded since the last reading, or null.
 * @param {{ startSeconds: number, endSeconds: number }} window - The burst or spike window.
 * @returns {{ state: object, gauges: object }} The new state, and the figures that changed this second, which the run records as gauges: `preBurstDepth` when the window opens, `peakDepth` and `peakPerSecond` when they rise, `drainSeconds` once.
 */
export const trackBacklog = (state, sample, window) => {
  if (sample.seconds < window.startSeconds) {
    return { state: beforeWindow(state, sample), gauges: {} }
  }

  if (state.drainSeconds !== null) {
    return { state, gauges: {} }
  }

  const peaked = withPeaks({ ...state, windowOpened: true }, sample)
  const next = hasDrained(peaked, sample, window)
    ? { ...peaked, drainSeconds: sample.seconds - window.endSeconds }
    : peaked

  return { state: next, gauges: gaugesBetween(state, next) }
}

const valueOfMetric = (metrics, key, stat) => metrics[key]?.values?.[stat]

/**
 * Reads the burst or spike watch's figures out of k6's summary.
 *
 * @param {Record<string, object>} metrics - k6's summary metrics.
 * @param {string} phase - `burst` or `spike`.
 * @returns {{ preBurstDepth: number, peakDepth: number, peakPerSecond: number, drainSeconds: number | null, submittedInWindow: number }} The figures. `drainSeconds` is null when the backlog never drained during the watch.
 */
export const eventingWatchSummary = (metrics, phase) => {
  const drained =
    (valueOfMetric(metrics, 'eventing_backlog_drained', 'rate') ?? 0) > 0

  return {
    preBurstDepth:
      valueOfMetric(metrics, 'eventing_backlog_pre_burst_depth', 'value') ?? 0,
    peakDepth:
      valueOfMetric(metrics, 'eventing_backlog_peak_depth', 'value') ?? 0,
    peakPerSecond:
      valueOfMetric(metrics, 'service_bus_peak_per_second', 'value') ?? 0,
    drainSeconds: drained
      ? (valueOfMetric(metrics, 'eventing_backlog_drain_seconds', 'value') ?? 0)
      : null,
    submittedInWindow:
      valueOfMetric(
        metrics,
        subMetricKey('notifications_submitted', { phase }),
        'count'
      ) ?? 0
  }
}

const countOf = (metrics, key) => valueOfMetric(metrics, key, 'count') ?? 0

const submittedCount = (metrics, scenario, submission) =>
  countOf(
    metrics,
    subMetricKey('notifications_submitted', { scenario, submission })
  )

const forwardedFor = (metrics) =>
  Object.fromEntries(
    SCHEMA_VERSIONS.map((version) => {
      const key = subMetricKey('service_bus_forwarded', {
        schema_version: version
      })

      return [
        version,
        metrics[key] === undefined
          ? null
          : (valueOfMetric(metrics, key, 'value') ?? null)
      ]
    })
  )

const arrivalsFor = (metrics) => {
  const key = subMetricKey('event_arrivals', { scenario: LIVE_ANIMALS })
  const arrived = valueOfMetric(metrics, key, 'passes') ?? 0

  return {
    arrived,
    checked: arrived + (valueOfMetric(metrics, key, 'fails') ?? 0)
  }
}

const rowFor = (metrics, scenario) => ({
  scenario,
  label: LABELS[scenario],
  publishes: scenario === LIVE_ANIMALS,
  submitted: submittedCount(metrics, scenario, 'first'),
  amendments: submittedCount(metrics, scenario, 'amendment')
})

/**
 * Collects what a run counted on the eventing path, one row per journey.
 *
 * Both journeys have a row. Only live animals publishes events, so only its row
 * carries events published, arrivals and the Service Bus count.
 *
 * @param {Record<string, object>} metrics - k6's summary metrics.
 * @returns {Array<object>} The rows, live animals first.
 */
export const eventCountRows = (metrics) => [
  {
    ...rowFor(metrics, LIVE_ANIMALS),
    published: countOf(
      metrics,
      subMetricKey('external_events_published', { scenario: LIVE_ANIMALS })
    ),
    ...arrivalsFor(metrics),
    forwarded: forwardedFor(metrics)
  },
  rowFor(metrics, HIGH_RISK_PLANTS)
]

const shortfallText = (missing) =>
  missing > 0 ? `: SHORT, ${missing} missing` : ''

const forwardedMismatchText = ({ count, published }) =>
  count > published
    ? `: MISMATCH, ${count - published} more than published`
    : shortfallText(published - count)

const totalForwardedMessages = (forwarded) =>
  SCHEMA_VERSIONS.some((version) => forwarded[version] === null)
    ? null
    : SCHEMA_VERSIONS.reduce((total, version) => total + forwarded[version], 0)

const messagesClauseText = (forwarded) => {
  const total = totalForwardedMessages(forwarded)

  if (total !== null) {
    return `so ${total} messages`
  }

  const unmeasured = SCHEMA_VERSIONS.filter(
    (version) => forwarded[version] === null
  )

  return `but v${unmeasured.join(' and v')} not measured`
}

const serviceBusText = ({ published, forwarded }) => {
  const count = forwarded[FIRST_VERSION]

  if (count === null) {
    return "Service Bus stand-in: not measured, the gateway's forwarded count could not be read"
  }

  return `Service Bus stand-in: ${count} of ${published} events forwarded${forwardedMismatchText({ count, published })}, each sent as v${SCHEMA_VERSIONS.join(' and v')}, ${messagesClauseText(forwarded)}`
}

const publishingLine = (row, environment) => {
  const { label, submitted, amendments, published, arrived, checked } = row
  const caveat = environment === LOCAL ? '' : `; note: ${ONE_INSTANCE_CAVEAT}`

  return `${label}: ${submitted} submitted and ${amendments} amendments resubmitted; ${published} events published; dashboard read model: ${arrived} of ${checked} notifications arrived${shortfallText(checked - arrived)}; ${serviceBusText(row)}${caveat}`
}

const silentLine = ({ label, submitted, amendments }) =>
  `${label}: ${submitted} submitted and ${amendments} amendments resubmitted; publishes no events today (pbe-022), so nothing is expected at the dashboard read model or the Service Bus stand-in and nothing is counted`

/**
 * States, for each journey, what was submitted and what reached the dashboard
 * read model and the Service Bus stand-in.
 *
 * A journey that publishes no events is said to publish none, never counted as
 * zero of zero. Outside `local` the Service Bus count carries a note that it
 * comes from one gateway instance.
 *
 * @param {object} options - The counts.
 * @param {ReturnType<typeof eventCountRows>} options.rows - One row per journey.
 * @param {string} options.environment - The environment the run was in.
 * @returns {string[]} One line per journey.
 */
export const eventCountLines = ({ rows, environment }) =>
  rows.map((row) =>
    row.publishes ? publishingLine(row, environment) : silentLine(row)
  )

const secondsText = (seconds) =>
  `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`

/**
 * States how smooth the outbound rate to the Service Bus stand-in stayed.
 *
 * @param {object} options - The window.
 * @param {string} options.phase - `burst` or `spike`.
 * @param {number} options.windowSeconds - The window's length.
 * @param {ReturnType<typeof eventingWatchSummary>} options.eventing - The watch's figures.
 * @returns {string} The line.
 */
export const smoothingLine = ({ phase, windowSeconds, eventing }) =>
  `Smoothing over the ${phase} (${durationText(windowSeconds)}): ${eventing.submittedInWindow} notifications submitted; the Service Bus stand-in received at most ${eventing.peakPerSecond} events in any one second, and the SQS backlog peaked at ${eventing.peakDepth} messages`

/**
 * States how long the SQS backlog took to drain after the burst or spike.
 *
 * @param {object} options - The window.
 * @param {string} options.phase - `burst` or `spike`.
 * @param {number} options.watchSeconds - How long the run watched after the window ended.
 * @param {ReturnType<typeof eventingWatchSummary>} options.eventing - The watch's figures.
 * @returns {string} The line.
 */
export const drainLine = ({ phase, watchSeconds, eventing }) =>
  eventing.drainSeconds === null
    ? `SQS backlog after the ${phase}: did not drain within ${watchSeconds}s (pre-${phase} depth ${eventing.preBurstDepth}, peak ${eventing.peakDepth})`
    : `SQS backlog after the ${phase}: drained to its pre-${phase} depth of ${eventing.preBurstDepth} in ${secondsText(eventing.drainSeconds)}`

/**
 * The log line that says what the burst or spike watch reads.
 *
 * @param {object} options - The watch.
 * @param {string} options.phase - `burst` or `spike`.
 * @param {{ startSeconds: number, endSeconds: number }} options.window - The window on the run's clock.
 * @returns {string} The line.
 */
export const eventingWatchLine = ({ phase, window }) =>
  `Eventing watch: every second the run reads the gateway's forwarded count and the SQS backlog; the ${phase} runs from ${window.startSeconds}s to ${window.endSeconds}s, and the watch goes on for ${DRAIN_WATCH_SECONDS}s after the traffic phases end`

/**
 * The log line that says a settle wait finished, or did not.
 *
 * @param {object} options - The wait.
 * @param {number | null} options.settledSeconds - Seconds it took, or null when it timed out.
 * @param {number} options.timeoutSeconds - The longest it waits.
 * @returns {string} The line.
 */
export const settleLine = ({ settledSeconds, timeoutSeconds }) =>
  settledSeconds === null
    ? `Eventing: not settled within ${timeoutSeconds}s`
    : `Eventing: settled in ${settledSeconds}s`

/**
 * The log line that states the readings either side of a run.
 *
 * @param {object} options - The readings.
 * @param {{ forwarded: Record<string, number | null>, depth: number | null }} options.start - The readings in set-up.
 * @param {{ forwarded: Record<string, number | null>, depth: number | null }} options.end - The readings after settling.
 * @returns {string} The line.
 */
export const readingsLine = ({ start, end }) => {
  const forwardedText = ({ forwarded }) =>
    SCHEMA_VERSIONS.map((version) => `v${version} ${forwarded[version]}`).join(
      ', '
    )

  return `Eventing readings: forwarded ${forwardedText(start)}, backlog ${start.depth} at the start; forwarded ${forwardedText(end)}, backlog ${end.depth} at the end`
}

/**
 * The note that says the Service Bus count was not measured because the
 * readings came from different gateway instances.
 *
 * @returns {string} The line.
 */
export const differentInstancesLine = () =>
  'Service Bus stand-in: not measured: the readings came from different gateway instances'

/**
 * Builds the JSON-ready report of a peak-day run: its settings, what each
 * journey submitted and what reached the dashboard read model and the Service
 * Bus stand-in, and the iterations k6 dropped.
 *
 * @param {object} options - The run.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {{ line: string, environment: string, stubProfile: string, scenarioLength: string }} options.run - The run's settings.
 * @param {string[]} options.scenarios - The scenario names the run started.
 * @returns {{ run: object, journeys: ReturnType<typeof eventCountRows>, droppedIterations: Record<string, number> }} The report.
 */
export const peakDayReport = ({ metrics, run, scenarios }) => ({
  run,
  journeys: eventCountRows(metrics),
  droppedIterations: Object.fromEntries(
    scenarios.map((scenario) => [
      scenario,
      countOf(metrics, subMetricKey('dropped_iterations', { scenario }))
    ])
  )
})

/**
 * Writes a peak-day run's end-of-test text: the run line, a line for each
 * journey's counts, and every threshold as `passed` or `FAILED`.
 *
 * @param {object} options - The run.
 * @param {ReturnType<typeof peakDayReport>} options.report - The run's report.
 * @param {Record<string, object>} options.metrics - k6's summary metrics, for the threshold lines.
 * @returns {string} Lines joined with newlines, ending in one.
 */
export const peakDayText = ({ report, metrics }) =>
  `${[
    report.run.line,
    ...eventCountLines({
      rows: report.journeys,
      environment: report.run.environment
    }),
    ...thresholdLines(metrics)
  ].join('\n')}\n`
