import { CALL_COUNT_JOURNEYS } from '../config/call-ratios.js'
import { SCHEMA_VERSIONS, publishesEvents } from '../config/eventing.js'
import {
  ADDRESS_LOOKUP_DERIVED,
  PUBLISHED_SLAS,
  PUBLISHED_SLA_SOURCE,
  REQUIRED_SLA_DEPENDENCIES
} from '../config/required-slas.js'
import { JOURNEYS } from '../config/smoke.js'
import {
  DEFRA_ID_PROFILED_CALLS_PER_SIGN_IN,
  FRONT_DOOR_SPIKE_PER_SECOND,
  SIGN_IN_TARGET
} from '../config/stub-ceilings.js'
import { STUBBED_INTEGRATIONS } from '../config/stub-profiles.js'
import { subMetricKey } from '../config/thresholds.js'
import { SECONDS_PER_HOUR } from '../config/traffic.js'
import { escapeHtml, table } from './design-target-summary.js'
import {
  stubProfilesFromSummary,
  summaryMetricValue
} from './external-calls.js'

const NOT_MEASURED = 'not measured'
const NOT_AVAILABLE = '-'
const RATE_DECIMALS = 2
const LARGE_RATE = 10
const LARGE_RATE_DECIMALS = 1
const NO_CALL_COUNTS_REASON = 'no call counts were read in this run'
const NO_CALLS_REASON = 'no calls over the window'
const MET_BASIS = 'per-dependency metrics'
const NO_PUBLISHED_SLA_REASON = 'no published service level (§9.5: TBC)'
const RATE_NOT_MEASURED_REASON =
  'required rate not measured, cannot compare published throughput'
const NO_PUBLISHED_THROUGHPUT_REASON =
  'published service level states no throughput'
const NO_CALLER_TEXT = 'no INS service calls it yet'
const NO_CALLER_REASON = `${NO_CALLER_TEXT}: its SLA is raised now so it is in place before one does`
const NO_EVENTS_NOTE = 'publishes no events today (pbe-022)'
const NOT_MEASURED_BY_SUITE = 'not measured by this suite'

const HALF = 2

const fixed = (value, decimals) => {
  const smallestShown = 10 ** -decimals

  return value > 0 && value < smallestShown / HALF
    ? `<${smallestShown}`
    : value.toFixed(decimals)
}

const counterValue = (summaryExport, key) =>
  summaryExport?.metrics?.[key]?.count ?? null

const rateText = (value) =>
  value >= LARGE_RATE
    ? fixed(value, LARGE_RATE_DECIMALS)
    : fixed(value, RATE_DECIMALS)

const trafficOf = (design, journeyKey) =>
  design[JOURNEYS[journeyKey].trafficKey]

/**
 * The notifications a second the design target asks of a journey.
 *
 * @param {object} design - The traffic model, `TRAFFIC_DEFAULTS`.
 * @param {string} journeyKey - A key of `JOURNEYS`.
 * @returns {number} Notifications a second.
 */
export const designNotificationsPerSecond = (design, journeyKey) =>
  trafficOf(design, journeyKey).notificationsPerHour / SECONDS_PER_HOUR

/**
 * The page requests a second the design target asks of a journey's frontend.
 *
 * @param {object} design - The traffic model, `TRAFFIC_DEFAULTS`.
 * @param {string} journeyKey - A key of `JOURNEYS`.
 * @returns {number} Page requests a second.
 */
export const designPagesPerSecond = (design, journeyKey) =>
  designNotificationsPerSecond(design, journeyKey) *
  trafficOf(design, journeyKey).pagesPerNotification

const spikeRpsOf = (design, journeyKey) =>
  design.spikeRecovery.capacityRps[JOURNEYS[journeyKey].endpointPrefix]

const journeyKeys = Object.keys(CALL_COUNT_JOURNEYS)

const sumOrNull = (values) =>
  values.some((value) => value === null)
    ? null
    : values.reduce((sum, value) => sum + value, 0)

