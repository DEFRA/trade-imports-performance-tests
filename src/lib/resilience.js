import {
  PHASES,
  REFERENCE_DATA_WATCH_SCENARIO,
  clearedPhase,
  faultPhase,
  percentText
} from '../config/design-target.js'
import {
  CALLER_EVIDENCE,
  CASCADE_SCOPE,
  DECLARED_DEGRADATION,
  FAULT_CATALOGUE,
  INJECTION_CODES,
  countText,
  notInjectedReason,
  recoveryStepCount,
  stepsDurationText
} from '../config/resilience.js'
import { INTERIM_TARGETS, subMetricKey } from '../config/thresholds.js'
import {
  durationOf,
  kindsIn,
  p95Comparison,
  valueOf
} from './design-target-summary.js'

const PERCENT = 100
const SERVICE_BUS_INTEGRATION = 'azure-service-bus'
const FAULT_WINDOW = /^fault-(.+)$/
const CLEARED_WINDOW = /^cleared-(.+)-\d+$/
const NO_REQUESTS = 'no requests in the fault window'
const SERVICE_BUS_WAIT_REASON =
  "the gateway's wait is not visible to a request; the backlog and dead letters stand in"
const FAILING_VERDICTS = Object.freeze([
  'UNBOUNDED',
  'UNCLEAN',
  'NOT AS DECLARED',
  'NOT RECOVERED',
  'CASCADED'
])

const millisecondsText = (value) => `${Math.round(value)}ms`

const countOf = (metrics, key) => valueOf(metrics, key, 'count') ?? 0

const failedRateOf = (metrics, tags) =>
  valueOf(metrics, subMetricKey('http_req_failed', tags), 'rate')

/**
 * Works out how much a counter rose between two readings.
 *
 * @param {{ before: number | null | undefined, after: number | null | undefined }} readings - The two readings.
 * @returns {number | null} The rise, never below 0 (a restarted stub reads lower); null when either reading is missing.
 */
export const counterDelta = ({ before, after }) =>
  before === null ||
  before === undefined ||
  after === null ||
  after === undefined
    ? null
    : Math.max(0, after - before)

/**
 * Tells which fault a phase belongs to, and whether it is the fault window or
 * a cleared step.
 *
 * @param {string | null} phase - A phase name, or null before the run starts.
 * @returns {{ id: string, window: 'fault' | 'cleared' } | null} The fault, or null for a phase that belongs to none.
 */
export const faultOfPhase = (phase) => {
  const injected = FAULT_WINDOW.exec(phase ?? '')

  if (injected) {
    return { id: injected[1], window: 'fault' }
  }

  const cleared = CLEARED_WINDOW.exec(phase ?? '')

  return cleared ? { id: cleared[1], window: 'cleared' } : null
}

const isServiceBusFault = (id) =>
  FAULT_CATALOGUE.find((fault) => fault.id === id)?.integration ===
  SERVICE_BUS_INTEGRATION

const TOXIC_REMOVED = 204
const TOXIC_NOT_FOUND = 404

/**
 * Tells whether every attempt to remove a toxic left none behind.
 *
 * @param {Array<number | null>} statuses - The status of each removal, or null when toxiproxy could not be reached.
 * @returns {boolean} True when each answered 204 (removed) or 404 (there was no such toxic).
 */
export const toxicsCleared = (statuses) =>
  statuses.every(
    (status) => status === TOXIC_REMOVED || status === TOXIC_NOT_FOUND
  )

/** The state a fault controller starts from: no phase seen yet. */
export const INITIAL_CONTROL_STATE = Object.freeze({ phase: null })

/**
 * Decides what the fault controller does on one tick.
 *
 * On a change of phase it records the counters for the phase just ended (the
 * first tick records the starting readings, with a null phase), clears the
 * fault of a fault window just left, then applies the fault of a fault window
 * just entered. In a cleared step of a Service Bus fault it watches the backlog
 * on every tick.
 *
 * @param {object} options - The tick.
 * @param {{ phase: string | null }} options.state - The state the last tick returned.
 * @param {string} options.phase - The phase the run is in now.
 * @returns {{ state: { phase: string }, actions: Array<{ type: 'record', phase: string | null } | { type: 'clear' | 'apply' | 'watch-backlog', fault: string }> }} The next state and the actions to take, in order.
 */
