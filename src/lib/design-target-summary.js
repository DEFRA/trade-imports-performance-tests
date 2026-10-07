import {
  ALONE_PHASES,
  DESIGN_TARGETS,
  FRONTEND_OF_SCENARIO,
  ISOLATION_PAIRS,
  JOURNEY_OF,
  REPORTED_PHASES,
  RETURNING_SCENARIOS,
  HOUR_PHASES,
  SHAPES,
  averageLoadFactors,
  averageLoadProfileLine,
  combinedProfileLine,
  enduranceProfileLine,
  enduranceRunSeconds,
  eventingWatchSeconds,
  eventingWindow,
  expectedReauthentications,
  hourLabel,
  journeyScenariosIn,
  percentText,
  runLine,
  segmentOf,
  sessionExpiryText,
  spikeCapacities,
  spikeProfileLine
} from '../config/design-target.js'
import { kindOf } from '../config/endpoints.js'
import { REFERENCE_DATA_READS } from '../config/reference-data.js'
import { RE_AUTHENTICATION_TAG } from '../config/request-mix.js'
import { INTERIM_TARGETS, subMetricKey } from '../config/thresholds.js'
import {
  SECONDS_PER_HOUR,
  SECONDS_PER_MINUTE,
  durationSeconds,
  durationText
} from '../config/traffic.js'
import {
  drainLine,
  eventCountLines,
  eventCountRows,
  eventingWatchSummary,
  smoothingLine
} from './eventing.js'
import { expectedExpiries } from './reference-data.js'
import { thresholdLines, thresholdResults } from './summary-text.js'

const PERCENT = 100
const RPS_DECIMALS = 2
const FIGURE_DECIMALS = 1
const BACKEND_NOTE = 'derived: 1 backend call a page'
const FRONTENDS = ['animals', 'plants', 'ins']
const KINDS = ['page', 'api', 'upload']

const rounded = (value, decimals) => String(Number(value.toFixed(decimals)))
const rpsText = (value) => rounded(value, RPS_DECIMALS)
const figureText = (value) => rounded(value, FIGURE_DECIMALS)
const millisecondsText = (value) => `${Math.round(value)}ms`

/**
 * Reads one statistic of a metric from k6's summary data.
 *
 * @param {Record<string, { values?: Record<string, number> }>} metrics - k6's summary metrics.
 * @param {string} key - The metric or sub-metric key.
 * @param {string} stat - `count`, `rate`, `avg` or `p(95)`.
 * @returns {number | undefined} The value, or undefined when k6 has none.
 */
export const valueOf = (metrics, key, stat) => metrics[key]?.values?.[stat]

/**
 * How long a phase lasts.
 *
 * @param {ReadonlyArray<{ phase: string, startSeconds: number, endSeconds: number | null }>} schedule - The run's phases.
 * @param {string} phase - A phase name.
 * @returns {number} Seconds. A phase with no end has no length, so this is NaN for it.
 */
export const phaseSeconds = (schedule, phase) => {
  const entry = schedule.find((candidate) => candidate.phase === phase)

  return entry.endSeconds - entry.startSeconds
}

const countOf = (metrics, key) => valueOf(metrics, key, 'count') ?? 0

const concurrentUsersOf = (metrics, key, seconds) =>
  ((valueOf(metrics, key, 'avg') ?? 0) * countOf(metrics, key)) / seconds

/**
 * Works out what a journey achieved over a phase.
 *
 * @param {object} options - The phase.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {string} options.scenario - `live-animals` or `high-risk-plants`.
 * @param {string} options.phase - The phase name.
 * @param {number} options.seconds - The phase's length.
 * @returns {{ notificationsPerHour: number, frontendRps: number, backendRps: number, concurrentUsers: number }} The achieved figures. The backend rate is derived from the frontend's.
 */
export const achievedJourney = ({ metrics, scenario, phase, seconds }) => {
  const frontendRps =
    countOf(
      metrics,
      subMetricKey('page_requests', {
        frontend: FRONTEND_OF_SCENARIO[scenario],
        phase
      })
    ) / seconds

  return {
    notificationsPerHour:
      (countOf(
        metrics,
        subMetricKey('notifications_started', { scenario, phase })
      ) *
        SECONDS_PER_HOUR) /
      seconds,
    frontendRps,
    backendRps: frontendRps * DESIGN_TARGETS.backendCallsPerPage,
    concurrentUsers: concurrentUsersOf(
      metrics,
      subMetricKey('session_seconds', { scenario, phase }),
      seconds
    )
  }
}

/**
 * Works out what the front door achieved over a phase.
 *
 * @param {object} options - The phase.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {string} options.phase - The phase name.
 * @param {number} options.seconds - The phase's length.
 * @returns {{ signInsPerHour: number, coreRps: number, concurrentUsers: number, dashboardReadShare: number | undefined }} The achieved figures.
 */
export const achievedFrontDoor = ({ metrics, phase, seconds }) => ({
  signInsPerHour:
    (countOf(
      metrics,
      subMetricKey('page_requests', { traffic_class: 'sign-in', phase })
    ) *
      SECONDS_PER_HOUR) /
    seconds,
  coreRps:
    countOf(
      metrics,
      subMetricKey('page_requests', { frontend: 'ins', phase })
    ) / seconds,
  concurrentUsers: concurrentUsersOf(
    metrics,
    subMetricKey('session_seconds', { phase }),
    seconds
  ),
  dashboardReadShare: valueOf(
    metrics,
    subMetricKey('dashboard_read_share', { phase }),
    'rate'
  )
})

/**
 * Works out each frontend's page rate over the burst minute.
 *
 * @param {object} options - The burst.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {number} options.seconds - The burst's length.
 * @returns {{ animals: number, plants: number, ins: number }} Page requests a second.
 */
export const achievedBurst = ({ metrics, seconds }) =>
  Object.fromEntries(
    FRONTENDS.map((frontend) => [
      frontend,
      countOf(
        metrics,
        subMetricKey('page_requests', { frontend, phase: 'burst' })
      ) / seconds
    ])
  )

/**
 * Reads one statistic of a sub-metric of `http_req_duration`.
 *
 * @param {Record<string, object>} metrics - k6's summary metrics.
 * @param {Record<string, string>} tags - The tags that select the sub-metric.
 * @param {string} stat - `count`, `max`, `p(95)` or any other trend statistic.
 * @returns {number | undefined} The value, or undefined when k6 has none.
 */
export const durationOf = (metrics, tags, stat) =>
  valueOf(metrics, subMetricKey('http_req_duration', tags), stat)

/**
 * Compares one scenario and request kind's P95 in a later phase with a limit
 * worked out from its P95 in an earlier one.
 *
 * k6 cannot compare two of its own metrics in a threshold, so the run works
 * this out from the summary. A pair with fewer requests in the later phase than
 * `minSamples`, fewer in the earlier phase than `minBeforeSamples`, or none in
 * the earlier phase, is not judged.
 *
 * @param {object} options - The pair.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {string} options.scenario - The scenario name.
 * @param {string} options.kind - `page`, `api` or `upload`.
 * @param {string} options.before - The phase the limit comes from.
 * @param {string} options.after - The phase that is judged.
 * @param {number} options.factor - The most the later P95 may be, as a multiple of the earlier.
 * @param {number} options.minSamples - The fewest requests in the later phase that are judged.
 * @param {number} [options.minBeforeSamples] - The fewest requests in the earlier phase that are judged. 0 judges any.
 * @returns {{ scenario: string, kind: string, beforeP95Ms: number | undefined, afterP95Ms: number | undefined, beforeCount: number, afterCount: number, limitMs: number | undefined, verdict: 'within' | 'over' | 'not judged' }} The comparison.
 */
export const p95Comparison = ({
  metrics,
  scenario,
  kind,
  before,
  after,
  factor,
  minSamples,
  minBeforeSamples = 0
}) => {
  const beforeP95Ms = durationOf(
    metrics,
    { scenario, kind, phase: before },
    'p(95)'
  )
  const afterP95Ms = durationOf(
    metrics,
    { scenario, kind, phase: after },
    'p(95)'
  )
  const beforeCount =
    durationOf(metrics, { scenario, kind, phase: before }, 'count') ?? 0
  const afterCount =
    durationOf(metrics, { scenario, kind, phase: after }, 'count') ?? 0
  const limitMs = beforeP95Ms === undefined ? undefined : beforeP95Ms * factor
  const judged =
    afterCount >= minSamples &&
    beforeCount >= minBeforeSamples &&
    beforeP95Ms !== undefined &&
    afterP95Ms !== undefined
  const verdict = !judged
    ? 'not judged'
    : afterP95Ms > limitMs
      ? 'over'
      : 'within'

  return {
    scenario,
    kind,
    beforeP95Ms,
    afterP95Ms,
    beforeCount,
    afterCount,
    limitMs,
    verdict
  }
}

/**
 * The request kinds a scenario's endpoints make, in the order reports list them.
 *
 * @param {string[]} endpoints - Endpoint names from the catalogue.
 * @returns {string[]} `page`, `api` and `upload`, those that apply.
 */
export const kindsIn = (endpoints) =>
  KINDS.filter((kind) => endpoints.some((name) => kindOf(name) === kind))