const journeyEntry = ({ design, journey, callsPerPage, note, operations }) => ({
  journey,
  callsPerPage,
  callsPerNotification:
    callsPerPage === null
      ? null
      : callsPerPage * trafficOf(design, journey).pagesPerNotification,
  ...(operations === undefined ? {} : { operations }),
  note
})

const unmeasuredEntry = ({ design, journey, reason }) =>
  journeyEntry({
    design,
    journey,
    callsPerPage: null,
    note: `${NOT_MEASURED}: ${reason}`,
    operations: []
  })

const pageRequestsOf = (callCounts, journey) =>
  callCounts?.journeys?.[journey]?.pageRequests ?? 0

const measuredEntry = ({ dependency, design, callCounts, journey }) => {
  const counts = callCounts?.journeys?.[journey]

  if (!counts?.pageRequests) {
    return unmeasuredEntry({
      design,
      journey,
      reason: callCounts
        ? `${journey} carried no page requests`
        : NO_CALL_COUNTS_REASON
    })
  }

  const operationCalls = counts.externalCalls?.[dependency.dependency] ?? {}
  const operations = Object.entries(operationCalls).map(
    ([operation, calls]) => ({
      operation,
      callsPerPage: calls / counts.pageRequests
    })
  )

  return journeyEntry({
    design,
    journey,
    callsPerPage: sumOrNull(operations.map(({ callsPerPage }) => callsPerPage)),
    note: `measured from ${callCounts.source}: ${counts.pageRequests} page requests`,
    operations
  })
}

const sharedCallsPerPage = ({ dependency, summaryExport, callCounts }) => {
  const answered = summaryMetricValue(
    summaryExport,
    subMetricKey('stub_latency_answered_count', {
      integration: dependency.dependency
    })
  )
  const pageRequests = journeyKeys
    .map((journey) => pageRequestsOf(callCounts, journey))
    .reduce((sum, count) => sum + count, 0)

  return answered === null || pageRequests === 0
    ? null
    : answered / pageRequests
}

const sharedEntries = ({ dependency, design, summaryExport, callCounts }) => {
  const callsPerPage = sharedCallsPerPage({
    dependency,
    summaryExport,
    callCounts
  })

  return journeyKeys.map((journey) =>
    callsPerPage === null
      ? unmeasuredEntry({
          design,
          journey,
          reason: 'the run recorded no answered count or no page requests'
        })
      : journeyEntry({
          design,
          journey,
          callsPerPage,
          note: dependency.note
        })
  )
}

const forwardedMessages = (summaryExport) => {
  const counts = SCHEMA_VERSIONS.map((version) =>
    summaryMetricValue(
      summaryExport,
      subMetricKey('service_bus_forwarded', { schema_version: version })
    )
  )

  return counts.every((count) => count === null)
    ? null
    : counts.reduce((sum, count) => sum + (count ?? 0), 0)
}

const eventDrivenEntry = ({ design, summaryExport, callCounts, journey }) => {
  if (!publishesEvents(JOURNEYS[journey])) {
    return {
      journey,
      callsPerPage: 0,
      callsPerNotification: 0,
      note: NO_EVENTS_NOTE
    }
  }

  const forwarded = forwardedMessages(summaryExport)
  const submitted = counterValue(
    summaryExport,
    subMetricKey('notifications_submitted', {
      scenario: journey,
      submission: 'first'
    })
  )
  const pageRequests = pageRequestsOf(callCounts, journey)

  if (forwarded === null || !submitted || !pageRequests) {
    return unmeasuredEntry({
      design,
      journey,
      reason: NOT_MEASURED_BY_SUITE
    })
  }

  return {
    journey,
    callsPerPage: forwarded / pageRequests,
    callsPerNotification: forwarded / submitted,
    note: `${forwarded} forwarded messages over ${submitted} first submissions`
  }
}