export const nextControlActions = ({ state, phase }) => {
  const previous = state.phase
  const changed = previous !== phase
  const left = faultOfPhase(previous)
  const entered = faultOfPhase(phase)
  const actions = []

  if (changed) {
    actions.push({ type: 'record', phase: previous })

    if (left?.window === 'fault') {
      actions.push({ type: 'clear', fault: left.id })
    }

    if (entered?.window === 'fault') {
      actions.push({ type: 'apply', fault: entered.id })
    }
  }

  if (entered?.window === 'cleared' && isServiceBusFault(entered.id)) {
    actions.push({ type: 'watch-backlog', fault: entered.id })
  }

  return { state: { phase }, actions }
}

/**
 * Reads how a fault's injection went.
 *
 * @param {object} options - The fault.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {{ id: string }} options.fault - A fault.
 * @param {string} options.environment - The environment the run was in.
 * @returns {{ applied: boolean, code: number, reason: string | null }} Whether the fault was switched on, and if not, why.
 */
export const injectionOf = ({ metrics, fault, environment }) => {
  const code =
    valueOf(
      metrics,
      subMetricKey('fault_injection_applied', { fault: fault.id }),
      'value'
    ) ?? INJECTION_CODES.NOT_ATTEMPTED
  const applied = code === INJECTION_CODES.APPLIED

  return {
    applied,
    code,
    reason: applied ? null : notInjectedReason(code, environment)
  }
}

const callerWindow = ({ metrics, fault }) => {
  const { durationTags, failedTags } = CALLER_EVIDENCE[fault.integration]
  const phase = faultPhase(fault.id)
  const tags = { ...durationTags, phase }

  return {
    requests: durationOf(metrics, tags, 'count') ?? 0,
    maxMs: durationOf(metrics, tags, 'max'),
    failedRate: failedRateOf(metrics, { ...failedTags, phase }),
    transportErrors: countOf(
      metrics,
      subMetricKey('transport_errors', { ...failedTags, phase })
    )
  }
}

const deadLettersIn = ({ metrics, fault }) =>
  valueOf(
    metrics,
    subMetricKey('resilience_dead_letters', { fault: fault.id }),
    'value'
  )

const drainSecondsOf = ({ metrics, fault }) =>
  valueOf(
    metrics,
    subMetricKey('resilience_backlog_drained_seconds', { fault: fault.id }),
    'value'
  )

const backlogUnreadIn = ({ metrics, fault }) =>
  valueOf(
    metrics,
    subMetricKey('resilience_backlog_unread', { fault: fault.id }),
    'value'
  ) !== undefined

/**
 * Judges whether the caller of a faulted dependency waited a bounded time: its
 * slowest request in the fault window answered within the interim limit.
 *
 * `max`, not a percentile, because one request that waits without bound is
 * exactly the failure.
 *
 * @param {object} options - The fault.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {{ id: string, integration: string }} options.fault - A fault.
 * @returns {{ verdict: 'bounded' | 'UNBOUNDED' | 'not measured', maxMs?: number, limitMs?: number, requests?: number, reason?: string }} The verdict.
 */
export const waitVerdict = ({ metrics, fault }) => {
  if (!CALLER_EVIDENCE[fault.integration].synchronous) {
    return { verdict: 'not measured', reason: SERVICE_BUS_WAIT_REASON }
  }

  const { requests, maxMs } = callerWindow({ metrics, fault })
  const limitMs = INTERIM_TARGETS.resilience.maxWaitMs

  if (requests === 0 || maxMs === undefined) {
    return {
      verdict: 'not measured',
      reason: NO_REQUESTS,
      requests: 0,
      limitMs
    }
  }

  return {
    verdict: maxMs < limitMs ? 'bounded' : 'UNBOUNDED',
    maxMs,
    limitMs,
    requests
  }
}