/**
 * Compares P95 between two phases for each scenario and request kind the
 * scenario makes.
 *
 * @param {object} options - The run.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {Record<string, { endpoints: string[] }>} options.scenarioSet - Scenarios shaped like `SCENARIOS`.
 * @param {string} options.before - The phase the limit comes from.
 * @param {string} options.after - The phase that is judged.
 * @param {number} options.factor - The most the later P95 may be, as a multiple of the earlier.
 * @param {number} options.minSamples - The fewest requests in either phase that are judged: a P95 of a handful of requests says nothing, in the earlier phase as much as the later.
 * @returns {Array<ReturnType<typeof p95Comparison>>} One per pair.
 */
export const p95Comparisons = ({
  metrics,
  scenarioSet,
  before,
  after,
  factor,
  minSamples
}) =>
  Object.entries(scenarioSet).flatMap(([scenario, { endpoints }]) =>
    kindsIn(endpoints).map((kind) =>
      p95Comparison({
        metrics,
        scenario,
        kind,
        before,
        after,
        factor,
        minSamples,
        minBeforeSamples: minSamples
      })
    )
  )

const relativeVerdictFor = ({ metrics, scenario, kind }) => {
  const { p95FactorOverPeak, minSamples } = INTERIM_TARGETS.burst
  const { beforeP95Ms, afterP95Ms, afterCount, limitMs, verdict } =
    p95Comparison({
      metrics,
      scenario,
      kind,
      before: 'peak',
      after: 'burst',
      factor: p95FactorOverPeak,
      minSamples
    })

  return {
    scenario,
    kind,
    peakP95Ms: beforeP95Ms,
    burstP95Ms: afterP95Ms,
    burstCount: afterCount,
    limitMs,
    verdict
  }
}

/**
 * Judges the burst minute's P95 against twice the peak phase's P95, for each
 * scenario and request kind that made a request in the burst minute.
 *
 * k6 cannot compare two of its own metrics in a threshold, so the run works
 * this out from the summary. A pair with fewer requests in the burst minute
 * than `INTERIM_TARGETS.burst.minSamples` is not judged.
 *
 * @param {object} options - The run.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {Record<string, { endpoints: string[] }>} options.scenarioSet - Scenarios shaped like `SCENARIOS`.
 * @returns {Array<{ scenario: string, kind: string, peakP95Ms: number | undefined, burstP95Ms: number | undefined, burstCount: number, limitMs: number | undefined, verdict: 'within' | 'over' | 'not judged' }>} One per pair.
 */
export const relativeBurstVerdicts = ({ metrics, scenarioSet }) =>
  Object.entries(scenarioSet).flatMap(([scenario, { endpoints }]) =>
    kindsIn(endpoints).map((kind) =>
      relativeVerdictFor({ metrics, scenario, kind })
    )
  )

const limitHolds = (value, limit) => limit === undefined || value < limit

/**
 * Lists each endpoint's response times over a phase, against its limits.
 *
 * @param {object} options - The phase.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {Record<string, { endpoints: string[] }>} options.scenarioSet - Scenarios shaped like `SCENARIOS`.
 * @param {string} [options.phase] - The phase name. Without one the rows cover the whole run.
 * @returns {Array<{ journey: string, scenario: string, endpoint: string, kind: string, count: number, p95Ms: number, p99Ms: number, p95LimitMs: number | undefined, p99LimitMs: number | undefined, within: boolean }>} One row per scenario and endpoint with samples.
 */
export const endpointRows = ({ metrics, scenarioSet, phase }) =>
  Object.entries(scenarioSet).flatMap(([scenario, { endpoints }]) =>
    endpoints.flatMap((endpoint) => {
      const tags =
        phase === undefined
          ? { scenario, endpoint }
          : { scenario, endpoint, phase }
      const count = durationOf(metrics, tags, 'count') ?? 0

      if (count === 0) {
        return []
      }

      const kind = kindOf(endpoint)
      const { p95Ms: p95LimitMs, p99Ms: p99LimitMs } = INTERIM_TARGETS[kind]
      const p95Ms = durationOf(metrics, tags, 'p(95)')
      const p99Ms = durationOf(metrics, tags, 'p(99)')

      return [
        {
          journey: JOURNEY_OF[scenario],
          scenario,
          endpoint,
          kind,
          count,
          p95Ms,
          p99Ms,
          p95LimitMs,
          p99LimitMs,
          within: limitHolds(p95Ms, p95LimitMs) && limitHolds(p99Ms, p99LimitMs)
        }
      ]
    })
  )

const againstText = (achieved, target, format) =>
  `${format(achieved)} against ${format(target)}`

const labelledAgainst = (label, achieved, target, format) =>
  `${format(achieved)} ${label} against ${format(target)}`

/**
 * States a journey's achieved figures against its volumetrics targets.
 *
 * @param {object} options - The figures.
 * @param {string} options.scenario - The journey's scenario name.
 * @param {string} options.phase - The phase they were worked out over.
 * @param {number} options.seconds - The phase's length.
 * @param {ReturnType<typeof achievedJourney>} options.achieved - What the run achieved.
 * @param {(typeof DESIGN_TARGETS)['live-animals']} options.target - The volumetrics figures.
 * @returns {string} The line.
 */
export const achievedJourneyLine = ({
  scenario,
  phase,
  seconds,
  achieved,
  target
}) =>
  `Achieved ${scenario} over the ${phase} (${durationText(seconds)}): ${labelledAgainst('notifications an hour', achieved.notificationsPerHour, target.notificationsPerHour, figureText)}, frontend ${labelledAgainst('RPS', achieved.frontendRps, target.frontendRps, rpsText)}, backend ${labelledAgainst('RPS', achieved.backendRps, target.backendRps, rpsText)} (${BACKEND_NOTE}), ${labelledAgainst('concurrent users', achieved.concurrentUsers, target.concurrentUsers, figureText)} (${target.source})`

/**
 * States the front door's achieved figures against its volumetrics targets.
 *
 * @param {object} options - The figures.
 * @param {string} options.phase - The phase they were worked out over.
 * @param {number} options.seconds - The phase's length.
 * @param {ReturnType<typeof achievedFrontDoor>} options.achieved - What the run achieved.
 * @param {(typeof DESIGN_TARGETS)['frontDoor']} options.target - The volumetrics figures.
 * @returns {string} The line.
 */
export const achievedFrontDoorLine = ({ phase, seconds, achieved, target }) =>
  `Achieved front door over the ${phase} (${durationText(seconds)}): ${labelledAgainst('sign-ins an hour', achieved.signInsPerHour, target.signInsPerHour, figureText)}, core pages ${labelledAgainst('RPS', achieved.coreRps, target.coreRps, rpsText)}, ${labelledAgainst('concurrent users', achieved.concurrentUsers, target.concurrentUsers, figureText)} (${target.source})`

/**
 * States the dashboard-read share of the request mix against the D7 target.
 *
 * @param {object} options - The share.
 * @param {string} options.phase - The phase it was worked out over.
 * @param {number | undefined} options.share - The achieved share, 0 to 1.
 * @returns {string} The line.
 */
export const requestMixLine = ({ phase, share }) =>
  `Request mix over the ${phase}: dashboard reads ${share === undefined ? 'not measured' : percentText(share)} of page requests against the ${percentText(DESIGN_TARGETS.dashboardReadShare)} target (D7)`

/**
 * States each frontend's page rate in the burst minute against its target.
 *
 * @param {object} options - The burst.
 * @param {string} options.burstDuration - The burst's length as configured, such as `60s`.
 * @param {number} options.burstFactor - How many times the sustained rate the burst runs at.
 * @param {{ animals: number, plants: number, ins: number }} options.achieved - Page requests a second.
 * @param {{ animals: number, plants: number, ins: number }} options.targets - The burst RPS targets.
 * @returns {string} The line.
 */
export const achievedBurstLine = ({
  burstDuration,
  burstFactor,
  achieved,
  targets
}) =>
  `Achieved burst (${burstDuration} at ${burstFactor}x): animals frontend ${labelledAgainst('RPS', achieved.animals, targets.animals, rpsText)}, plants ${againstText(achieved.plants, targets.plants, rpsText)}, INS ${againstText(achieved.ins, targets.ins, rpsText)}`

const verdictText = (verdict) => (verdict === 'over' ? 'OVER' : 'within')

/**
 * States one relative burst verdict.
 *
 * @param {ReturnType<typeof relativeBurstVerdicts>[number]} verdict - The verdict.
 * @returns {string} The line.
 */
export const relativeLine = ({
  scenario,
  kind,
  peakP95Ms,
  burstP95Ms,
  burstCount,
  limitMs,
  verdict
}) => {
  const subject = `Burst P95 ${scenario} ${kind}`
  const { minSamples } = INTERIM_TARGETS.burst

  if (verdict === 'not judged') {
    return burstCount < minSamples
      ? `${subject}: not judged, ${burstCount} requests in the burst minute, fewer than ${minSamples}`
      : `${subject}: not judged, no requests in the peak phase`
  }

  return `${subject}: ${millisecondsText(burstP95Ms)} against twice the peak's ${millisecondsText(peakP95Ms)} (${millisecondsText(limitMs)}): ${verdictText(verdict)}`
}

/**
 * States how one endpoint's response times went over a phase.
 *
 * @param {ReturnType<typeof endpointRows>[number]} row - The endpoint's row.
 * @returns {string} The line.
 */
export const endpointLine = ({
  journey,
  scenario,
  endpoint,
  kind,
  count,
  p95Ms,
  p99Ms,
  p95LimitMs,
  p99LimitMs,
  within
}) => {
  const limit = (value) =>
    value === undefined ? '' : ` against ${millisecondsText(value)}`

  return `Endpoint ${journey} ${scenario} ${endpoint} (${kind}, ${count} requests): P95 ${millisecondsText(p95Ms)}${limit(p95LimitMs)}, P99 ${millisecondsText(p99Ms)}${limit(p99LimitMs)}: ${within ? 'within' : 'OVER'}`
}