const noCallerEntry = ({ design, journey }) => {
  const callsPerNotification =
    ADDRESS_LOOKUP_DERIVED.addressesPerNotification *
    ADDRESS_LOOKUP_DERIVED.callsPerAddress

  return {
    journey,
    callsPerPage:
      callsPerNotification / trafficOf(design, journey).pagesPerNotification,
    callsPerNotification,
    note: `derived: D4 ${ADDRESS_LOOKUP_DERIVED.addressesPerNotification} x D5 ${ADDRESS_LOOKUP_DERIVED.callsPerAddress}, TBC`
  }
}

const ENTRY_BUILDERS = Object.freeze({
  measured: measuredEntry,
  'event-driven': eventDrivenEntry,
  'no-caller': noCallerEntry
})

const journeysOf = (context) =>
  context.dependency.basis === 'shared'
    ? sharedEntries(context)
    : journeyKeys.map((journey) =>
        ENTRY_BUILDERS[context.dependency.basis]({ ...context, journey })
      )

const frontDoorOf = (dependency) =>
  dependency.dependency === 'defra-id'
    ? {
        callsPerHour:
          SIGN_IN_TARGET.designPerHour * DEFRA_ID_PROFILED_CALLS_PER_SIGN_IN,
        spikePerSecond:
          FRONT_DOOR_SPIKE_PER_SECOND * DEFRA_ID_PROFILED_CALLS_PER_SIGN_IN,
        derived: true,
        note: `derived, not measured: trade-imports-ins-frontend is not in this run (${SIGN_IN_TARGET.designPerHour} sign-ins an hour, NFR-VOL-CORE-01, x ${DEFRA_ID_PROFILED_CALLS_PER_SIGN_IN} profiled calls a sign-in; ${FRONT_DOOR_SPIKE_PER_SECOND} sign-ins a second in the spike)`
      }
    : undefined

const isPageDriven = (dependency) =>
  dependency.basis === 'measured' || dependency.basis === 'shared'

const standardContribution = ({ dependency, design, entry }) => {
  if (isPageDriven(dependency)) {
    return entry.callsPerPage === null
      ? null
      : entry.callsPerPage * designPagesPerSecond(design, entry.journey)
  }

  return entry.callsPerNotification === null
    ? null
    : entry.callsPerNotification *
        designNotificationsPerSecond(design, entry.journey)
}

const spikeContribution = ({ dependency, design, entry }) =>
  isPageDriven(dependency) && entry.callsPerPage !== null
    ? entry.callsPerPage * spikeRpsOf(design, entry.journey)
    : null

const rateNoteOf = (dependency) =>
  dependency.basis === 'no-caller'
    ? `${dependency.note}; §9.4 quotes ${ADDRESS_LOOKUP_DERIVED.section94PerHour} an hour (${ADDRESS_LOOKUP_DERIVED.section94SustainedPerSecond} a second sustained, ${ADDRESS_LOOKUP_DERIVED.section94BurstPerSecond} at the burst) before the design headroom; spike ${dependency.spikeNote}`
    : `spike ${dependency.spikeNote ?? 'is each journey frontend at its spike capacity'}`

const requiredRateOf = ({ dependency, design, journeys, frontDoor }) => {
  const frontDoorStandard = frontDoor
    ? frontDoor.callsPerHour / SECONDS_PER_HOUR
    : 0
  const journeyStandard = sumOrNull(
    journeys.map((entry) => standardContribution({ dependency, design, entry }))
  )
  const standardPerSecond =
    journeyStandard === null ? null : journeyStandard + frontDoorStandard
  const journeySpike = isPageDriven(dependency)
    ? sumOrNull(
        journeys.map((entry) =>
          spikeContribution({ dependency, design, entry })
        )
      )
    : null
  const spikePerSecond =
    journeySpike === null
      ? null
      : journeySpike + (frontDoor?.spikePerSecond ?? 0)

  return {
    standardPerSecond,
    standardPerHour:
      standardPerSecond === null ? null : standardPerSecond * SECONDS_PER_HOUR,
    p99BurstPerSecond:
      standardPerSecond === null
        ? null
        : standardPerSecond * design.p99Burst.burstFactor,
    spikePerSecond,
    note: rateNoteOf(dependency)
  }
}