const demandIn = ({ metrics, evidence, phase }) => {
  const { metric, stat, tags } = evidence.demand

  return valueOf(metrics, subMetricKey(metric, { ...tags, phase }), stat) ?? 0
}

const stubRequestsIn = ({ metrics, fault, phase }) =>
  valueOf(
    metrics,
    subMetricKey('stub_requests', { integration: fault.integration, phase }),
    'count'
  )

/**
 * Judges whether the caller of a faulted dependency retried a bounded number of
 * times, counting the retries where they land: at the stub.
 *
 * The bound is the interim amplification times the stub requests a call made in
 * the healthy baseline, times the calls the caller made in the fault window,
 * plus one.
 *
 * @param {object} options - The fault.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {{ id: string, integration: string }} options.fault - A fault.
 * @returns {{ verdict: 'bounded' | 'UNBOUNDED' | 'not measured', stubRequests?: number, calls?: number, allowed?: number, perCallBaseline?: number, amplification?: number, reason?: string, deadLetters?: number }} The verdict.
 */
export const retryVerdict = ({ metrics, fault }) => {
  const evidence = CALLER_EVIDENCE[fault.integration]

  if (!evidence.synchronous) {
    return {
      verdict: 'not measured',
      reason:
        "the gateway's retries are bounded by the SQS redrive (maxReceiveCount)",
      deadLetters: deadLettersIn({ metrics, fault })
    }
  }

  const phase = faultPhase(fault.id)
  const stubRequests = stubRequestsIn({ metrics, fault, phase })
  const calls = demandIn({ metrics, evidence, phase })

  if (stubRequests === undefined || calls === 0) {
    return {
      verdict: 'not measured',
      reason:
        calls === 0
          ? 'the caller made no call that needed the dependency in the fault window'
          : 'the stub did not report its request count'
    }
  }

  const baselineStub =
    stubRequestsIn({ metrics, fault, phase: PHASES.BASELINE }) ?? 0
  const baselineCalls = demandIn({
    metrics,
    evidence,
    phase: PHASES.BASELINE
  })
  const perCallBaseline =
    baselineStub > 0 && baselineCalls > 0 ? baselineStub / baselineCalls : 1
  const amplification = INTERIM_TARGETS.resilience.maxRetryAmplification
  const allowed = Math.ceil(amplification * perCallBaseline * calls) + 1

  return {
    verdict: stubRequests <= allowed ? 'bounded' : 'UNBOUNDED',
    stubRequests,
    calls,
    allowed,
    perCallBaseline,
    amplification
  }
}

const withDeclaration = ({ fault, outcome, declarations }) => {
  const declared = declarations[fault.id]

  return declared === undefined ||
    outcome.verdict === 'not measured' ||
    outcome.verdict === declared
    ? outcome
    : { ...outcome, verdict: 'NOT AS DECLARED', declared }
}

const serviceBusOutcome = ({ metrics, fault }) => {
  const deadLetters = deadLettersIn({ metrics, fault })
  const drainSeconds = drainSecondsOf({ metrics, fault })

  if (deadLetters === undefined) {
    return {
      verdict: 'not measured',
      reason: 'the dead-letter queue could not be read',
      deadLetters,
      drainSeconds
    }
  }

  if (deadLetters > 0) {
    return { verdict: 'failed cleanly', deadLetters, drainSeconds }
  }

  return drainSeconds === undefined
    ? {
        verdict: 'not measured',
        reason: 'the backlog did not drain after the fault cleared',
        deadLetters,
        drainSeconds
      }
    : { verdict: 'absorbed', deadLetters, drainSeconds }
}

const synchronousOutcome = ({ metrics, fault }) => {
  const { requests, failedRate, transportErrors } = callerWindow({
    metrics,
    fault
  })
  const wait = waitVerdict({ metrics, fault })

  if (requests === 0 || failedRate === undefined) {
    return { verdict: 'not measured', reason: NO_REQUESTS }
  }

  const waitBounded = wait.verdict === 'bounded'
  const failing = failedRate >= INTERIM_TARGETS.maxFailureRate
  const base = { failedRate, transportErrors, wait }

  if (!failing && waitBounded) {
    return { ...base, verdict: 'absorbed' }
  }

  if (failing && waitBounded && transportErrors === 0) {
    return { ...base, verdict: 'failed cleanly' }
  }

  return {
    ...base,
    verdict: 'UNCLEAN',
    reasons: [
      ...(waitBounded
        ? []
        : [
            `slowest ${millisecondsText(wait.maxMs)} over ${millisecondsText(wait.limitMs)}`
          ]),
      ...(transportErrors > 0
        ? [`${countText(transportErrors, 'request')} failed below HTTP`]
        : [])
    ]
  }
}