/**
 * States whether the relative burst rule passed.
 *
 * @param {object} options - The verdicts.
 * @param {ReturnType<typeof relativeBurstVerdicts>} options.verdicts - Every pair's verdict.
 * @returns {string} The line.
 */
export const relativeOutcomeLine = ({ verdicts }) => {
  const over = verdicts.filter(({ verdict }) => verdict === 'over')

  return over.length === 0
    ? 'Relative thresholds: passed'
    : `Relative thresholds: FAILED: ${over.map(({ scenario, kind }) => `${scenario} ${kind}`).join('; ')}`
}

const pagesOver = (metrics, tags) =>
  countOf(metrics, subMetricKey('page_requests', tags))

/**
 * Works out each component's page rate over the spike, and the figures derived from them.
 *
 * The backends and the session path are derived, because nothing in the stack
 * serves a session API: a backend call is one for each journey page, and the session
 * path is every frontend page plus those backend calls.
 *
 * @param {object} options - The spike.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {number} options.seconds - The spike's length.
 * @returns {{ animals: number, plants: number, ins: number, animalsBackend: number, plantsBackend: number, sessionPath: number, signIns: number }} Page requests a second; `signIns` is a count.
 */
export const achievedSpike = ({ metrics, seconds }) => {
  const rate = (tags) =>
    pagesOver(metrics, { ...tags, phase: 'spike' }) / seconds
  const { backendCallsPerPage } = DESIGN_TARGETS
  const animals = rate({ frontend: 'animals' })
  const plants = rate({ frontend: 'plants' })
  const ins = rate({ frontend: 'ins' })
  const [animalsBackend, plantsBackend] = [animals, plants].map(
    (pages) => pages * backendCallsPerPage
  )

  return {
    animals,
    plants,
    ins,
    animalsBackend,
    plantsBackend,
    sessionPath: animals + plants + ins + animalsBackend + plantsBackend,
    signIns: pagesOver(metrics, { traffic_class: 'sign-in', phase: 'spike' })
  }
}

/**
 * States each component's achieved spike rate against its stated capacity.
 *
 * @param {object} options - The spike.
 * @param {string} options.duration - The spike's length as configured, such as `10s`.
 * @param {ReturnType<typeof achievedSpike>} options.achieved - What the run achieved.
 * @param {ReturnType<typeof spikeCapacities>} options.capacities - The stated capacities.
 * @returns {string} The line.
 */
export const spikeLine = ({ duration, achieved, capacities }) => {
  const { backendCallsPerPage } = DESIGN_TARGETS

  return `Spike (${duration}): animals frontend ${labelledAgainst('RPS', achieved.animals, capacities.animals, rpsText)}, backend ${labelledAgainst('RPS', achieved.animalsBackend, capacities.animals * backendCallsPerPage, rpsText)} (${BACKEND_NOTE}); plants frontend ${labelledAgainst('RPS', achieved.plants, capacities.plants, rpsText)}, backend ${labelledAgainst('RPS', achieved.plantsBackend, capacities.plants * backendCallsPerPage, rpsText)}; INS front door ${labelledAgainst('RPS', achieved.ins, capacities.ins, rpsText)} including ${achieved.signIns} sign-ins; session path ${labelledAgainst('RPS', achieved.sessionPath, capacities.sessionPath, rpsText)} (derived: every frontend page plus ${backendCallsPerPage} backend call a journey page)`
}

const percentOver = (factor) => `${Math.round((factor - 1) * PERCENT)}%`

/**
 * States one recovery comparison: the recovered window's P95 against the baseline's plus 10%.
 *
 * @param {ReturnType<typeof p95Comparison> & { window: string }} comparison - The comparison, with the recovered window's length as configured.
 * @returns {string} The line.
 */
export const recoveryLine = ({
  scenario,
  kind,
  beforeP95Ms,
  afterP95Ms,
  beforeCount,
  afterCount,
  limitMs,
  verdict,
  window
}) => {
  const subject = `Recovery P95 ${scenario} ${kind}`
  const { minSamples, p95FactorOverBaseline } = INTERIM_TARGETS.spike

  if (verdict === 'not judged') {
    return afterCount < minSamples
      ? `${subject}: not judged, ${afterCount} requests in the recovered ${window}, fewer than ${minSamples}`
      : `${subject}: not judged, ${beforeCount} requests in the baseline, fewer than ${minSamples}`
  }

  return `${subject}: ${millisecondsText(afterP95Ms)} in the recovered ${window} against the baseline's ${millisecondsText(beforeP95Ms)} plus ${percentOver(p95FactorOverBaseline)} (${millisecondsText(limitMs)}): ${verdictText(verdict)}`
}

/**
 * States one drift comparison: the final hour's P95 against 1.2 times the first hour's.
 *
 * @param {ReturnType<typeof p95Comparison>} comparison - The comparison.
 * @returns {string} The line.
 */
export const driftLine = ({
  scenario,
  kind,
  beforeP95Ms,
  afterP95Ms,
  beforeCount,
  afterCount,
  limitMs,
  verdict
}) => {
  const subject = `Drift P95 ${scenario} ${kind}`
  const { minSamples, p95FactorOverFirstHour } = INTERIM_TARGETS.endurance

  if (verdict === 'not judged') {
    return afterCount < minSamples
      ? `${subject}: not judged, ${afterCount} requests in the final hour, fewer than ${minSamples}`
      : `${subject}: not judged, ${beforeCount} requests in the first hour, fewer than ${minSamples}`
  }

  return `${subject}: ${millisecondsText(afterP95Ms)} in the final hour against ${p95FactorOverFirstHour} times the first hour's ${millisecondsText(beforeP95Ms)} (${millisecondsText(limitMs)}): ${verdictText(verdict)}`
}

/**
 * States whether a relative rule passed.
 *
 * @param {object} options - The rule.
 * @param {string} options.label - `Recovery` or `Drift`.
 * @param {Array<ReturnType<typeof p95Comparison>>} options.comparisons - Every pair's comparison.
 * @returns {string} The line.
 */
export const comparisonOutcomeLine = ({ label, comparisons }) => {
  const over = comparisons.filter(({ verdict }) => verdict === 'over')

  return over.length === 0
    ? `${label}: passed`
    : `${label}: FAILED: ${over.map(({ scenario, kind }) => `${scenario} ${kind}`).join('; ')}`
}

const signInFailureRateIn = (metrics, phase) =>
  valueOf(
    metrics,
    subMetricKey('http_req_failed', { endpoint: 'sign-in', phase }),
    'rate'
  ) ?? 0

/**
 * Works out the Defra ID stub's sign-in failure rate in the spike and the recovery.
 *
 * @param {Record<string, object>} metrics - k6's summary metrics.
 * @returns {{ spike: number, recovery: number }} Rates from 0 to 1; 0 when k6 has no sign-ins.
 */
export const signInFailureRates = (metrics) => ({
  spike: signInFailureRateIn(metrics, 'spike'),
  recovery: signInFailureRateIn(metrics, 'recovery')
})

/**
 * States whether the spike cascaded to the Defra ID stub, by its sign-in failures.
 *
 * @param {Record<string, object>} metrics - k6's summary metrics.
 * @returns {string} The line.
 */
export const signInCascadeLine = (metrics) => {
  const { spike, recovery } = signInFailureRates(metrics)
  const limit = INTERIM_TARGETS.spike.maxSignInFailureRate
  const cascaded = spike >= limit || recovery >= limit

  return `Defra ID stub: sign-in requests failed ${percentText(spike)} in the spike and ${percentText(recovery)} in the recovery against ${percentText(limit)}: ${cascaded ? 'CASCADED' : 'no cascade'}`
}

/**
 * Works out how often each returning user signed in again, against how often they should.
 *
 * @param {object} options - The run.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {object} options.model - A resolved traffic model.
 * @param {number} options.runSeconds - How long the returning users ran.
 * @returns {Array<{ scenario: string, frontend: string, count: number, expected: number }>} One per returning scenario.
 */
export const reauthentications = ({ metrics, model, runSeconds }) =>
  Object.entries(RETURNING_SCENARIOS).map(([scenario, { frontend }]) => ({
    scenario,
    frontend,
    count: countOf(metrics, subMetricKey('reauthentications', { scenario })),
    expected: expectedReauthentications({ model, runSeconds })
  }))

/**
 * States how often each returning user signed in again.
 *
 * @param {object} options - The re-authentications.
 * @param {ReturnType<typeof reauthentications>} options.entries - One per returning scenario.
 * @param {string} options.expiry - What ends a session, from `sessionExpiryText`.
 * @returns {string[]} One line each.
 */
export const reauthenticationLines = ({ entries, expiry }) =>
  entries.map(
    ({ frontend, count, expected }) =>
      `Re-authentication ${frontend}: ${count} times, about ${expected} expected (${expiry})`
  )

/**
 * States the re-authentication traffic, the sign-in hops tagged `auth:re-authentication`.
 *
 * @param {Record<string, object>} metrics - k6's summary metrics.
 * @returns {string} The line.
 */
