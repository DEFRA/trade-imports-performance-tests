import {
  DESIGN_TARGETS,
  PHASES,
  faultPhase,
  journeyScenariosIn,
  runLine
} from '../config/design-target.js'
import { CALLER_EVIDENCE, resilienceProfileLine } from '../config/resilience.js'
import { subMetricKey } from '../config/thresholds.js'
import {
  achievedFrontDoor,
  achievedFrontDoorLine,
  achievedJourney,
  achievedJourneyLine,
  endpointLine,
  endpointRows,
  escapeHtml,
  phaseSeconds,
  table,
  valueOf
} from './design-target-summary.js'
import {
  cascadeLine,
  cascadeVerdict,
  failedCriteria,
  failedResilienceLines,
  faultLine,
  injectionOf,
  notInjectedLine,
  outcomeLine,
  outcomeVerdict,
  recoveryLine,
  recoveryVerdict,
  retryLine,
  retryVerdict,
  waitLine,
  waitVerdict
} from './resilience.js'
import { thresholdLines, thresholdResults } from './summary-text.js'

const LINE_ORDER = [
  'fault',
  'wait',
  'retries',
  'outcome',
  'recovery',
  'cascade'
]

const notJudged = (reason) => ({
  verdict: 'not judged',
  reason: `not injected (${reason})`
})

const injectedCounts = ({ metrics, fault }) => {
  const phase = faultPhase(fault.id)
  const integration = fault.integration

  return {
    requests: valueOf(
      metrics,
      subMetricKey('stub_requests', { integration, phase }),
      'count'
    ),
    count: valueOf(
      metrics,
      subMetricKey('stub_faults_injected', { integration, phase }),
      'count'
    )
  }
}

const notInjectedFault = ({ fault, injection }) => {
  const verdict = notJudged(injection.reason)

  return {
    id: fault.id,
    integration: fault.integration,
    kind: fault.kind,
    callers: CALLER_EVIDENCE[fault.integration].callers,
    injected: { applied: false, reason: injection.reason },
    wait: verdict,
    retries: verdict,
    outcome: verdict,
    recovery: verdict,
    cascade: verdict,
    lines: { fault: notInjectedLine(fault, injection.reason) }
  }
}

const judgedFault = ({ fault, metrics, scenarioSet, model, declarations }) => {
  const wait = waitVerdict({ metrics, fault })
  const retries = retryVerdict({ metrics, fault })
  const outcome = outcomeVerdict({ metrics, fault, declarations })
  const recovery = recoveryVerdict({ metrics, fault, scenarioSet, model })
  const cascade = cascadeVerdict({ metrics, fault, scenarioSet })

  return {
    id: fault.id,
    integration: fault.integration,
    kind: fault.kind,
    callers: CALLER_EVIDENCE[fault.integration].callers,
    injected: { applied: true, ...injectedCounts({ metrics, fault }) },
    wait,
    retries,
    outcome,
    recovery,
    cascade,
    lines: {
      fault: faultLine({ fault, metrics }),
      wait: waitLine({ fault, verdict: wait }),
      retries: retryLine({ fault, verdict: retries }),
      outcome: outcomeLine({ fault, verdict: outcome }),
      recovery: recoveryLine({ fault, verdict: recovery, model }),
      cascade: cascadeLine({ fault, verdict: cascade })
    }
  }
}

const achievedOverBaseline = ({ metrics, schedule, scenarioSet }) => {
  const phase = PHASES.BASELINE
  const seconds = phaseSeconds(schedule, phase)

  return {
    phase,
    seconds,
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
  }
}

/**
 * Builds the JSON-ready report of a resilience run: the settings, what the run
 * achieved over its healthy baseline, and for each fault whether the callers
 * waited a bounded time, retried a bounded number of times, failed cleanly,
 * recovered and how long that took, and whether the failure cascaded. A fault
 * that could not be injected is reported as such, with nothing judged for it.
 *
 * @param {object} options - The run.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {string} options.shape - `resilience`.
 * @param {string} options.scenarioLength - A value of `SCENARIO_LENGTHS`.
 * @param {string} options.environment - The environment the run was in.
 * @param {string | undefined} options.stubProfile - The stub profile the run required, if any.
 * @param {ReadonlyArray<object>} options.schedule - The run's phase schedule.
 * @param {Record<string, { endpoints: string[] }>} options.scenarioSet - Scenarios shaped like `SCENARIOS`.
 * @param {object} options.model - A resolved traffic model.
 * @param {ReadonlyArray<{ id: string, integration: string, kind: string }>} options.faults - The faults the run injected.
 * @param {Record<string, string>} [options.declarations] - What each fault's service declares it does, by fault id; `DECLARED_DEGRADATION` when omitted.
 * @returns {object} The report.
 */
