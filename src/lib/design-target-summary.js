import {
  DESIGN_TARGETS,
  FRONTEND_OF_SCENARIO,
  JOURNEY_OF,
  LOAD_PROFILES,
  REPORTED_PHASES,
  HOUR_PHASES,
  SHAPES,
  averageLoadFactors,
  averageLoadProfileLine,
  hourLabel,
  journeyScenariosIn,
  percentText,
  runLine,
  segmentOf
} from '../config/design-target.js'
import { kindOf } from '../config/endpoints.js'
import { INTERIM_TARGETS, subMetricKey } from '../config/thresholds.js'
import {
  SECONDS_PER_HOUR,
  durationSeconds,
  durationText
} from '../config/traffic.js'
import { thresholdLines, thresholdResults } from './summary-text.js'

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

const relativeVerdictFor = ({ metrics, scenario, kind }) => {
  const peakP95Ms = durationOf(
    metrics,
    { scenario, kind, phase: 'peak' },
    'p(95)'
  )
  const burstP95Ms = durationOf(
    metrics,
    { scenario, kind, phase: 'burst' },
    'p(95)'
  )
  const burstCount =
    durationOf(metrics, { scenario, kind, phase: 'burst' }, 'count') ?? 0
  const { p95FactorOverPeak, minSamples } = INTERIM_TARGETS.burst
  const limitMs =
    peakP95Ms === undefined ? undefined : peakP95Ms * p95FactorOverPeak
  const judged =
    burstCount >= minSamples &&
    peakP95Ms !== undefined &&
    burstP95Ms !== undefined
  const verdict = !judged
    ? 'not judged'
    : burstP95Ms > limitMs
      ? 'over'
      : 'within'

  return {
    scenario,
    kind,
    peakP95Ms,
    burstP95Ms,
    burstCount,
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
    KINDS.filter((kind) => endpoints.some((name) => kindOf(name) === kind)).map(
      (kind) => relativeVerdictFor({ metrics, scenario, kind })
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

const profileLabel = (loadProfile) =>
  loadProfile === LOAD_PROFILES.WITH_IUU ? 'with IUU' : 'two journeys'

/**
 * States the front door's achieved figures against its volumetrics targets.
 *
 * @param {object} options - The figures.
 * @param {string} options.loadProfile - A value of `LOAD_PROFILES`.
 * @param {string} options.phase - The phase they were worked out over.
 * @param {number} options.seconds - The phase's length.
 * @param {ReturnType<typeof achievedFrontDoor>} options.achieved - What the run achieved.
 * @param {(typeof DESIGN_TARGETS)['frontDoor']['two-journeys']} options.target - The volumetrics figures.
 * @returns {string} The line.
 */
export const achievedFrontDoorLine = ({
  loadProfile,
  phase,
  seconds,
  achieved,
  target
}) =>
  `Achieved front door (${profileLabel(loadProfile)}) over the ${phase} (${durationText(seconds)}): ${labelledAgainst('sign-ins an hour', achieved.signInsPerHour, target.signInsPerHour, figureText)}, core pages ${labelledAgainst('RPS', achieved.coreRps, target.coreRps, rpsText)}, ${labelledAgainst('concurrent users', achieved.concurrentUsers, target.concurrentUsers, figureText)} (${target.source})`

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

  return `${subject}: ${millisecondsText(burstP95Ms)} against twice the peak's ${millisecondsText(peakP95Ms)} (${millisecondsText(limitMs)}): ${verdict === 'over' ? 'OVER' : 'within'}`
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
 * @param {boolean} options.gating - False for the with-IUU profile, which is reported only.
 * @returns {string} The line.
 */
export const relativeOutcomeLine = ({ verdicts, gating }) => {
  if (!gating) {
    return 'Relative thresholds: reported, not gated (with-IUU profile)'
  }

  const over = verdicts.filter(({ verdict }) => verdict === 'over')

  return over.length === 0
    ? 'Relative thresholds: passed'
    : `Relative thresholds: FAILED: ${over.map(({ scenario, kind }) => `${scenario} ${kind}`).join('; ')}`
}

const burstTargets = (loadProfile) => ({
  animals: DESIGN_TARGETS['live-animals'].burstRps,
  plants: DESIGN_TARGETS['high-risk-plants'].burstRps,
  ins: DESIGN_TARGETS.frontDoor[loadProfile].burstRps
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
 * @param {string} options.loadProfile - A value of `LOAD_PROFILES`.
 * @param {Record<string, { endpoints: string[] }>} options.scenarioSet - Scenarios shaped like `SCENARIOS`.
 * @returns {Array<{ hour: number, phase: string, label: string, segment: string, share: number, factor: number, seconds: number, journeys: Record<string, { achieved: object, target: object }>, frontDoor: { achieved: object, target: object } }>} One row per hour, hour 00 first.
 */
export const averageLoadHours = ({
  metrics,
  schedule,
  model,
  loadProfile,
  scenarioSet
}) => {
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
        target: hourTarget(DESIGN_TARGETS.frontDoor[loadProfile], factor)
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
 * @param {string} options.loadProfile - A value of `LOAD_PROFILES`.
 * @returns {string} The line.
 */
export const hourLine = ({ row, loadProfile }) => {
  const { achieved, target } = row.frontDoor
  const frontDoorText = `front door (${profileLabel(loadProfile)}) ${labelledAgainst('sign-ins an hour', achieved.signInsPerHour, target.signInsPerHour, figureText)}, core pages ${labelledAgainst('RPS', achieved.coreRps, target.coreRps, rpsText)}, ${labelledAgainst('concurrent users', achieved.concurrentUsers, target.concurrentUsers, figureText)}`

  return `Hour ${row.label} (${row.segment}, ${percentText(row.share)} of a weekday, ${durationText(row.seconds)}): ${[
    ...Object.entries(row.journeys).map(([scenario, figures]) =>
      hourJourneyText(scenario, figures)
    ),
    frontDoorText
  ].join('; ')}`
}

const averageLoadReport = ({
  metrics,
  shape,
  loadProfile,
  scenarioLength,
  environment,
  stubProfile,
  schedule,
  scenarioSet,
  model
}) => ({
  run: {
    line: runLine({
      shape,
      loadProfile,
      scenarioLength,
      environment,
      stubProfile,
      model
    }),
    profileLine: averageLoadProfileLine(model),
    shape,
    loadProfile,
    scenarioLength,
    environment,
    stubProfile: stubProfile ?? 'as-reported',
    gating: loadProfile === LOAD_PROFILES.TWO_JOURNEYS,
    hourSeconds: durationSeconds(model.averageLoad.hourDuration),
    schedule
  },
  hours: averageLoadHours({
    metrics,
    schedule,
    model,
    loadProfile,
    scenarioSet
  }),
  relative: [],
  endpoints: endpointRows({ metrics, scenarioSet }),
  thresholds: thresholdResults(metrics),
  relativeFailed: false
})

const peakReport = ({
  metrics,
  shape,
  loadProfile,
  scenarioLength,
  environment,
  stubProfile,
  schedule,
  scenarioSet,
  model
}) => {
  const [steady] = REPORTED_PHASES[shape]
  const seconds = phaseSeconds(schedule, steady)
  const gating = loadProfile === LOAD_PROFILES.TWO_JOURNEYS
  const isBurst = shape === SHAPES.P99_BURST
  const verdicts = isBurst
    ? relativeBurstVerdicts({ metrics, scenarioSet })
    : []

  return {
    run: {
      line: runLine({
        shape,
        loadProfile,
        scenarioLength,
        environment,
        stubProfile,
        model
      }),
      shape,
      loadProfile,
      scenarioLength,
      environment,
      stubProfile: stubProfile ?? 'as-reported',
      gating,
      steadyPhase: steady,
      steadySeconds: seconds,
      schedule
    },
    achieved: {
      journeys: Object.fromEntries(
        journeyScenariosIn(scenarioSet).map((scenario) => [
          scenario,
          {
            achieved: achievedJourney({
              metrics,
              scenario,
              phase: steady,
              seconds
            }),
            target: DESIGN_TARGETS[scenario]
          }
        ])
      ),
      frontDoor: {
        achieved: achievedFrontDoor({ metrics, phase: steady, seconds }),
        target: DESIGN_TARGETS.frontDoor[loadProfile]
      }
    },
    ...(isBurst
      ? {
          burst: {
            duration: model.p99Burst.burstDuration,
            factor: model.p99Burst.burstFactor,
            achieved: achievedBurst({
              metrics,
              seconds: burstSeconds(schedule)
            }),
            targets: burstTargets(loadProfile)
          }
        }
      : {}),
    relative: verdicts,
    endpoints: endpointRows({ metrics, scenarioSet, phase: steady }),
    thresholds: thresholdResults(metrics),
    relativeFailed: gating && verdicts.some(({ verdict }) => verdict === 'over')
  }
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
 * @param {string} options.loadProfile - A value of `LOAD_PROFILES`.
 * @param {string} options.scenarioLength - A value of `SCENARIO_LENGTHS`.
 * @param {string} options.environment - The environment the run was in.
 * @param {string | undefined} options.stubProfile - The stub profile the run required, if any.
 * @param {ReadonlyArray<object>} options.schedule - The run's phase schedule.
 * @param {Record<string, { endpoints: string[] }>} options.scenarioSet - Scenarios shaped like `SCENARIOS`.
 * @param {object} options.model - A resolved traffic model.
 * @returns {object} The report.
 */
export const designTargetReport = (options) =>
  options.shape === SHAPES.AVERAGE_LOAD
    ? averageLoadReport(options)
    : peakReport(options)

const journeyLines = ({ achieved, run }) =>
  Object.entries(achieved.journeys).map(([scenario, figures]) =>
    achievedJourneyLine({
      scenario,
      phase: run.steadyPhase,
      seconds: run.steadySeconds,
      ...figures
    })
  )

const burstLines = ({ burst, relative, run }) =>
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
        relativeOutcomeLine({ verdicts: relative, gating: run.gating })
      ]

const averageLoadText = (report, metrics) =>
  `${[
    report.run.line,
    report.run.profileLine,
    ...report.hours.map((row) =>
      hourLine({ row, loadProfile: report.run.loadProfile })
    ),
    ...report.endpoints.map(endpointLine),
    ...thresholdLines(metrics)
  ].join('\n')}\n`

const peakText = (report, metrics) =>
  `${[
    report.run.line,
    ...journeyLines(report),
    achievedFrontDoorLine({
      loadProfile: report.run.loadProfile,
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

/**
 * Writes a design-target run's end-of-test text.
 *
 * @param {ReturnType<typeof designTargetReport>} report - The run's report.
 * @param {Record<string, object>} metrics - k6's summary metrics, for the threshold lines.
 * @returns {string} Lines joined with newlines, ending in one.
 */
export const designTargetText = (report, metrics) =>
  report.hours === undefined
    ? peakText(report, metrics)
    : averageLoadText(report, metrics)

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
  ...Object.entries(achieved.journeys).map(
    ([scenario, { achieved: a, target }]) => [
      scenario,
      figureText(a.notificationsPerHour),
      String(target.notificationsPerHour),
      rpsText(a.frontendRps),
      String(target.frontendRps),
      figureText(a.concurrentUsers),
      String(target.concurrentUsers)
    ]
  ),
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

const peakTables = (report) => [
  table(
    `Achieved over the ${report.run.steadyPhase}`,
    [
      'Scenario',
      'Starts or sign-ins an hour',
      'Target',
      'Frontend RPS',
      'Target',
      'Concurrent users',
      'Target'
    ],
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
    ...(report.hours === undefined
      ? peakTables(report)
      : averageLoadTables(report)),
    endpointsTable(report),
    '</body>',
    '</html>',
    ''
  ].join('\n')