export const reauthenticationTrafficLine = (metrics) => {
  const tags = RE_AUTHENTICATION_TAG
  const requests = durationOf(metrics, tags, 'count') ?? 0
  const failed = valueOf(metrics, subMetricKey('http_req_failed', tags), 'rate')

  return requests === 0
    ? 'Re-authentication traffic (auth:re-authentication): 0 requests'
    : `Re-authentication traffic (auth:re-authentication): ${requests} requests, P95 ${millisecondsText(durationOf(metrics, tags, 'p(95)'))}, ${percentText(failed ?? 0)} failed`
}

/**
 * Counts the requests that failed below HTTP: refused, reset or timed out.
 *
 * @param {Record<string, object>} metrics - k6's summary metrics.
 * @returns {number} The count; 0 when k6 has none.
 */
export const transportErrorCount = (metrics) =>
  countOf(metrics, 'transport_errors')

/**
 * States the transport errors, k6's only sign of exhaustion.
 *
 * @param {Record<string, object>} metrics - k6's summary metrics.
 * @returns {string} The line.
 */
export const transportErrorLine = (metrics) =>
  `Transport errors (refused, reset or timed out): ${transportErrorCount(metrics)}`

const burstTargets = () => ({
  animals: DESIGN_TARGETS['live-animals'].burstRps,
  plants: DESIGN_TARGETS['high-risk-plants'].burstRps,
  ins: DESIGN_TARGETS.frontDoor.burstRps
})

const burstSeconds = (schedule) => phaseSeconds(schedule, 'burst')

/**
 * Scales a volumetrics target to one hour of the average weekday.
 *
 * @param {object} target - A journey's or the front door's volumetrics figures.
 * @param {number} factor - The hour's share of the sustained peak run's rate.
 * @returns {object} The same figures, each number times the factor, without the burst rate. The source is kept.
 */
export const hourTarget = (target, factor) =>
  Object.fromEntries(
    Object.entries(target)
      .filter(([key]) => key !== 'burstRps')
      .map(([key, value]) => [
        key,
        typeof value === 'number' ? value * factor : value
      ])
  )

/**
 * Works out each hour of the average weekday: what the run achieved against
 * that hour's target, per journey and for the front door.
 *
 * @param {object} options - The run.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {ReadonlyArray<object>} options.schedule - The run's phase schedule.
 * @param {object} options.model - A resolved traffic model.
 * @param {Record<string, { endpoints: string[] }>} options.scenarioSet - Scenarios shaped like `SCENARIOS`.
 * @returns {Array<{ hour: number, phase: string, label: string, segment: string, share: number, factor: number, seconds: number, journeys: Record<string, { achieved: object, target: object }>, frontDoor: { achieved: object, target: object } }>} One row per hour, hour 00 first.
 */
export const averageLoadHours = ({ metrics, schedule, model, scenarioSet }) => {
  const factors = averageLoadFactors(model)

  return HOUR_PHASES.map((phase, hour) => {
    const seconds = phaseSeconds(schedule, phase)
    const factor = factors[hour]

    return {
      hour,
      phase,
      label: hourLabel(hour),
      segment: segmentOf(hour),
      share: model.averageLoad.hourlyShares[hour],
      factor,
      seconds,
      journeys: Object.fromEntries(
        journeyScenariosIn(scenarioSet).map((scenario) => [
          scenario,
          {
            achieved: achievedJourney({ metrics, scenario, phase, seconds }),
            target: hourTarget(DESIGN_TARGETS[scenario], factor)
          }
        ])
      ),
      frontDoor: {
        achieved: achievedFrontDoor({ metrics, phase, seconds }),
        target: hourTarget(DESIGN_TARGETS.frontDoor, factor)
      }
    }
  })
}

const hourJourneyText = (scenario, { achieved, target }) =>
  `${scenario} ${labelledAgainst('notifications an hour', achieved.notificationsPerHour, target.notificationsPerHour, figureText)}, frontend ${labelledAgainst('RPS', achieved.frontendRps, target.frontendRps, rpsText)}, ${labelledAgainst('concurrent users', achieved.concurrentUsers, target.concurrentUsers, figureText)}`

/**
 * States one hour of the average weekday: each journey's and the front door's
 * achieved figures against that hour's targets.
 *
 * @param {object} options - The hour.
 * @param {ReturnType<typeof averageLoadHours>[number]} options.row - The hour's row.
 * @returns {string} The line.
 */
export const hourLine = ({ row }) => {
  const { achieved, target } = row.frontDoor
  const frontDoorText = `front door ${labelledAgainst('sign-ins an hour', achieved.signInsPerHour, target.signInsPerHour, figureText)}, core pages ${labelledAgainst('RPS', achieved.coreRps, target.coreRps, rpsText)}, ${labelledAgainst('concurrent users', achieved.concurrentUsers, target.concurrentUsers, figureText)}`

  return `Hour ${row.label} (${row.segment}, ${percentText(row.share)} of a weekday, ${durationText(row.seconds)}): ${[
    ...Object.entries(row.journeys).map(([scenario, figures]) =>
      hourJourneyText(scenario, figures)
    ),
    frontDoorText
  ].join('; ')}`
}

const runDescription = ({
  shape,
  scenarioLength,
  environment,
  stubProfile,
  model
}) => ({
  line: runLine({
    shape,
    scenarioLength,
    environment,
    stubProfile,
    model
  }),
  shape,
  scenarioLength,
  environment,
  stubProfile: stubProfile ?? 'as-reported'
})

const averageLoadReport = (options) => {
  const { metrics, schedule, scenarioSet, model } = options

  return {
    run: {
      ...runDescription(options),
      profileLine: averageLoadProfileLine(model),
      hourSeconds: durationSeconds(model.averageLoad.hourDuration),
      schedule
    },
    hours: averageLoadHours({
      metrics,
      schedule,
      model,
      scenarioSet
    }),
    relative: [],
    endpoints: endpointRows({ metrics, scenarioSet }),
    thresholds: thresholdResults(metrics),
    relativeFailed: false
  }
}

const achievedOver = ({ metrics, phase, seconds, scenarioSet }) => ({
  journeys: Object.fromEntries(
    journeyScenariosIn(scenarioSet).map((scenario) => [
      scenario,
      {
        achieved: achievedJourney({ metrics, scenario, phase, seconds }),
        target: DESIGN_TARGETS[scenario]
      }
    ])
  ),
  frontDoor: {
    achieved: achievedFrontDoor({ metrics, phase, seconds }),
    target: DESIGN_TARGETS.frontDoor
  }
})

const eventingReport = ({ metrics, shape, schedule }) => {
  const { phase, startSeconds, endSeconds } = eventingWindow({
    shape,
    schedule
  })

  return {
    phase,
    windowSeconds: endSeconds - startSeconds,
    watchSeconds: eventingWatchSeconds({ schedule }) - endSeconds,
    ...eventingWatchSummary(metrics, phase)
  }
}

const peakReport = (options) => {
  const { metrics, shape, schedule, scenarioSet, model } = options
  const [steady] = REPORTED_PHASES[shape]
  const seconds = phaseSeconds(schedule, steady)
  const run = runDescription(options)
  const isBurst = shape === SHAPES.P99_BURST
  const verdicts = isBurst
    ? relativeBurstVerdicts({ metrics, scenarioSet })
    : []

  return {
    run: {
      ...run,
      steadyPhase: steady,
      steadySeconds: seconds,
      schedule
    },
    achieved: achievedOver({
      metrics,
      phase: steady,
      seconds,
      scenarioSet
    }),
    ...(isBurst
      ? {
          burst: {
            duration: model.p99Burst.burstDuration,
            factor: model.p99Burst.burstFactor,
            achieved: achievedBurst({
              metrics,
              seconds: burstSeconds(schedule)
            }),
            targets: burstTargets()
          },
          eventing: eventingReport({ metrics, shape, schedule })
        }
      : {}),
    relative: verdicts,
    endpoints: endpointRows({ metrics, scenarioSet, phase: steady }),
    thresholds: thresholdResults(metrics),
    relativeFailed: verdicts.some(({ verdict }) => verdict === 'over')
  }
}

const anyOver = (comparisons) =>
  comparisons.some(({ verdict }) => verdict === 'over')

const spikeReport = (options) => {
  const { metrics, shape, schedule, scenarioSet, model } = options
  const [baseline] = REPORTED_PHASES[shape]
  const run = runDescription(options)
  const { recoveredDuration, spikeDuration } = model.spikeRecovery
  const { spike: spikeLimits } = INTERIM_TARGETS
  const comparisons = p95Comparisons({
    metrics,
    scenarioSet,
    before: baseline,
    after: 'recovered',
    factor: spikeLimits.p95FactorOverBaseline,
    minSamples: spikeLimits.minSamples
  }).map((comparison) => ({ ...comparison, window: recoveredDuration }))

  return {
    run: {
      ...run,
      profileLine: spikeProfileLine({ model, scenarioSet }),
      steadyPhase: baseline,
      steadySeconds: phaseSeconds(schedule, baseline),
      schedule
    },
    achieved: achievedOver({
      metrics,
      phase: baseline,
      seconds: phaseSeconds(schedule, baseline),
      scenarioSet
    }),
    spike: {
      duration: spikeDuration,
      seconds: phaseSeconds(schedule, 'spike'),
      achieved: achievedSpike({
        metrics,
        seconds: phaseSeconds(schedule, 'spike')
      }),
      capacities: spikeCapacities({ model })
    },
    relative: comparisons,
    cascade: { signInFailureRates: signInFailureRates(metrics) },
    eventing: eventingReport({ metrics, shape, schedule }),
    endpoints: endpointRows({ metrics, scenarioSet, phase: baseline }),
    thresholds: thresholdResults(metrics),
    relativeFailed: anyOver(comparisons)
  }
}