/**
 * Says whether a dependency's published service level falls short of what INS
 * needs, and why.
 *
 * @param {object} options - The comparison.
 * @param {{ basis: string }} options.dependency - The dependency's entry in `REQUIRED_SLA_DEPENDENCIES`.
 * @param {{ requiredRate: { p99BurstPerSecond?: number | null, spikePerSecond?: number | null }, requiredLatency: { p95Ms: number, p99Ms: number } | null }} options.required - What INS needs; a null rate is one that was not measured.
 * @param {{ throughputPerSecond?: number, p95Ms?: number, p99Ms?: number } | null} options.published - The owner's published service level, or null when none is.
 * @returns {{ flagged: boolean, reasons: string[] }} Every reason it is a risk; none when it is not.
 */
export const riskOf = ({ dependency, required, published }) => {
  const neededPerSecond =
    required.requiredRate.spikePerSecond ??
    required.requiredRate.p99BurstPerSecond
  const rateKnown = Number.isFinite(neededPerSecond)
  const throughputKnown =
    published !== null && Number.isFinite(published.throughputPerSecond)
  const reasons = [
    ...(published === null ? [NO_PUBLISHED_SLA_REASON] : []),
    ...(published !== null && !rateKnown ? [RATE_NOT_MEASURED_REASON] : []),
    ...(published !== null && !throughputKnown
      ? [NO_PUBLISHED_THROUGHPUT_REASON]
      : []),
    ...(rateKnown &&
    throughputKnown &&
    published.throughputPerSecond < neededPerSecond
      ? [
          `published throughput ${published.throughputPerSecond} a second falls short of the ${rateText(neededPerSecond)} a second needed`
        ]
      : []),
    ...(published !== null &&
    required.requiredLatency !== null &&
    published.p95Ms > required.requiredLatency.p95Ms
      ? [
          `published p95 ${published.p95Ms}ms falls short of the ${required.requiredLatency.p95Ms}ms needed`
        ]
      : []),
    ...(published !== null &&
    required.requiredLatency !== null &&
    published.p99Ms > required.requiredLatency.p99Ms
      ? [
          `published p99 ${published.p99Ms}ms falls short of the ${required.requiredLatency.p99Ms}ms needed`
        ]
      : []),
    ...(dependency.basis === 'no-caller' ? [NO_CALLER_REASON] : [])
  ]

  return { flagged: reasons.length > 0, reasons }
}

const highest = (rows, key) => {
  const values = rows.map((row) => row[key]).filter((value) => value !== null)

  return values.length === 0 ? null : Math.max(...values)
}

const breachesOf = (measured, requiredLatency) =>
  [
    ['p95', measured.p95Ms, requiredLatency.p95Ms],
    ['p99', measured.p99Ms, requiredLatency.p99Ms]
  ]
    .filter(([, value, limit]) => value !== null && value > limit)
    .map(
      ([name, value, limit]) =>
        `${name} ${Math.round(value)}ms against ${limit}ms`
    )

const stubProfilesOf = (rows) => [
  ...new Set(rows.map((row) => row.stubProfile?.profile).filter(Boolean))
]

/**
 * Judges whether a dependency is meeting the latency INS needs, from the
 * per-dependency metrics alone: the calls the services measured over the run
 * window, never an integrated load run.
 *
 * @param {object} options - The judgement.
 * @param {{ basis: string }} options.dependency - The dependency's entry in `REQUIRED_SLA_DEPENDENCIES`.
 * @param {{ p95Ms: number, p99Ms: number } | null} options.requiredLatency - The latency INS needs, or null when none is set.
 * @param {Array<{ calls: number | null, p95Ms: number | null, p99Ms: number | null, stubProfile?: { profile: string } | null }>} options.rows - The external call report's rows for the dependency.
 * @param {string | null} options.unavailableReason - Why CloudWatch could not be read, or null.
 * @returns {{ basis: string, verdict: string, measured: { p95Ms: number | null, p99Ms: number | null, calls: number } | null, stubProfile: string | null, reason: string | null }} The verdict and what it rests on.
 */