/**
 * Judges whether the caller of a faulted dependency failed cleanly or degraded
 * as declared.
 *
 * For a synchronous dependency, from the caller's requests in the fault window:
 * `absorbed` when failures are under the interim limit and the wait is bounded;
 * `failed cleanly` when they are not but every request was answered over HTTP
 * within the wait limit; `UNCLEAN` otherwise. A declared degradation turns any
 * other behaviour into `NOT AS DECLARED`. For Service Bus: `absorbed` when
 * nothing dead-lettered and the backlog drained, `failed cleanly` when messages
 * dead-lettered (the redrive gave up, bounded).
 *
 * @param {object} options - The fault.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {{ id: string, integration: string }} options.fault - A fault.
 * @param {Record<string, string>} [options.declarations] - What each fault's service declares it does, by fault id; `DECLARED_DEGRADATION` when omitted.
 * @returns {{ verdict: 'absorbed' | 'failed cleanly' | 'UNCLEAN' | 'NOT AS DECLARED' | 'not measured', failedRate?: number, transportErrors?: number, wait?: object, reasons?: string[], reason?: string, deadLetters?: number, drainSeconds?: number, declared?: string }} The verdict.
 */
export const outcomeVerdict = ({
  metrics,
  fault,
  declarations = DECLARED_DEGRADATION
}) =>
  withDeclaration({
    fault,
    declarations,
    outcome: CALLER_EVIDENCE[fault.integration].synchronous
      ? synchronousOutcome({ metrics, fault })
      : serviceBusOutcome({ metrics, fault })
  })

const recoveryPairs = (scenarioSet) => [
  ...Object.entries(scenarioSet).flatMap(([scenario, { endpoints }]) =>
    kindsIn(endpoints).map((kind) => ({ scenario, kind }))
  ),
  { scenario: REFERENCE_DATA_WATCH_SCENARIO, kind: 'api' }
]

const recoveryStep = ({ metrics, fault, scenarioSet, step }) => {
  const { p95FactorOverBaseline, minSamples } = INTERIM_TARGETS.resilience
  const after = clearedPhase(fault.id, step)
  const comparisons = recoveryPairs(scenarioSet).map(({ scenario, kind }) =>
    p95Comparison({
      metrics,
      scenario,
      kind,
      before: PHASES.BASELINE,
      after,
      factor: p95FactorOverBaseline,
      minSamples,
      minBeforeSamples: minSamples
    })
  )
  const scenarios = [...Object.keys(scenarioSet), REFERENCE_DATA_WATCH_SCENARIO]
  const failuresBack = scenarios.every((scenario) => {
    const rate = failedRateOf(metrics, { scenario, phase: after })
    const baselineRate =
      failedRateOf(metrics, { scenario, phase: PHASES.BASELINE }) ?? 0

    return (
      rate === undefined ||
      rate < INTERIM_TARGETS.maxFailureRate ||
      rate <= baselineRate
    )
  })

  return {
    step,
    judged: comparisons.filter(({ verdict }) => verdict !== 'not judged')
      .length,
    within:
      failuresBack && comparisons.every(({ verdict }) => verdict !== 'over')
  }
}

const stepsVerdict = ({ steps }) => {
  const stableFrom = steps.findIndex((_, index) =>
    steps.slice(index).every(({ within }) => within)
  )
  const judged = steps.reduce((total, { judged: count }) => total + count, 0)

  if (stableFrom === -1) {
    return { verdict: 'NOT RECOVERED' }
  }

  return judged === 0
    ? { verdict: 'not judged' }
    : { verdict: 'recovered', steps: stableFrom + 1 }
}