const enduranceReport = (options) => {
  const { metrics, shape, schedule, scenarioSet, model } = options
  const run = runDescription(options)
  const runSeconds = enduranceRunSeconds(schedule)
  const { endurance: enduranceLimits } = INTERIM_TARGETS
  const [first, last] = REPORTED_PHASES[shape]
  const comparisons = p95Comparisons({
    metrics,
    scenarioSet,
    before: first,
    after: last,
    factor: enduranceLimits.p95FactorOverFirstHour,
    minSamples: enduranceLimits.minSamples
  })

  return {
    run: {
      ...run,
      profileLine: enduranceProfileLine({ model, runSeconds }),
      expiry: sessionExpiryText(model.endurance),
      runSeconds,
      schedule
    },
    windows: REPORTED_PHASES[shape].map((phase) => {
      const seconds = phaseSeconds(schedule, phase)

      return {
        phase,
        seconds,
        ...achievedOver({ metrics, phase, seconds, scenarioSet })
      }
    }),
    relative: comparisons,
    reauthentication: reauthentications({ metrics, model, runSeconds }),
    transportErrors: transportErrorCount(metrics),
    endpoints: endpointRows({ metrics, scenarioSet }),
    thresholds: thresholdResults(metrics),
    relativeFailed: anyOver(comparisons)
  }
}

const SHARED_PHASES = Object.freeze(['combined', 'burst', 'session-spike'])

const sharedRow = ({ metrics, schedule, model, phase }) => {
  const seconds = phaseSeconds(schedule, phase)
  const { sessionPath, readModel } = DESIGN_TARGETS.sharedComponents
  const rows = {
    combined: {
      duration: model.combined.combinedDuration,
      sessionPathTarget: sessionPath.sustainedRps,
      readModelTarget: readModel.sustainedRps
    },
    burst: {
      duration: model.p99Burst.burstDuration,
      sessionPathTarget: sessionPath.burstRps,
      readModelTarget: readModel.burstRps
    },
    'session-spike': {
      duration: model.spikeRecovery.spikeDuration,
      sessionPathTarget: model.combined.sessionPathSpikeRps,
      readModelTarget: undefined
    }
  }
  const frontendPages = FRONTENDS.reduce(
    (total, frontend) => total + pagesOver(metrics, { frontend, phase }),
    0
  )

  return {
    phase,
    seconds,
    ...rows[phase],
    sessionPathRps: frontendPages / seconds,
    readModelRps:
      countOf(metrics, subMetricKey('read_model_reads', { phase })) / seconds
  }
}

/**
 * Works out the load the shared components carried in the combined run's
 * sustained, burst and session-spike phases.
 *
 * The session path is the frontends' own session stores, one resolution a page
 * request, so its rate is the three frontends' page requests a second. The
 * read model's rate is the INS dashboard views a second, each one a read.
 *
 * @param {object} options - The run.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {ReadonlyArray<object>} options.schedule - The run's phase schedule.
 * @param {object} options.model - A resolved traffic model.
 * @returns {Record<string, { phase: string, seconds: number, duration: string, sessionPathRps: number, readModelRps: number, sessionPathTarget: number, readModelTarget: number | undefined }>} A row for each of `combined`, `burst` and `session-spike`. Rates are zero, never NaN, where there are no samples.
 */
export const achievedSharedComponents = ({ metrics, schedule, model }) =>
  Object.fromEntries(
    SHARED_PHASES.map((phase) => [
      phase,
      sharedRow({ metrics, schedule, model, phase })
    ])
  )

/**
 * States the session path's achieved load against its three figures.
 *
 * @param {object} options - The figures.
 * @param {ReturnType<typeof achievedSharedComponents>} options.shared - The shared components' rows.
 * @returns {string} The line.
 */
export const sessionPathLine = ({ shared }) => {
  const { combined, burst } = shared
  const spike = shared['session-spike']

  return `Session path (each frontend's own session store, one resolution a page request): ${rpsText(combined.sessionPathRps)} RPS over the combined (${combined.duration}) against ${rpsText(combined.sessionPathTarget)} sustained (NFR-DEP-05); ${rpsText(burst.sessionPathRps)} RPS in the burst (${burst.duration}) against ${rpsText(burst.sessionPathTarget)} (NFR-VOL-CORE-06); ${rpsText(spike.sessionPathRps)} RPS in the session spike (${spike.duration}) against ${rpsText(spike.sessionPathTarget)} (§9.4); no backend resolves a session today (c-008), so the frontends carry §9.4's backend share`
}

/**
 * States the dashboard read model's achieved reads against its two figures.
 *
 * @param {object} options - The figures.
 * @param {ReturnType<typeof achievedSharedComponents>} options.shared - The shared components' rows.
 * @returns {string} The line.
 */
export const readModelReadsLine = ({ shared }) => {
  const { combined, burst } = shared

  return `Dashboard read model (one read an INS dashboard view): ${rpsText(combined.readModelRps)} reads a second over the combined (${combined.duration}) against ${rpsText(combined.readModelTarget)} (§9.4 SYN-21); ${rpsText(burst.readModelRps)} in the burst (${burst.duration}) against ${rpsText(burst.readModelTarget)}`
}

/**
 * States how long the read model's consumer took to take in live animals' events.
 *
 * @param {Record<string, object>} metrics - k6's summary metrics.
 * @returns {string} The line.
 */
export const arrivalLagLine = (metrics) => {
  const key = subMetricKey('event_arrival_seconds', {
    scenario: 'live-animals'
  })

  if (countOf(metrics, key) === 0) {
    return 'Read model consumer: no live-animals arrival was measured'
  }

  return `Read model consumer: live-animals events arrived P95 ${figureText(valueOf(metrics, key, 'p(95)'))}s, max ${figureText(valueOf(metrics, key, 'max'))}s after the outbox read (event_arrival_seconds)`
}

const failedRateOf = (metrics, tags) =>
  valueOf(metrics, subMetricKey('http_req_failed', tags), 'rate')

/**
 * Compares each journey's response times and failures run alone with run
 * combined, for each request kind it makes.
 *
 * @param {object} options - The run.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {Record<string, { endpoints: string[] }>} options.scenarioSet - Scenarios shaped like `SCENARIOS`.
 * @returns {Array<{ scenario: string, kind: string, aloneP95Ms: number | undefined, combinedP95Ms: number | undefined, aloneCount: number, combinedCount: number, aloneFailedRate: number | undefined, combinedFailedRate: number | undefined, changeShare: number | null }>} One per journey and kind. `changeShare` is the combined P95 over the alone P95, less 1; null when either is missing.
 */
export const aloneCombinedComparisons = ({ metrics, scenarioSet }) =>
  journeyScenariosIn(scenarioSet).flatMap((scenario) =>
    kindsIn(scenarioSet[scenario].endpoints).map((kind) => {
      const alone = { scenario, kind, phase: ALONE_PHASES[scenario] }
      const combined = { scenario, kind, phase: 'combined' }
      const aloneCount = durationOf(metrics, alone, 'count') ?? 0
      const combinedCount = durationOf(metrics, combined, 'count') ?? 0
      const aloneP95Ms =
        aloneCount === 0 ? undefined : durationOf(metrics, alone, 'p(95)')
      const combinedP95Ms =
        combinedCount === 0 ? undefined : durationOf(metrics, combined, 'p(95)')

      return {
        scenario,
        kind,
        aloneP95Ms,
        combinedP95Ms,
        aloneCount,
        combinedCount,
        aloneFailedRate: failedRateOf(metrics, {
          scenario,
          phase: alone.phase
        }),
        combinedFailedRate: failedRateOf(metrics, {
          scenario,
          phase: combined.phase
        }),
        changeShare:
          aloneP95Ms === undefined || combinedP95Ms === undefined
            ? null
            : combinedP95Ms / aloneP95Ms - 1
      }
    })
  )

const NOT_MEASURED = 'not measured'

const measuredText = (value, format) =>
  value === undefined ? NOT_MEASURED : format(value)

const signedPercentText = (share) =>
  `${share < 0 ? '-' : '+'}${Math.abs(Math.round(share * PERCENT))}%`

/**
 * States one journey and request kind's figures run alone and combined.
 *
 * @param {ReturnType<typeof aloneCombinedComparisons>[number]} comparison - The comparison.
 * @returns {string} The line.
 */
export const aloneCombinedLine = ({
  scenario,
  kind,
  aloneP95Ms,
  combinedP95Ms,
  aloneCount,
  combinedCount,
  aloneFailedRate,
  combinedFailedRate,
  changeShare
}) =>
  `Alone and combined ${scenario} ${kind}: P95 ${measuredText(aloneP95Ms, millisecondsText)} alone (${aloneCount} requests), ${measuredText(combinedP95Ms, millisecondsText)} combined (${combinedCount} requests), ${changeShare === null ? NOT_MEASURED : signedPercentText(changeShare)}; failed ${measuredText(aloneFailedRate, percentText)} alone, ${measuredText(combinedFailedRate, percentText)} combined`

const holdsOrUnmeasured = (value, limit) =>
  value === undefined || limitHolds(value, limit)

/**
 * Judges each journey, for each request kind, while the other journey spikes
 * and the minute after.
 *
 * @param {object} options - The run.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {Record<string, { endpoints: string[] }>} options.scenarioSet - Scenarios shaped like `SCENARIOS`.
 * @returns {Array<{ spiking: string, other: string, phase: string, kind: string, count: number, measured: boolean, p95Ms: number | undefined, p99Ms: number | undefined, p95LimitMs: number | undefined, p99LimitMs: number | undefined, failedRate: number, within: boolean }>} One per pair, phase and kind; a row with no requests is not measured and not within.
 */