export const metOf = ({
  dependency,
  requiredLatency,
  rows,
  unavailableReason
}) => {
  const unjudged = (verdict) => ({
    basis: MET_BASIS,
    verdict,
    measured: null,
    stubProfile: null,
    reason: null
  })

  if (dependency.basis === 'no-caller') {
    return unjudged('not judged: no caller')
  }

  if (requiredLatency === null) {
    return unjudged('not judged: no required latency (TBC)')
  }

  const called = rows.filter((row) => row.calls > 0)

  if (called.length === 0) {
    const reason = unavailableReason ?? NO_CALLS_REASON

    return { ...unjudged(`${NOT_MEASURED}: ${reason}`), reason }
  }

  const measured = {
    p95Ms: highest(called, 'p95Ms'),
    p99Ms: highest(called, 'p99Ms'),
    calls: called.reduce((sum, row) => sum + row.calls, 0)
  }
  const breaches = breachesOf(measured, requiredLatency)
  const profiles = stubProfilesOf(called)

  return {
    basis: MET_BASIS,
    verdict: breaches.length === 0 ? 'met' : `NOT MET (${breaches.join(', ')})`,
    measured,
    stubProfile: profiles.length === 0 ? null : profiles.join(', '),
    reason:
      profiles.length === 0
        ? null
        : `measured against the ${profiles.join(', ')} stub, not the real system`
  }
}

const rowsOf = (externalReport, dependency) =>
  externalReport.rows.filter((row) => row.dependency === dependency.dependency)

const trafficDescription = (design) =>
  `design-target sustained rate (${journeyKeys
    .map((journey) => trafficOf(design, journey).notificationsPerHour)
    .join(' and ')} notifications an hour, ${journeyKeys
    .map((journey) => trafficOf(design, journey).pagesPerNotification)
    .join(' and ')} pages a notification, headroom included)`

const peakDescription = (design) =>
  `the P99 burst (x${design.p99Burst.burstFactor}, T5) and the ${design.spikeRecovery.spikeDuration} spike (${spikeRpsOf(design, journeyKeys[0])} RPS a journey frontend, §4.2)`

const dependencyStatement = (context) => {
  const { dependency, design, summaryExport, externalReport } = context
  const journeys = journeysOf(context)
  const frontDoor = frontDoorOf(dependency)
  const requiredRate = requiredRateOf({
    dependency,
    design,
    journeys,
    frontDoor
  })
  const published = PUBLISHED_SLAS[dependency.dependency] ?? null
  const required = {
    requiredRate,
    requiredLatency: dependency.requiredLatency
  }

  return {
    dependency: dependency.dependency,
    owner: dependency.owner,
    interfaces: dependency.interfaces,
    basis: dependency.basis,
    note: dependency.note,
    journeys,
    ...(frontDoor === undefined ? {} : { frontDoor }),
    requiredRate,
    requiredLatency: dependency.requiredLatency,
    latencyNote: dependency.latencyNote,
    published,
    publishedSource: PUBLISHED_SLA_SOURCE,
    risk: riskOf({ dependency, required, published }),
    met: metOf({
      dependency,
      requiredLatency: dependency.requiredLatency,
      rows: rowsOf(externalReport, dependency),
      unavailableReason:
        externalReport.source === 'unavailable'
          ? externalReport.unavailableReason
          : null
    }),
    stubProfile:
      stubProfilesFromSummary(summaryExport, STUBBED_INTEGRATIONS)[
        dependency.dependency
      ] ?? null
  }
}

/**
 * Builds INS's required service level for each system outside the boundary,
 * from the call ratios the journey frontends measured and the design-target
 * traffic, and judges each against its published service level and the
 * per-dependency metrics.
 *
 * @param {object} options - The statement.
 * @param {string} options.environment - The environment the run targeted.
 * @param {{ startedAt: string, endedAt: string }} options.window - The run window.
 * @param {{ source: string, journeys: Record<string, object> } | null} options.callCounts - What the frontends counted, or null when nothing was measured.
 * @param {{ metrics?: Record<string, object> } | undefined} options.summaryExport - The run's parsed `--summary-export` file.
 * @param {{ source: string, unavailableReason: string | null, rows: object[] }} options.externalReport - The external call report.
 * @param {object} options.design - The traffic model the requirement is stated at, `TRAFFIC_DEFAULTS`.
 * @returns {object} The statement, one entry for each dependency in `REQUIRED_SLA_DEPENDENCIES`, address lookup first.
 */