/**
 * Judges whether every service came back to its pre-fault response times and
 * failure rate once the fault cleared, and how long that took.
 *
 * The cleared window is split into recovery steps. A step is within when, for
 * every journey scenario, the front door and the reference-data watch, each
 * kind's P95 is at most the interim factor over its baseline P95 (pairs with too
 * few requests are ignored) and the scenario's failure rate is under the limit
 * or no higher than its baseline rate. Recovery is the end of the first step
 * from which every later step is within. A Service Bus fault also needs the
 * gateway's backlog back to where it was when the fault started; when that
 * starting backlog could not be read, recovery is `not judged`.
 *
 * @param {object} options - The fault.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {{ id: string, integration: string }} options.fault - A fault.
 * @param {Record<string, { endpoints: string[] }>} options.scenarioSet - Scenarios shaped like `SCENARIOS`.
 * @param {object} options.model - A resolved traffic model.
 * @returns {{ verdict: 'recovered' | 'NOT RECOVERED' | 'not judged', seconds?: number, stepsText?: string, drainSeconds?: number | null, drained?: boolean }} The verdict. `drained` is present for Service Bus faults.
 */
export const recoveryVerdict = ({ metrics, fault, scenarioSet, model }) => {
  const steps = Array.from({ length: recoveryStepCount(model) }, (_, index) =>
    recoveryStep({ metrics, fault, scenarioSet, step: index + 1 })
  )
  const requestSteps = stepsVerdict({ steps })
  const isServiceBus = fault.integration === SERVICE_BUS_INTEGRATION
  const drainSeconds = isServiceBus ? drainSecondsOf({ metrics, fault }) : null
  const drained = isServiceBus ? drainSeconds !== undefined : undefined
  const drainFields = isServiceBus
    ? { drained, drainSeconds: drainSeconds ?? null }
    : {}

  if (isServiceBus && !drained) {
    return backlogUnreadIn({ metrics, fault })
      ? {
          verdict: 'not judged',
          reason: 'backlog depth could not be read when the fault was applied',
          ...drainFields
        }
      : { verdict: 'NOT RECOVERED', ...drainFields }
  }

  if (requestSteps.verdict !== 'recovered') {
    return { ...requestSteps, ...drainFields }
  }

  return {
    verdict: 'recovered',
    stepCount: requestSteps.steps,
    stepsText: stepsDurationText(model, requestSteps.steps),
    ...drainFields
  }
}

const journeyRows = ({ metrics, scenarios, scenarioSet, phase }) =>
  scenarios.flatMap((scenario) =>
    kindsIn(scenarioSet[scenario].endpoints).map((kind) => {
      const tags = { scenario, kind, phase }
      const { p95Ms: p95LimitMs, p99Ms: p99LimitMs } = INTERIM_TARGETS[kind]

      return {
        scenario,
        kind,
        count: durationOf(metrics, tags, 'count') ?? 0,
        p95Ms: durationOf(metrics, tags, 'p(95)'),
        p99Ms: durationOf(metrics, tags, 'p(99)'),
        p95LimitMs,
        p99LimitMs,
        failedRate: failedRateOf(metrics, { scenario, phase })
      }
    })
  )

const isOver = (value, limit) =>
  value !== undefined && limit !== undefined && value >= limit

const journeyCascadeFindings = (rows) => {
  const judged = rows.filter(({ count }) => count > 0)
  const firstRowOfScenario = (row) =>
    judged.find(({ scenario }) => scenario === row.scenario) === row

  return judged.flatMap((row) => [
    ...(isOver(row.p95Ms, row.p95LimitMs)
      ? [
          `${row.scenario} ${row.kind} P95 ${millisecondsText(row.p95Ms)} against ${millisecondsText(row.p95LimitMs)}`
        ]
      : []),
    ...(isOver(row.p99Ms, row.p99LimitMs)
      ? [
          `${row.scenario} ${row.kind} P99 ${millisecondsText(row.p99Ms)} against ${millisecondsText(row.p99LimitMs)}`
        ]
      : []),
    ...(firstRowOfScenario(row) &&
    isOver(row.failedRate, INTERIM_TARGETS.maxFailureRate)
      ? [
          `${row.scenario} failed ${percentText(row.failedRate)} against ${percentText(INTERIM_TARGETS.maxFailureRate)}`
        ]
      : [])
  ])
}