export const isolationRows = ({ metrics, scenarioSet }) =>
  ISOLATION_PAIRS.flatMap(({ spiking, other, phases }) =>
    phases.flatMap((phase) =>
      kindsIn(scenarioSet[other].endpoints).map((kind) => {
        const tags = { scenario: other, kind, phase }
        const { p95Ms: p95LimitMs, p99Ms: p99LimitMs } = INTERIM_TARGETS[kind]
        const p95Ms = durationOf(metrics, tags, 'p(95)')
        const p99Ms = durationOf(metrics, tags, 'p(99)')
        const failedRate =
          failedRateOf(metrics, { scenario: other, phase }) ?? 0
        const count = durationOf(metrics, tags, 'count') ?? 0

        return {
          spiking,
          other,
          phase,
          kind,
          count,
          measured: count > 0,
          p95Ms,
          p99Ms,
          p95LimitMs,
          p99LimitMs,
          failedRate,
          within:
            count > 0 &&
            holdsOrUnmeasured(p95Ms, p95LimitMs) &&
            holdsOrUnmeasured(p99Ms, p99LimitMs) &&
            failedRate < INTERIM_TARGETS.maxFailureRate
        }
      })
    )
  )

const againstLimitText = (value, limit) =>
  limit === undefined
    ? millisecondsText(value)
    : `${millisecondsText(value)} against ${millisecondsText(limit)}`

/**
 * States how one journey and request kind fared while the other journey spiked.
 *
 * @param {ReturnType<typeof isolationRows>[number]} row - The row.
 * @returns {string} The line.
 */
export const isolationLine = ({
  spiking,
  other,
  phase,
  kind,
  count,
  p95Ms,
  p99Ms,
  p95LimitMs,
  p99LimitMs,
  failedRate,
  within
}) => {
  const subject = `Isolation ${other} ${kind} during the ${spiking} spike (${phase})`

  if (count === 0) {
    return `${subject}: no requests`
  }

  return `${subject}: ${count} requests, P95 ${againstLimitText(p95Ms, p95LimitMs)}, P99 ${againstLimitText(p99Ms, p99LimitMs)}, failed ${percentText(failedRate)} against ${percentText(INTERIM_TARGETS.maxFailureRate)}: ${within ? 'within' : 'OVER'}`
}

const cacheFigures = (metrics, endpoint, cache) => {
  const key = subMetricKey('reference_data_duration', { endpoint, cache })

  return {
    count: countOf(metrics, key),
    p95Ms: valueOf(metrics, key, 'p(95)'),
    maxMs: valueOf(metrics, key, 'max')
  }
}

const FIRST_READ_CLASSES = Object.freeze({ 0: 'warm', 1: 'cold' })

/**
 * Collects reference-data's cold and warm response times, per endpoint read.
 *
 * @param {Record<string, object>} metrics - k6's summary metrics.
 * @returns {Array<{ endpoint: string, path: string, readBy: string, forcedMiss: boolean, cold: { count: number, p95Ms: number | undefined, maxMs: number | undefined }, warm: { count: number, p95Ms: number | undefined, maxMs: number | undefined }, unclassified: { count: number }, failed: number, firstRead: 'cold' | 'warm' | 'not measured' }>} One row per read.
 */
export const referenceDataRows = (metrics) =>
  REFERENCE_DATA_READS.map(({ endpoint, path, readBy, forcedMiss }) => ({
    endpoint,
    path,
    readBy,
    forcedMiss,
    cold: cacheFigures(metrics, endpoint, 'cold'),
    warm: cacheFigures(metrics, endpoint, 'warm'),
    unclassified: {
      count: cacheFigures(metrics, endpoint, 'unclassified').count
    },
    failed: countOf(
      metrics,
      subMetricKey('reference_data_failed_reads', { endpoint })
    ),
    firstRead:
      FIRST_READ_CLASSES[
        valueOf(
          metrics,
          subMetricKey('reference_data_first_read', { endpoint }),
          'value'
        )
      ] ?? NOT_MEASURED
  }))

const readsText = (label, { count, p95Ms, maxMs }, note = '') =>
  count === 0
    ? `${label} 0 reads${note}`
    : `${label} ${count} ${count === 1 ? 'read' : 'reads'}${note}, P95 ${millisecondsText(p95Ms)}, max ${millisecondsText(maxMs)}`

/**
 * States reference-data's cold and warm response times for one read.
 *
 * @param {ReturnType<typeof referenceDataRows>[number]} row - The row.
 * @returns {string} The line.
 */
export const referenceDataLine = ({
  endpoint,
  path,
  forcedMiss,
  cold,
  warm,
  unclassified,
  failed,
  firstRead
}) =>
  `Reference data ${endpoint} (${path}): ${readsText('cold', cold, ' (MDM called)')}; ${readsText('warm', warm)}${unclassified.count > 0 ? `; ${unclassified.count} unclassified (the stub did not report its MDM count)` : ''}${failed > 0 ? `; ${failed} failed reads (not timed)` : ''}${forcedMiss ? '; a forced miss, cold on every read' : `; first read in the run ${firstRead}`}`

/**
 * States how long reference-data keeps MDM answers, and what that means for the watch.
 *
 * @param {object} options - The watch.
 * @param {object} options.model - A resolved traffic model.
 * @param {number} options.watchSeconds - How long the watch ran.
 * @returns {string} The line.
 */
export const referenceDataCacheLine = ({ model, watchSeconds }) =>
  `Reference data cache: reference-data keeps MDM answers ${model.combined.referenceDataCacheMinutes} minutes (cache.mdm.ttl-minutes), so a ${durationText(Math.floor(watchSeconds / SECONDS_PER_MINUTE) * SECONDS_PER_MINUTE)} watch should see about ${expectedExpiries({ watchSeconds, cacheMinutes: model.combined.referenceDataCacheMinutes })} cold reads for each key it reads, and one more for each key not yet cached when the run started`

/**
 * States how many notifications the dashboard read model held at the start of
 * a combined run, and why that is one journey's.
 *
 * @param {object} options - The reading.
 * @param {Record<string, number>} options.volume - The count in each datastore.
 * @returns {string} The line.
 */
export const readModelLine = ({ volume }) =>
  `Read model at start: ${volume['dashboard-read-model']} notifications; it holds live animals' only, because high-risk plants publishes no events today (pbe-022); the journeys' backends hold ${volume['live-animals']} live-animals and ${volume['high-risk-plants']} high-risk-plants notifications`

const combinedReport = (options) => {
  const { metrics, shape, schedule, scenarioSet, model } = options
  const [steady] = REPORTED_PHASES[shape]
  const steadySeconds = phaseSeconds(schedule, steady)
  const watchSeconds = schedule.find(
    ({ phase }) => phase === 'plants-alone'
  ).endSeconds

  return {
    run: {
      ...runDescription(options),
      profileLine: combinedProfileLine({ model, scenarioSet }),
      steadyPhase: steady,
      steadySeconds,
      schedule
    },
    achieved: achievedOver({
      metrics,
      phase: steady,
      seconds: steadySeconds,
      scenarioSet
    }),
    alone: Object.fromEntries(
      journeyScenariosIn(scenarioSet).map((scenario) => {
        const phase = ALONE_PHASES[scenario]
        const seconds = phaseSeconds(schedule, phase)

        return [
          scenario,
          {
            phase,
            seconds,
            achieved: achievedJourney({ metrics, scenario, phase, seconds }),
            target: DESIGN_TARGETS[scenario]
          }
        ]
      })
    ),
    shared: achievedSharedComponents({ metrics, schedule, model }),
    comparisons: aloneCombinedComparisons({ metrics, scenarioSet }),
    isolation: isolationRows({ metrics, scenarioSet }),
    referenceData: {
      rows: referenceDataRows(metrics),
      watchSeconds,
      cacheMinutes: model.combined.referenceDataCacheMinutes
    },
    eventCounts: eventCountRows(metrics),
    relative: [],
    endpoints: endpointRows({ metrics, scenarioSet, phase: steady }),
    thresholds: thresholdResults(metrics),
    relativeFailed: false
  }
}

const REPORTS = {
  [SHAPES.AVERAGE_LOAD]: averageLoadReport,
  [SHAPES.SPIKE_RECOVERY]: spikeReport,
  [SHAPES.ENDURANCE]: enduranceReport,
  [SHAPES.COMBINED]: combinedReport
}

/**
 * Builds the JSON-ready report of a design-target run: the settings, what it
 * achieved against the volumetrics figures, the burst verdicts and every
 * endpoint's response times, tagged by journey, scenario and kind. The
 * average-load run reports each hour of its weekday against that hour's target
 * instead. The combined run reports the shared components, the alone-and-combined
 * comparison, isolation while the other journey spikes, and reference data's cold
 * and warm response times.
 *
 * @param {object} options - The run.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {string} options.shape - A value of `SHAPES`.
 * @param {string} options.scenarioLength - A value of `SCENARIO_LENGTHS`.
 * @param {string} options.environment - The environment the run was in.
 * @param {string | undefined} options.stubProfile - The stub profile the run required, if any.
 * @param {ReadonlyArray<object>} options.schedule - The run's phase schedule.
 * @param {Record<string, { endpoints: string[] }>} options.scenarioSet - Scenarios shaped like `SCENARIOS`.
 * @param {object} options.model - A resolved traffic model.
 * @returns {object} The report.
 */