export const requiredSlaStatement = ({
  environment,
  window,
  callCounts,
  summaryExport,
  externalReport,
  design
}) => ({
  environment,
  window,
  callCountsSource: callCounts?.source ?? null,
  standard: trafficDescription(design),
  peak: peakDescription(design),
  dependencies: REQUIRED_SLA_DEPENDENCIES.map((dependency) =>
    dependencyStatement({
      dependency,
      design,
      callCounts,
      summaryExport,
      externalReport
    })
  )
})

const journeyCallsText = (entry) => {
  if (entry.callsPerPage === null) {
    return `${entry.journey} ${entry.note}`
  }

  if (entry.callsPerPage === 0) {
    return `${entry.journey} 0 calls (${entry.note})`
  }

  return `${entry.journey} ${fixed(entry.callsPerPage, RATE_DECIMALS)} calls a page, ${fixed(entry.callsPerNotification, LARGE_RATE_DECIMALS)} a notification`
}

const sharedCallsText = ({ journeys, note }) =>
  journeys[0].callsPerPage === null
    ? journeys[0].note
    : `${fixed(journeys[0].callsPerPage, RATE_DECIMALS)} calls a page, ${note}`

const callsTextOf = (entry) => {
  if (entry.basis === 'no-caller') {
    return `${NO_CALLER_TEXT}; ${entry.journeys[0].callsPerNotification} calls a notification (D4 x D5, derived)`
  }

  if (entry.basis === 'shared') {
    return sharedCallsText(entry)
  }

  return [
    ...entry.journeys.map(journeyCallsText),
    ...(entry.frontDoor
      ? [`front door ${entry.frontDoor.callsPerHour} an hour (derived)`]
      : [])
  ].join('; ')
}

const rateTextOf = (
  { standardPerSecond, p99BurstPerSecond, spikePerSecond },
  spikeNote
) => {
  if (standardPerSecond === null) {
    return NOT_MEASURED
  }

  const spike =
    spikePerSecond === null
      ? `spike ${spikeNote ?? NOT_MEASURED}`
      : `${rateText(spikePerSecond)} in the spike`

  return `${rateText(standardPerSecond)} a second standard, ${rateText(p99BurstPerSecond)} at the P99 burst, ${spike}`
}

const latencyTextOf = ({ requiredLatency, latencyNote }) =>
  requiredLatency === null
    ? `latency ${latencyNote}`
    : `at p95 ${requiredLatency.p95Ms}ms and p99 ${requiredLatency.p99Ms}ms`

const riskTextOf = ({ flagged, reasons }) =>
  flagged ? `RISK: ${reasons.join('; ')}` : 'no risk flagged'

const spikeNoteOf = (entry) =>
  REQUIRED_SLA_DEPENDENCIES.find(
    ({ dependency }) => dependency === entry.dependency
  )?.spikeNote

const needsTextOf = (entry) => {
  const rate = rateTextOf(entry.requiredRate, spikeNoteOf(entry))
  const latency = latencyTextOf(entry)

  return entry.requiredLatency === null
    ? `${rate}; ${latency}`
    : `${rate}, ${latency}`
}

const whoText = ({ owner, interfaces }) =>
  [owner, interfaces.join(', ')].filter(Boolean).join('; ')

const dependencyLine = (entry) =>
  `Required SLA ${entry.dependency} (${whoText(entry)}): ${callsTextOf(entry)}; needs ${needsTextOf(entry)}; ${riskTextOf(entry.risk)}; met: ${entry.met.verdict}`

/**
 * Words the required service levels as lines for the run log.
 *
 * @param {ReturnType<typeof requiredSlaStatement>} statement - The statement.
 * @returns {string[]} A header line, then one line for each dependency, address lookup first.
 */