const watchFindings = ({ metrics, phase }) => {
  const tags = {
    scenario: REFERENCE_DATA_WATCH_SCENARIO,
    kind: 'api',
    phase
  }
  const count = durationOf(metrics, tags, 'count') ?? 0
  const rate = failedRateOf(metrics, {
    scenario: REFERENCE_DATA_WATCH_SCENARIO,
    phase
  })

  if (count === 0) {
    return []
  }

  return [
    ...(isOver(durationOf(metrics, tags, 'p(95)'), INTERIM_TARGETS.api.p95Ms)
      ? [
          `reference-data watch P95 ${millisecondsText(durationOf(metrics, tags, 'p(95)'))} against ${millisecondsText(INTERIM_TARGETS.api.p95Ms)}`
        ]
      : []),
    ...(isOver(rate, INTERIM_TARGETS.maxFailureRate)
      ? [
          `reference-data watch failed ${percentText(rate)} against ${percentText(INTERIM_TARGETS.maxFailureRate)}`
        ]
      : [])
  ]
}

const signInFindings = ({ metrics, phase }) => {
  const rate = failedRateOf(metrics, { endpoint: 'sign-in', phase })

  return isOver(rate, INTERIM_TARGETS.maxFailureRate)
    ? [
        `sign-in failed ${percentText(rate)} against ${percentText(INTERIM_TARGETS.maxFailureRate)}`
      ]
    : []
}

const deadLetterFindings = ({ metrics, fault }) => {
  const deadLetters = deadLettersIn({ metrics, fault })

  return deadLetters > 0
    ? [`${countText(deadLetters, 'message')} dead-lettered`]
    : []
}

const cascadeScopeNames = ({ scope }) => [
  ...scope.scenarios,
  ...(scope.signIn ? ['sign-in'] : []),
  ...(scope.watch ? ['reference-data watch'] : []),
  ...(scope.deadLetters ? ['Service Bus'] : [])
]

/**
 * Judges whether a fault cascaded: during its fault window, everything not
 * served by the faulted dependency stayed within its thresholds.
 *
 * What is judged depends on the dependency (`CASCADE_SCOPE`). A scenario, kind
 * or dependency with no requests is not judged. The journeys and the front door
 * all sign in through Defra ID, so a Defra ID fault judges the reference-data
 * watch and the dead letters instead.
 *
 * @param {object} options - The fault.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {{ id: string, integration: string }} options.fault - A fault.
 * @param {Record<string, { endpoints: string[] }>} options.scenarioSet - Scenarios shaped like `SCENARIOS`.
 * @returns {{ verdict: 'no cascade' | 'CASCADED', judged: string[], findings: string[] }} The verdict, what was judged, and what went over.
 */
export const cascadeVerdict = ({ metrics, fault, scenarioSet }) => {
  const scope = CASCADE_SCOPE[fault.integration]
  const phase = faultPhase(fault.id)
  const findings = [
    ...journeyCascadeFindings(
      journeyRows({ metrics, scenarios: scope.scenarios, scenarioSet, phase })
    ),
    ...(scope.signIn ? signInFindings({ metrics, phase }) : []),
    ...(scope.watch ? watchFindings({ metrics, phase }) : []),
    ...(scope.deadLetters ? deadLetterFindings({ metrics, fault }) : [])
  ]

  return {
    verdict: findings.length === 0 ? 'no cascade' : 'CASCADED',
    judged: cascadeScopeNames({ scope }),
    findings
  }
}

/**
 * Tells whether a verdict fails the run.
 *
 * @param {{ verdict: string }} entry - Any verdict this module returns.
 * @returns {boolean} True for `UNBOUNDED`, `UNCLEAN`, `NOT AS DECLARED`, `NOT RECOVERED` and `CASCADED`.
 */
