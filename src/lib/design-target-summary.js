import {
  DESIGN_TARGETS,
  FRONTEND_OF_SCENARIO,
  JOURNEY_OF,
  REPORTED_PHASES,
  RETURNING_SCENARIOS,
  HOUR_PHASES,
  SHAPES,
  averageLoadFactors,
  averageLoadProfileLine,
  enduranceProfileLine,
  enduranceRunSeconds,
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
import { RE_AUTHENTICATION_TAG } from '../config/request-mix.js'
import { INTERIM_TARGETS, subMetricKey } from '../config/thresholds.js'
import {
  SECONDS_PER_HOUR,
  durationSeconds,
  durationText
} from '../config/traffic.js'
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

const durationOf = (metrics, tags, stat) =>
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

const kindsIn = (endpoints) =>
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
          }
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

const REPORTS = {
  [SHAPES.AVERAGE_LOAD]: averageLoadReport,
  [SHAPES.SPIKE_RECOVERY]: spikeReport,
  [SHAPES.ENDURANCE]: enduranceReport
}

/**
 * Builds the JSON-ready report of a design-target run: the settings, what it
 * achieved against the volumetrics figures, the burst verdicts and every
 * endpoint's response times, tagged by journey, scenario and kind. The
 * average-load run reports each hour of its weekday against that hour's target
 * instead.
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

const TEXTS = {
  [SHAPES.AVERAGE_LOAD]: averageLoadText,
  [SHAPES.SPIKE_RECOVERY]: spikeText,
  [SHAPES.ENDURANCE]: enduranceText
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

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character])

const table = (heading, columns, rows) =>
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

const peakTables = (report) => [
  table(
    achievedHeading(report.run.steadyPhase),
    ACHIEVED_COLUMNS,
    achievedRows(report)
  ),
  burstTable(report),
  relativeTable(report)
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
  })
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

const TABLES = {
  [SHAPES.AVERAGE_LOAD]: averageLoadTables,
  [SHAPES.SPIKE_RECOVERY]: spikeTables,
  [SHAPES.ENDURANCE]: enduranceTables
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