export const designTargetReport = (options) =>
  (REPORTS[options.shape] ?? peakReport)(options)

const journeyLinesOver = ({ achieved, phase, seconds }) =>
  Object.entries(achieved.journeys).map(([scenario, figures]) =>
    achievedJourneyLine({ scenario, phase, seconds, ...figures })
  )

const journeyLines = ({ achieved, run }) =>
  journeyLinesOver({
    achieved,
    phase: run.steadyPhase,
    seconds: run.steadySeconds
  })

const frontDoorLineOver = ({ achieved, phase, seconds }) =>
  achievedFrontDoorLine({
    phase,
    seconds,
    ...achieved.frontDoor
  })

const burstLines = ({ burst, relative }) =>
  burst === undefined
    ? []
    : [
        achievedBurstLine({
          burstDuration: burst.duration,
          burstFactor: burst.factor,
          achieved: burst.achieved,
          targets: burst.targets
        }),
        ...relative.map(relativeLine),
        relativeOutcomeLine({ verdicts: relative })
      ]

const eventingLines = ({ eventing }) =>
  eventing === undefined
    ? []
    : [
        smoothingLine({
          phase: eventing.phase,
          windowSeconds: eventing.windowSeconds,
          eventing
        }),
        drainLine({
          phase: eventing.phase,
          watchSeconds: eventing.watchSeconds,
          eventing
        })
      ]

const averageLoadText = (report, metrics) =>
  `${[
    report.run.line,
    report.run.profileLine,
    ...report.hours.map((row) => hourLine({ row })),
    ...report.endpoints.map(endpointLine),
    ...thresholdLines(metrics)
  ].join('\n')}\n`

const peakText = (report, metrics) =>
  `${[
    report.run.line,
    ...journeyLines(report),
    achievedFrontDoorLine({
      phase: report.run.steadyPhase,
      seconds: report.run.steadySeconds,
      ...report.achieved.frontDoor
    }),
    requestMixLine({
      phase: report.run.steadyPhase,
      share: report.achieved.frontDoor.achieved.dashboardReadShare
    }),
    ...burstLines(report),
    ...eventingLines(report),
    ...report.endpoints.map(endpointLine),
    ...thresholdLines(metrics)
  ].join('\n')}\n`

const spikeText = (report, metrics) =>
  `${[
    report.run.line,
    report.run.profileLine,
    ...journeyLines(report),
    achievedFrontDoorLine({
      phase: report.run.steadyPhase,
      seconds: report.run.steadySeconds,
      ...report.achieved.frontDoor
    }),
    requestMixLine({
      phase: report.run.steadyPhase,
      share: report.achieved.frontDoor.achieved.dashboardReadShare
    }),
    spikeLine({
      duration: report.spike.duration,
      achieved: report.spike.achieved,
      capacities: report.spike.capacities
    }),
    ...report.relative.map(recoveryLine),
    comparisonOutcomeLine({
      label: 'Recovery',
      comparisons: report.relative
    }),
    signInCascadeLine(metrics),
    ...eventingLines(report),
    ...report.endpoints.map(endpointLine),
    ...thresholdLines(metrics)
  ].join('\n')}\n`

const enduranceText = (report, metrics) =>
  `${[
    report.run.line,
    report.run.profileLine,
    ...report.windows.flatMap((window) => [
      ...journeyLinesOver({
        achieved: window,
        phase: window.phase,
        seconds: window.seconds
      }),
      frontDoorLineOver({
        achieved: window,
        phase: window.phase,
        seconds: window.seconds
      })
    ]),
    ...report.relative.map(driftLine),
    comparisonOutcomeLine({
      label: 'Drift',
      comparisons: report.relative
    }),
    ...reauthenticationLines({
      entries: report.reauthentication,
      expiry: report.run.expiry
    }),
    reauthenticationTrafficLine(metrics),
    transportErrorLine(metrics),
    ...report.endpoints.map(endpointLine),
    ...thresholdLines(metrics)
  ].join('\n')}\n`

const combinedText = (report, metrics) =>
  `${[
    report.run.line,
    report.run.profileLine,
    ...journeyLines(report),
    achievedFrontDoorLine({
      phase: report.run.steadyPhase,
      seconds: report.run.steadySeconds,
      ...report.achieved.frontDoor
    }),
    requestMixLine({
      phase: report.run.steadyPhase,
      share: report.achieved.frontDoor.achieved.dashboardReadShare
    }),
    ...Object.entries(report.alone).map(([scenario, figures]) =>
      achievedJourneyLine({ scenario, ...figures })
    ),
    sessionPathLine({ shared: report.shared }),
    readModelReadsLine({ shared: report.shared }),
    ...eventCountLines({
      rows: report.eventCounts,
      environment: report.run.environment
    }),
    arrivalLagLine(metrics),
    ...report.referenceData.rows.map(referenceDataLine),
    referenceDataCacheLine({
      model: {
        combined: {
          referenceDataCacheMinutes: report.referenceData.cacheMinutes
        }
      },
      watchSeconds: report.referenceData.watchSeconds
    }),
    ...report.comparisons.map(aloneCombinedLine),
    ...report.isolation.map(isolationLine),
    ...report.endpoints.map(endpointLine),
    ...thresholdLines(metrics)
  ].join('\n')}\n`

const TEXTS = {
  [SHAPES.AVERAGE_LOAD]: averageLoadText,
  [SHAPES.SPIKE_RECOVERY]: spikeText,
  [SHAPES.ENDURANCE]: enduranceText,
  [SHAPES.COMBINED]: combinedText
}

/**
 * Writes a design-target run's end-of-test text.
 *
 * @param {ReturnType<typeof designTargetReport>} report - The run's report.
 * @param {Record<string, object>} metrics - k6's summary metrics, for the threshold lines.
 * @returns {string} Lines joined with newlines, ending in one.
 */
export const designTargetText = (report, metrics) =>
  (TEXTS[report.run.shape] ?? peakText)(report, metrics)

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

/**
 * Escapes a value for HTML text.
 *
 * @param {unknown} value - Any value.
 * @returns {string} The value as text with `&`, `<`, `>` and quotes escaped.
 */
export const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character])

/**
 * Writes a heading and a table of rows as HTML, every cell escaped.
 *
 * @param {string} heading - The table's heading.
 * @param {string[]} columns - The column names.
 * @param {Array<Array<unknown>>} rows - The rows of cells.
 * @returns {string} The HTML.
 */