export const isFailingVerdict = ({ verdict }) =>
  FAILING_VERDICTS.includes(verdict)

const subject = ({ id, integration }) =>
  `${id} (${CALLER_EVIDENCE[integration].callers.replace(/^the /, '')})`

/**
 * States how many of the requests at the stub a fault was injected into.
 *
 * @param {object} options - The fault.
 * @param {{ id: string, integration: string }} options.fault - A fault.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @returns {string} The line.
 */
export const faultLine = ({ fault, metrics }) => {
  const phase = faultPhase(fault.id)

  if (fault.integration === SERVICE_BUS_INTEGRATION) {
    const forwarded = valueOf(
      metrics,
      subMetricKey('service_bus_forwarded_in_phase', { fault: fault.id }),
      'value'
    )

    return `Fault ${subject(fault)}: toxic applied for the fault window; ${forwarded === undefined ? 'the forwarded count was not read' : `the gateway forwarded ${forwarded} messages during it`}`
  }

  const requests = stubRequestsIn({ metrics, fault, phase })
  const injected = valueOf(
    metrics,
    subMetricKey('stub_faults_injected', {
      integration: fault.integration,
      phase
    }),
    'count'
  )

  return requests === undefined || injected === undefined
    ? `Fault ${subject(fault)}: the stub's counters were not read`
    : `Fault ${subject(fault)}: injected ${injected} of ${requests} requests at the stub`
}

/**
 * States that a fault was not injected, so nothing was judged for it.
 *
 * @param {{ id: string }} fault - A fault.
 * @param {string} reason - Why, from `notInjectedReason`.
 * @returns {string} The line.
 */
export const notInjectedLine = (fault, reason) =>
  `Fault not injected: ${fault.id}: ${reason}; nothing judged`

/**
 * States the bounded-wait verdict.
 *
 * @param {{ fault: { id: string, integration: string }, verdict: ReturnType<typeof waitVerdict> }} options - The fault and its verdict.
 * @returns {string} The line.
 */
export const waitLine = ({ fault, verdict }) => {
  const label = `Bounded wait ${subject(fault)}`

  if (verdict.verdict === 'not measured') {
    return verdict.reason === NO_REQUESTS
      ? `${label}: ${NO_REQUESTS}: not measured`
      : `${label}: not measured: ${verdict.reason}`
  }

  return `${label}: slowest ${millisecondsText(verdict.maxMs)} against ${millisecondsText(verdict.limitMs)}: ${verdict.verdict}`
}

const perCallText = (value) => String(Number(value.toFixed(2)))

/**
 * States the bounded-retries verdict.
 *
 * @param {{ fault: { id: string, integration: string }, verdict: ReturnType<typeof retryVerdict> }} options - The fault and its verdict.
 * @returns {string} The line.
 */
export const retryLine = ({ fault, verdict }) => {
  const label = `Bounded retries ${subject(fault)}`

  if (verdict.verdict === 'not measured') {
    const deadLetters =
      verdict.deadLetters === undefined
        ? ''
        : `; dead letters in the fault: ${verdict.deadLetters}`

    return `${label}: not measured: ${verdict.reason}${deadLetters}`
  }

  return `${label}: ${verdict.stubRequests} stub requests for ${verdict.calls} calls, against ${verdict.allowed} allowed (${verdict.amplification} times the baseline's ${perCallText(verdict.perCallBaseline)} a call): ${verdict.verdict}`
}

const serviceBusOutcomeText = ({ deadLetters, drainSeconds }) =>
  `${countText(deadLetters, 'message')} dead-lettered, backlog ${drainSeconds === undefined ? 'did not drain' : `drained in ${drainSeconds}s`}`

/**
 * States the failure verdict: whether the caller failed cleanly or degraded as declared.
 *
 * @param {{ fault: { id: string, integration: string }, verdict: ReturnType<typeof outcomeVerdict> }} options - The fault and its verdict.
 * @returns {string} The line.
 */