export const resilienceReport = ({
  metrics,
  shape,
  scenarioLength,
  environment,
  stubProfile,
  schedule,
  scenarioSet,
  model,
  faults,
  declarations
}) => {
  const faultReports = faults.map((fault) => {
    const injection = injectionOf({ metrics, fault, environment })

    return injection.applied
      ? judgedFault({ fault, metrics, scenarioSet, model, declarations })
      : notInjectedFault({ fault, injection })
  })
  const report = {
    run: {
      line: runLine({
        shape,
        scenarioLength,
        environment,
        stubProfile,
        model,
        faults
      }),
      profileLine: resilienceProfileLine({ model, faults }),
      shape,
      scenarioLength,
      environment,
      stubProfile: stubProfile ?? 'as-reported',
      schedule
    },
    achieved: achievedOverBaseline({ metrics, schedule, scenarioSet }),
    faults: faultReports,
    endpoints: endpointRows({
      metrics,
      scenarioSet,
      phase: PHASES.BASELINE
    }),
    thresholds: thresholdResults(metrics)
  }

  return { ...report, failed: failedResilienceLines(report).length > 0 }
}

const outcomeSummaryLine = (report) => {
  const notInjected = report.faults.filter(
    ({ injected }) => !injected.applied
  ).length
  const suffix =
    notInjected === 0
      ? ''
      : ` (${notInjected} of ${report.faults.length} faults were not injected, nothing judged for them)`

  return report.failed
    ? `Resilience: FAILED: ${failedCriteria(report).join('; ')}${suffix}`
    : `Resilience: passed${suffix}`
}

/**
 * Writes a resilience run's end-of-test text: the run and profile lines, what
 * the baseline achieved, each fault's lines in the order of the criteria, the
 * outcome, the baseline's endpoints and every threshold.
 *
 * @param {ReturnType<typeof resilienceReport>} report - The run's report.
 * @param {Record<string, object>} metrics - k6's summary metrics, for the threshold lines.
 * @returns {string} Lines joined with newlines, ending in one.
 */
export const resilienceText = (report, metrics) => {
  const { achieved } = report

  return `${[
    report.run.line,
    report.run.profileLine,
    ...Object.entries(achieved.journeys).map(([scenario, figures]) =>
      achievedJourneyLine({
        scenario,
        phase: achieved.phase,
        seconds: achieved.seconds,
        ...figures
      })
    ),
    achievedFrontDoorLine({
      phase: achieved.phase,
      seconds: achieved.seconds,
      ...achieved.frontDoor
    }),
    ...report.faults.flatMap((fault) =>
      LINE_ORDER.map((criterion) => fault.lines[criterion]).filter(Boolean)
    ),
    outcomeSummaryLine(report),
    ...report.endpoints.map(endpointLine),
    ...thresholdLines(metrics)
  ].join('\n')}\n`
}

const verdictCell = ({ verdict, reason }, figure = '') =>
  `${verdict}${figure}${reason === undefined ? '' : `: ${reason}`}`

const waitCell = (wait) =>
  verdictCell(
    wait,
    wait.maxMs === undefined
      ? ''
      : ` (slowest ${Math.round(wait.maxMs)}ms of ${Math.round(wait.limitMs)}ms)`
  )

const retriesCell = (retries) =>
  verdictCell(
    retries,
    retries.stubRequests === undefined
      ? ''
      : ` (${retries.stubRequests} stub requests for ${retries.calls} calls, ${retries.allowed} allowed)`
  )

const recoveryCell = (recovery) => {
  const drain =
    recovery.drained === undefined
      ? ''
      : recovery.drained
        ? `, backlog drained ${recovery.drainSeconds}s after`
        : ', backlog did not drain'

  return verdictCell(
    recovery,
    `${recovery.stepsText === undefined ? '' : ` within ${recovery.stepsText}`}${drain}`
  )
}

const cascadeCell = (cascade) =>
  cascade.findings === undefined || cascade.findings.length === 0
    ? verdictCell(cascade)
    : `${cascade.verdict}: ${cascade.findings.join('; ')}`

const injectedCell = ({ injected }) => {
  if (!injected.applied) {
    return `not injected (${injected.reason})`
  }

  return injected.count === undefined
    ? 'injected'
    : `${injected.count} of ${injected.requests}`
}

const faultRow = (fault) => [
  fault.id,
  fault.callers,
  injectedCell(fault),
  waitCell(fault.wait),
  retriesCell(fault.retries),
  verdictCell(fault.outcome),
  recoveryCell(fault.recovery),
  cascadeCell(fault.cascade)
]

const faultsTable = (report) =>
  table(
    'Faults',
    [
      'Fault',
      'Callers',
      'Injected',
      'Wait',
      'Retries',
      'Failure',
      'Recovery',
      'Cascade'
    ],
    report.faults.map(faultRow)
  )

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
 * Writes a resilience run's report as a complete HTML page.
 *
 * @param {ReturnType<typeof resilienceReport>} report - The run's report.
 * @returns {string} The page. Every value is escaped, and styles are inline.
 */
export const resilienceHtml = (report) =>
  [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>Resilience run: ${escapeHtml(report.run.environment)}</title>`,
    '</head>',
    '<body style="font-family:sans-serif;margin:16px">',
    `<h1>Resilience run: ${escapeHtml(report.run.environment)}</h1>`,
    `<p>${escapeHtml(report.run.line)}</p>`,
    `<p>${escapeHtml(report.run.profileLine)}</p>`,
    faultsTable(report),
    endpointsTable(report),
    '</body>',
    '</html>',
    ''
  ].join('\n')