export const requiredSlaLines = (statement) => [
  `Required service levels (environment ${statement.environment}, design-target traffic: standard is the sustained design target, peak ${statement.peak}); calls measured from ${statement.callCountsSource ?? `nothing (${NOT_MEASURED})`}`,
  ...statement.dependencies.map(dependencyLine)
]

const figureOf = (value, decimals) =>
  value === null ? NOT_MEASURED : fixed(value, decimals)

const perJourney = (entry, format) =>
  entry.journeys
    .map(
      (journey) =>
        `${journey.journey}: ${journey.callsPerPage === null ? NOT_MEASURED : format(journey)}`
    )
    .join('; ')

const publishedText = (published) =>
  published === null
    ? 'none'
    : `${published.throughputPerSecond} a second, p95 ${published.p95Ms}ms, p99 ${published.p99Ms}ms (${published.source})`

const requiredLatencyText = ({ requiredLatency, latencyNote }) =>
  requiredLatency === null
    ? latencyNote
    : `p95 ${requiredLatency.p95Ms}ms, p99 ${requiredLatency.p99Ms}ms`

const SUMMARY_COLUMNS = [
  'Dependency',
  'Owner',
  'Interfaces',
  'Calls a page',
  'Calls a notification',
  'Standard a second',
  'P99 burst a second',
  'Spike a second',
  'Required latency',
  'Published',
  'Risk',
  'Met'
]

const summaryRow = (entry) => [
  entry.dependency,
  entry.owner,
  entry.interfaces.join(', ') || NOT_AVAILABLE,
  perJourney(entry, ({ callsPerPage }) => fixed(callsPerPage, RATE_DECIMALS)),
  perJourney(entry, ({ callsPerNotification }) =>
    fixed(callsPerNotification, LARGE_RATE_DECIMALS)
  ),
  figureOf(entry.requiredRate.standardPerSecond, RATE_DECIMALS),
  figureOf(entry.requiredRate.p99BurstPerSecond, RATE_DECIMALS),
  entry.requiredRate.spikePerSecond === null
    ? (spikeNoteOf(entry) ?? NOT_MEASURED)
    : fixed(entry.requiredRate.spikePerSecond, LARGE_RATE_DECIMALS),
  requiredLatencyText(entry),
  publishedText(entry.published),
  entry.risk.flagged ? entry.risk.reasons.join('; ') : 'none',
  entry.met.verdict
]

const callsRows = (statement) =>
  statement.dependencies.flatMap((entry) =>
    entry.journeys.map((journey) => [
      entry.dependency,
      journey.journey,
      figureOf(journey.callsPerPage, RATE_DECIMALS),
      figureOf(journey.callsPerNotification, LARGE_RATE_DECIMALS),
      journey.note
    ])
  )

/**
 * Writes the required service levels as a complete HTML page, ready to send to
 * each owner.
 *
 * @param {ReturnType<typeof requiredSlaStatement>} statement - The statement.
 * @returns {string} The page. Every value is escaped, and styles are inline.
 */
export const requiredSlaHtml = (statement) =>
  [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>Required service levels</title>',
    '</head>',
    '<body style="font-family:sans-serif;margin:16px">',
    '<h1>Required service levels</h1>',
    `<p>${escapeHtml(`Environment ${statement.environment}, window ${statement.window.startedAt} to ${statement.window.endedAt}. Standard is the ${statement.standard}; peak is ${statement.peak}. Calls measured from ${statement.callCountsSource ?? `nothing (${NOT_MEASURED})`}.`)}</p>`,
    table(
      'Required service level per dependency',
      SUMMARY_COLUMNS,
      statement.dependencies.map(summaryRow)
    ),
    table(
      'Calls per journey',
      [
        'Dependency',
        'Journey',
        'Calls a page',
        'Calls a notification',
        'Basis'
      ],
      callsRows(statement)
    ),
    '</body>',
    '</html>',
    ''
  ].join('\n')