export const outcomeLine = ({ fault, verdict }) => {
  const label = `Failure ${subject(fault)}`

  if (verdict.verdict === 'not measured') {
    return `${label}: ${verdict.reason}: not measured`
  }

  if (verdict.verdict === 'NOT AS DECLARED') {
    return `${label}: declared ${verdict.declared}: NOT AS DECLARED`
  }

  if (!CALLER_EVIDENCE[fault.integration].synchronous) {
    return `${label}: ${serviceBusOutcomeText(verdict)}: ${verdict.verdict}`
  }

  const failed = `${percentText(verdict.failedRate)} failed`
  const limit = millisecondsText(verdict.wait.limitMs)
  const detail = {
    absorbed: `wait bounded within ${limit}`,
    'failed cleanly': `every one answered within ${limit}`,
    UNCLEAN: (verdict.reasons ?? []).join(', ')
  }[verdict.verdict]

  return `${label}: ${failed}, ${detail}: ${verdict.verdict}`
}

/**
 * States the recovery verdict and how long recovery took.
 *
 * @param {{ fault: { id: string, integration: string }, verdict: ReturnType<typeof recoveryVerdict>, model: object }} options - The fault, its verdict and the traffic model.
 * @returns {string} The line.
 */
export const recoveryLine = ({ fault, verdict, model }) => {
  const label = `Recovery ${fault.id}`
  const { p95FactorOverBaseline, minSamples } = INTERIM_TARGETS.resilience
  const { clearedDuration } = model.resilience
  const drain =
    verdict.drained === undefined
      ? ''
      : verdict.drained
        ? `; backlog drained ${verdict.drainSeconds}s after the fault cleared`
        : `; backlog did not drain within ${clearedDuration}`

  if (verdict.verdict === 'not judged' && verdict.reason !== undefined) {
    return `${label}: not judged, ${verdict.reason}`
  }

  if (verdict.verdict === 'not judged') {
    return `${label}: not judged, fewer than ${minSamples} requests in a recovery step${drain}`
  }

  if (verdict.verdict === 'NOT RECOVERED') {
    return `${label}: NOT RECOVERED within ${clearedDuration} of the fault clearing${drain}`
  }

  return `${label}: recovered within ${verdict.stepsText} of the fault clearing (P95 within ${Math.round((p95FactorOverBaseline - 1) * PERCENT)}% of baseline and failures back to baseline in every scenario)${drain}`
}

/**
 * States the cascade verdict.
 *
 * @param {{ fault: { id: string }, verdict: ReturnType<typeof cascadeVerdict> }} options - The fault and its verdict.
 * @returns {string} The line.
 */
export const cascadeLine = ({ fault, verdict }) =>
  verdict.verdict === 'no cascade'
    ? `Cascade ${fault.id}: no cascade (${verdict.judged.join(', ')})`
    : `Cascade ${fault.id}: CASCADED: ${verdict.findings.join('; ')}`

const CRITERIA = ['wait', 'retries', 'outcome', 'recovery', 'cascade']
const CRITERION_NAMES = Object.freeze({
  wait: 'wait',
  retries: 'retries',
  outcome: 'failure',
  recovery: 'recovery',
  cascade: 'cascade'
})

const failingCriteria = (fault) =>
  CRITERIA.filter((criterion) => isFailingVerdict(fault[criterion]))

/**
 * Lists the verdicts that fail the run, each as the line that states it.
 *
 * @param {{ faults: Array<{ injected: { applied: boolean }, lines: Record<string, string>, wait: object, retries: object, outcome: object, recovery: object, cascade: object }> }} report - A resilience report.
 * @returns {string[]} One line for each failing verdict, in fault order.
 */
export const failedResilienceLines = (report) =>
  report.faults.flatMap((fault) =>
    failingCriteria(fault).map((criterion) => fault.lines[criterion])
  )

/**
 * Names the criteria that failed, for the outcome line.
 *
 * @param {{ faults: Array<{ id: string }> }} report - A resilience report.
 * @returns {string[]} For example `mdm-error wait`.
 */
export const failedCriteria = (report) =>
  report.faults.flatMap((fault) =>
    failingCriteria(fault).map(
      (criterion) => `${fault.id} ${CRITERION_NAMES[criterion]}`
    )
  )