export const table = (heading, columns, rows) =>
  `<h2>${escapeHtml(heading)}</h2>\n<table style="border-collapse:collapse">\n<tr>${columns
    .map(
      (column) =>
        `<th style="border:1px solid #888;padding:4px 8px;text-align:left">${escapeHtml(column)}</th>`
    )
    .join('')}</tr>\n${rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell) =>
              `<td style="border:1px solid #888;padding:4px 8px">${escapeHtml(cell)}</td>`
          )
          .join('')}</tr>`
    )
    .join('\n')}\n</table>`

const achievedRows = ({ achieved }) => [
  ...Object.entries(achieved.journeys).map(([scenario, figures]) => [
    scenario,
    figureText(figures.achieved.notificationsPerHour),
    String(figures.target.notificationsPerHour),
    rpsText(figures.achieved.frontendRps),
    String(figures.target.frontendRps),
    figureText(figures.achieved.concurrentUsers),
    String(figures.target.concurrentUsers)
  ]),
  [
    'front door',
    figureText(achieved.frontDoor.achieved.signInsPerHour),
    String(achieved.frontDoor.target.signInsPerHour),
    rpsText(achieved.frontDoor.achieved.coreRps),
    String(achieved.frontDoor.target.coreRps),
    figureText(achieved.frontDoor.achieved.concurrentUsers),
    String(achieved.frontDoor.target.concurrentUsers)
  ]
]

const burstTable = (report) =>
  table(
    'Burst',
    ['Frontend', 'RPS', 'Target'],
    report.burst === undefined
      ? []
      : Object.keys(report.burst.achieved).map((frontend) => [
          frontend,
          rpsText(report.burst.achieved[frontend]),
          String(report.burst.targets[frontend])
        ])
  )

const relativeTable = (report) =>
  table(
    'Relative P95 in the burst minute',
    ['Scenario', 'Kind', 'Peak P95 ms', 'Burst P95 ms', 'Requests', 'Verdict'],
    report.relative.map((entry) => [
      entry.scenario,
      entry.kind,
      entry.peakP95Ms === undefined ? '' : Math.round(entry.peakP95Ms),
      entry.burstP95Ms === undefined ? '' : Math.round(entry.burstP95Ms),
      entry.burstCount,
      entry.verdict
    ])
  )

const achievedHeading = (phase) => `Achieved over the ${phase}`

const ACHIEVED_COLUMNS = [
  'Scenario',
  'Starts or sign-ins an hour',
  'Target',
  'Frontend RPS',
  'Target',
  'Concurrent users',
  'Target'
]

const drainCell = ({ drainSeconds, watchSeconds }) =>
  drainSeconds === null ? `did not drain within ${watchSeconds}s` : drainSeconds

const eventingTable = ({ eventing }) =>
  table(
    'Eventing',
    ['Measure', 'Value'],
    [
      [
        `Notifications submitted in the ${eventing.phase}`,
        eventing.submittedInWindow
      ],
      [`Backlog depth before the ${eventing.phase}`, eventing.preBurstDepth],
      ['Peak backlog depth', eventing.peakDepth],
      ['Peak events forwarded in one second', eventing.peakPerSecond],
      ['Drain time in seconds', drainCell(eventing)]
    ]
  )

const peakTables = (report) => [
  table(
    achievedHeading(report.run.steadyPhase),
    ACHIEVED_COLUMNS,
    achievedRows(report)
  ),
  burstTable(report),
  relativeTable(report),
  ...(report.eventing === undefined ? [] : [eventingTable(report)])
]

const hourRow = (row) => [
  row.label,
  row.segment,
  percentText(row.share),
  ...Object.values(row.journeys).flatMap(({ achieved, target }) => [
    figureText(achieved.notificationsPerHour),
    figureText(target.notificationsPerHour),
    rpsText(achieved.frontendRps),
    rpsText(target.frontendRps)
  ]),
  figureText(row.frontDoor.achieved.signInsPerHour),
  figureText(row.frontDoor.target.signInsPerHour),
  rpsText(row.frontDoor.achieved.coreRps),
  rpsText(row.frontDoor.target.coreRps)
]

const hourColumns = (report) => [
  'Hour',
  'Row',
  'Share',
  ...Object.keys(report.hours[0].journeys).flatMap((scenario) => [
    `${scenario} started an hour`,
    'Target',
    `${scenario} frontend RPS`,
    'Target'
  ]),
  'Front door sign-ins an hour',
  'Target',
  'INS core RPS',
  'Target'
]

const averageLoadTables = (report) => [
  `<p>${escapeHtml(report.run.profileLine)}</p>`,
  table(
    'Each hour of the weekday',
    hourColumns(report),
    report.hours.map(hourRow)
  )
]

const comparisonTable = ({ heading, beforeLabel, afterLabel, comparisons }) =>
  table(
    heading,
    [
      'Scenario',
      'Kind',
      `${beforeLabel} P95 ms`,
      `${afterLabel} P95 ms`,
      'Requests',
      'Verdict'
    ],
    comparisons.map((entry) => [
      entry.scenario,
      entry.kind,
      entry.beforeP95Ms === undefined ? '' : Math.round(entry.beforeP95Ms),
      entry.afterP95Ms === undefined ? '' : Math.round(entry.afterP95Ms),
      entry.afterCount,
      entry.verdict
    ])
  )

const spikeRows = ({ achieved, capacities }) => {
  const { backendCallsPerPage } = DESIGN_TARGETS

  return [
    ['animals frontend', achieved.animals, capacities.animals],
    [
      'animals backend (derived)',
      achieved.animalsBackend,
      capacities.animals * backendCallsPerPage
    ],
    ['plants frontend', achieved.plants, capacities.plants],
    [
      'plants backend (derived)',
      achieved.plantsBackend,
      capacities.plants * backendCallsPerPage
    ],
    ['INS front door', achieved.ins, capacities.ins],
    ['session path (derived)', achieved.sessionPath, capacities.sessionPath]
  ].map(([component, rate, capacity]) => [
    component,
    rpsText(rate),
    String(capacity)
  ])
}

const spikeTables = (report) => [
  `<p>${escapeHtml(report.run.profileLine)}</p>`,
  table(
    achievedHeading(report.run.steadyPhase),
    ACHIEVED_COLUMNS,
    achievedRows(report)
  ),
  table(
    `Spike (${report.spike.duration})`,
    ['Component', 'RPS', 'Capacity'],
    spikeRows(report.spike)
  ),
  comparisonTable({
    heading: 'Recovery P95',
    beforeLabel: 'Baseline',
    afterLabel: 'Recovered',
    comparisons: report.relative
  }),
  eventingTable(report)
]

const enduranceTables = (report) => [
  `<p>${escapeHtml(report.run.profileLine)}</p>`,
  ...report.windows.map((window) =>
    table(
      achievedHeading(window.phase),
      ACHIEVED_COLUMNS,
      achievedRows({ achieved: window })
    )
  ),
  comparisonTable({
    heading: 'Drift P95',
    beforeLabel: 'First-hour',
    afterLabel: 'Final-hour',
    comparisons: report.relative
  }),
  table(
    'Re-authentication',
    ['Frontend', 'Times', 'Expected'],
    report.reauthentication.map(({ frontend, count, expected }) => [
      frontend,
      count,
      expected
    ])
  )
]

const endpointsTable = (report) =>
  table(
    'Endpoints',
    [
      'Journey',
      'Scenario',
      'Endpoint',
      'Kind',
      'Requests',
      'P95 ms',
      'P99 ms',
      'Within'
    ],
    report.endpoints.map((row) => [
      row.journey,
      row.scenario,
      row.endpoint,
      row.kind,
      row.count,
      Math.round(row.p95Ms),
      Math.round(row.p99Ms),
      row.within ? 'yes' : 'no'
    ])
  )

const sharedRows = (shared) =>
  Object.values(shared).flatMap(
    ({
      phase,
      duration,
      sessionPathRps,
      readModelRps,
      sessionPathTarget,
      readModelTarget
    }) => [
      [
        'session path',
        `${phase} (${duration})`,
        rpsText(sessionPathRps),
        rpsText(sessionPathTarget),
        DESIGN_TARGETS.sharedComponents.sessionPath.source
      ],
      ...(readModelTarget === undefined
        ? []
        : [
            [
              'dashboard read model',
              `${phase} (${duration})`,
              rpsText(readModelRps),
              rpsText(readModelTarget),
              DESIGN_TARGETS.sharedComponents.readModel.source
            ]
          ])
    ]
  )

const roundedMs = (value) => (value === undefined ? '' : Math.round(value))

const comparisonRow = (entry) => [
  entry.scenario,
  entry.kind,
  roundedMs(entry.aloneP95Ms),
  roundedMs(entry.combinedP95Ms),
  entry.changeShare === null ? '' : signedPercentText(entry.changeShare),
  measuredText(entry.aloneFailedRate, percentText),
  measuredText(entry.combinedFailedRate, percentText)
]

const isolationVerdictText = (row) => {
  if (row.count === 0) {
    return NOT_MEASURED
  }

  return row.within ? 'yes' : 'no'
}

const isolationRow = (row) => [
  row.other,
  `${row.spiking} spike (${row.phase})`,
  row.kind,
  row.count,
  roundedMs(row.p95Ms),
  roundedMs(row.p99Ms),
  percentText(row.failedRate),
  isolationVerdictText(row)
]

const referenceDataRow = (row) => [
  row.endpoint,
  row.path,
  row.cold.count,
  roundedMs(row.cold.p95Ms),
  row.warm.count,
  roundedMs(row.warm.p95Ms),
  row.failed,
  row.firstRead
]

const combinedTables = (report) => [
  `<p>${escapeHtml(report.run.profileLine)}</p>`,
  table(
    achievedHeading(report.run.steadyPhase),
    ACHIEVED_COLUMNS,
    achievedRows(report)
  ),
  table(
    'Shared components',
    ['Component', 'Phase', 'Achieved RPS', 'Target', 'Source'],
    sharedRows(report.shared)
  ),
  table(
    'Alone and combined',
    [
      'Scenario',
      'Kind',
      'Alone P95 ms',
      'Combined P95 ms',
      'Change',
      'Alone failed',
      'Combined failed'
    ],
    report.comparisons.map(comparisonRow)
  ),
  table(
    'Isolation',
    [
      'Journey',
      'During',
      'Kind',
      'Requests',
      'P95 ms',
      'P99 ms',
      'Failed',
      'Within'
    ],
    report.isolation.map(isolationRow)
  ),
  table(
    'Reference data',
    [
      'Endpoint',
      'Path',
      'Cold reads',
      'Cold P95 ms',
      'Warm reads',
      'Warm P95 ms',
      'Failed reads',
      'First read'
    ],
    report.referenceData.rows.map(referenceDataRow)
  )
]

const TABLES = {
  [SHAPES.AVERAGE_LOAD]: averageLoadTables,
  [SHAPES.SPIKE_RECOVERY]: spikeTables,
  [SHAPES.ENDURANCE]: enduranceTables,
  [SHAPES.COMBINED]: combinedTables
}

/**
 * Writes a design-target run's report as a complete HTML page.
 *
 * @param {ReturnType<typeof designTargetReport>} report - The run's report.
 * @returns {string} The page. Every value is escaped, and styles are inline.
 */
export const designTargetHtml = (report) =>
  [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>Design-target run: ${escapeHtml(report.run.shape)}</title>`,
    '</head>',
    '<body style="font-family:sans-serif;margin:16px">',
    `<h1>Design-target run: ${escapeHtml(report.run.shape)}</h1>`,
    `<p>${escapeHtml(report.run.line)}</p>`,
    ...(TABLES[report.run.shape] ?? peakTables)(report),
    endpointsTable(report),
    '</body>',
    '</html>',
    ''
  ].join('\n')

const FAILED_LINES = {
  [SHAPES.P99_BURST]: relativeLine,
  [SHAPES.SPIKE_RECOVERY]: recoveryLine,
  [SHAPES.ENDURANCE]: driftLine
}

/**
 * Lists the relative comparisons that went over, as lines.
 *
 * @param {ReturnType<typeof designTargetReport>} report - The run's report.
 * @returns {string[]} One line for each pair that is over, worded for the run's shape.
 */
export const failedComparisonLines = (report) =>
  report.relative
    .filter(({ verdict }) => verdict === 'over')
    .map(FAILED_LINES[report.run.shape])
