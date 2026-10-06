import { describe, expect, test } from 'vitest'

import { SHAPES, scenarioSetForShape } from '../config/design-target.js'
import { FAULT_CATALOGUE, INJECTION_CODES } from '../config/resilience.js'
import { subMetricKey } from '../config/thresholds.js'
import { resolveTrafficModel } from '../config/traffic.js'
import { kindsIn } from './design-target-summary.js'
import {
  INITIAL_CONTROL_STATE,
  cascadeLine,
  cascadeVerdict,
  counterDelta,
  failedResilienceLines,
  faultLine,
  faultOfPhase,
  injectionOf,
  isFailingVerdict,
  nextControlActions,
  notInjectedLine,
  outcomeLine,
  outcomeVerdict,
  recoveryLine,
  recoveryVerdict,
  retryLine,
  retryVerdict,
  toxicsCleared,
  waitLine,
  waitVerdict
} from './resilience.js'

const WATCH = 'reference-data-watch'
const model = resolveTrafficModel({})
const scenarioSet = scenarioSetForShape({ shape: SHAPES.RESILIENCE })
const faultNamed = (id) => FAULT_CATALOGUE.find((fault) => fault.id === id)
const MDM_ERROR = faultNamed('mdm-error')
const DEFRA_ID_ERROR = faultNamed('defra-id-error')
const BUS_RESET = faultNamed('azure-service-bus-reset')

const trend = (tags, values) => ({
  [subMetricKey('http_req_duration', tags)]: { values }
})
const rate = (tags, value) => ({
  [subMetricKey('http_req_failed', tags)]: { values: { rate: value } }
})
const counter = (metric, tags, count) => ({
  [subMetricKey(metric, tags)]: { values: { count } }
})
const gauge = (metric, tags, value) => ({
  [subMetricKey(metric, tags)]: { values: { value } }
})

const watchWindow = ({
  phase,
  requests,
  maxMs,
  failedRate,
  transport = 0
}) => ({
  ...trend(
    { scenario: WATCH, kind: 'api', phase },
    { count: requests, max: maxMs, 'p(95)': maxMs }
  ),
  ...rate({ scenario: WATCH, phase }, failedRate),
  ...counter('transport_errors', { scenario: WATCH, phase }, transport)
})

const mdmRetryMetrics = ({
  stubFault,
  calls,
  stubBaseline = 30,
  callsBaseline = 30
}) => ({
  ...counter(
    'stub_requests',
    { integration: 'mdm', phase: 'fault-mdm-error' },
    stubFault
  ),
  ...counter(
    'stub_requests',
    { integration: 'mdm', phase: 'baseline' },
    stubBaseline
  ),
  ...trend(
    { endpoint: 'reference-data-countries-uncached', phase: 'fault-mdm-error' },
    { count: calls }
  ),
  ...trend(
    { endpoint: 'reference-data-countries-uncached', phase: 'baseline' },
    { count: callsBaseline }
  )
})

describe('counterDelta', () => {
  test('gives the rise', () => {
    expect(counterDelta({ before: 10, after: 25 })).toBe(15)
  })

  test('never goes below 0 when a stub restarted', () => {
    expect(counterDelta({ before: 25, after: 3 })).toBe(0)
  })

  test.each([
    [null, 5],
    [5, null],
    [undefined, 5]
  ])('is null when a reading is missing (%s, %s)', (before, after) => {
    expect(counterDelta({ before, after })).toBeNull()
  })
})

describe('faultOfPhase', () => {
  test('finds the fault of a fault window and a cleared step', () => {
    expect(faultOfPhase('fault-mdm-error')).toEqual({
      id: 'mdm-error',
      window: 'fault'
    })
    expect(faultOfPhase('cleared-azure-service-bus-reset-3')).toEqual({
      id: 'azure-service-bus-reset',
      window: 'cleared'
    })
  })

  test.each(['baseline', 'warm-up', 'tail', null])(
    'finds none in %s',
    (phase) => {
      expect(faultOfPhase(phase)).toBeNull()
    }
  )
})

describe('nextControlActions', () => {
  const tick = (state, phase) => nextControlActions({ state, phase })

  test('records the starting readings on the first tick', () => {
    expect(tick(INITIAL_CONTROL_STATE, 'warm-up')).toEqual({
      state: { phase: 'warm-up' },
      actions: [{ type: 'record', phase: null }]
    })
  })

  test('does nothing while the phase is unchanged', () => {
    expect(tick({ phase: 'baseline' }, 'baseline').actions).toEqual([])
  })

  test('records the baseline then applies the first fault', () => {
    expect(tick({ phase: 'baseline' }, 'fault-mdm-error').actions).toEqual([
      { type: 'record', phase: 'baseline' },
      { type: 'apply', fault: 'mdm-error' }
    ])
  })

  test('records then clears when the fault window ends', () => {
    expect(
      tick({ phase: 'fault-mdm-error' }, 'cleared-mdm-error-1').actions
    ).toEqual([
      { type: 'record', phase: 'fault-mdm-error' },
      { type: 'clear', fault: 'mdm-error' }
    ])
  })

  test('records, clears nothing and applies nothing between cleared steps', () => {
    expect(
      tick({ phase: 'cleared-mdm-error-1' }, 'cleared-mdm-error-2').actions
    ).toEqual([{ type: 'record', phase: 'cleared-mdm-error-1' }])
  })

  test('records the last cleared step then applies the next fault, in that order', () => {
    expect(
      tick({ phase: 'cleared-mdm-error-4' }, 'fault-defra-id-slow').actions
    ).toEqual([
      { type: 'record', phase: 'cleared-mdm-error-4' },
      { type: 'apply', fault: 'defra-id-slow' }
    ])
  })

  test('records the last cleared step on the way to the tail', () => {
    expect(tick({ phase: 'cleared-mdm-error-4' }, 'tail').actions).toEqual([
      { type: 'record', phase: 'cleared-mdm-error-4' }
    ])
  })

  test('watches the backlog on every tick of a Service Bus cleared step only', () => {
    expect(
      tick(
        { phase: 'cleared-azure-service-bus-reset-2' },
        'cleared-azure-service-bus-reset-2'
      ).actions
    ).toEqual([{ type: 'watch-backlog', fault: 'azure-service-bus-reset' }])
    expect(
      tick(
        { phase: 'fault-azure-service-bus-reset' },
        'cleared-azure-service-bus-reset-1'
      ).actions
    ).toEqual([
      { type: 'record', phase: 'fault-azure-service-bus-reset' },
      { type: 'clear', fault: 'azure-service-bus-reset' },
      { type: 'watch-backlog', fault: 'azure-service-bus-reset' }
    ])
    expect(
      tick({ phase: 'cleared-mdm-error-2' }, 'cleared-mdm-error-2').actions
    ).toEqual([])
  })
})

describe('injectionOf', () => {
  test('reads an applied fault', () => {
    const metrics = gauge(
      'fault_injection_applied',
      { fault: 'mdm-error' },
      INJECTION_CODES.APPLIED
    )

    expect(
      injectionOf({ metrics, fault: MDM_ERROR, environment: 'local' })
    ).toEqual({
      applied: true,
      code: 1,
      reason: null
    })
  })

  test('words why a stub predating faults was not injected', () => {
    const metrics = gauge(
      'fault_injection_applied',
      { fault: 'defra-id-error' },
      INJECTION_CODES.STUB_PREDATES_FAULTS
    )

    expect(
      injectionOf({ metrics, fault: DEFRA_ID_ERROR, environment: 'local' })
        .reason
    ).toBe('the stub predates fault injection (GET /faults answered 404)')
  })

  test('treats a fault the controller never reached as not injected', () => {
    expect(
      injectionOf({ metrics: {}, fault: MDM_ERROR, environment: 'local' })
        .applied
    ).toBe(false)
  })
})

describe('waitVerdict', () => {
  test('is bounded when the slowest request answered within the limit', () => {
    const metrics = watchWindow({
      phase: 'fault-mdm-error',
      requests: 31,
      maxMs: 812,
      failedRate: 0
    })

    expect(waitVerdict({ metrics, fault: MDM_ERROR })).toMatchObject({
      verdict: 'bounded',
      maxMs: 812,
      limitMs: 30_000
    })
  })

  test('is UNBOUNDED when a request waited the 60 second timeout', () => {
    const metrics = watchWindow({
      phase: 'fault-mdm-error',
      requests: 31,
      maxMs: 60_000,
      failedRate: 1
    })

    expect(waitVerdict({ metrics, fault: MDM_ERROR }).verdict).toBe('UNBOUNDED')
  })

  test('is not measured with no requests in the fault window', () => {
    expect(waitVerdict({ metrics: {}, fault: MDM_ERROR })).toMatchObject({
      verdict: 'not measured',
      reason: 'no requests in the fault window'
    })
  })

  test('reads Defra ID from the sign-in hops', () => {
    const metrics = trend(
      { endpoint: 'sign-in', phase: 'fault-defra-id-error' },
      { count: 20, max: 40_000 }
    )

    expect(waitVerdict({ metrics, fault: DEFRA_ID_ERROR }).verdict).toBe(
      'UNBOUNDED'
    )
  })

  test('is not measured for Service Bus, which no request waits on', () => {
    expect(waitVerdict({ metrics: {}, fault: BUS_RESET })).toMatchObject({
      verdict: 'not measured',
      reason:
        "the gateway's wait is not visible to a request; the backlog and dead letters stand in"
    })
  })
})

describe('retryVerdict', () => {
  test('is bounded within four times the baseline calls, plus one', () => {
    const verdict = retryVerdict({
      metrics: mdmRetryMetrics({ stubFault: 31, calls: 30 }),
      fault: MDM_ERROR
    })

    expect(verdict).toMatchObject({
      verdict: 'bounded',
      stubRequests: 31,
      calls: 30,
      allowed: 121,
      perCallBaseline: 1
    })
  })

  test('is UNBOUNDED when 400 stub requests answered 30 calls', () => {
    expect(
      retryVerdict({
        metrics: mdmRetryMetrics({ stubFault: 400, calls: 30 }),
        fault: MDM_ERROR
      }).verdict
    ).toBe('UNBOUNDED')
  })

  test('scales the bound by what a call cost in the baseline', () => {
    const verdict = retryVerdict({
      metrics: mdmRetryMetrics({
        stubFault: 240,
        calls: 30,
        stubBaseline: 60,
        callsBaseline: 30
      }),
      fault: MDM_ERROR
    })

    expect(verdict).toMatchObject({
      verdict: 'bounded',
      allowed: 241,
      perCallBaseline: 2
    })
  })

  test('counts one request a call when the baseline had none', () => {
    expect(
      retryVerdict({
        metrics: mdmRetryMetrics({
          stubFault: 10,
          calls: 10,
          stubBaseline: 0,
          callsBaseline: 0
        }),
        fault: MDM_ERROR
      }).perCallBaseline
    ).toBe(1)
  })

  test('is not measured with no calls that needed the dependency', () => {
    expect(
      retryVerdict({
        metrics: mdmRetryMetrics({ stubFault: 5, calls: 0 }),
        fault: MDM_ERROR
      }).verdict
    ).toBe('not measured')
  })

  test('is not measured when the stub reported no count', () => {
    expect(retryVerdict({ metrics: {}, fault: MDM_ERROR }).verdict).toBe(
      'not measured'
    )
  })

  test('counts Defra ID calls as sign-in pages', () => {
    const metrics = {
      ...counter(
        'stub_requests',
        { integration: 'defra-id', phase: 'fault-defra-id-error' },
        90
      ),
      ...counter(
        'stub_requests',
        { integration: 'defra-id', phase: 'baseline' },
        60
      ),
      ...counter(
        'page_requests',
        { traffic_class: 'sign-in', phase: 'fault-defra-id-error' },
        30
      ),
      ...counter(
        'page_requests',
        { traffic_class: 'sign-in', phase: 'baseline' },
        20
      )
    }

    expect(retryVerdict({ metrics, fault: DEFRA_ID_ERROR })).toMatchObject({
      verdict: 'bounded',
      perCallBaseline: 3,
      allowed: 361
    })
  })

  test('is not measured for Service Bus, whose retries the SQS redrive bounds', () => {
    const metrics = gauge(
      'resilience_dead_letters',
      { fault: 'azure-service-bus-reset' },
      4
    )

    expect(retryVerdict({ metrics, fault: BUS_RESET })).toMatchObject({
      verdict: 'not measured',
      deadLetters: 4
    })
  })
})

describe('outcomeVerdict', () => {
  const window = (overrides) =>
    watchWindow({
      phase: 'fault-mdm-error',
      requests: 31,
      maxMs: 812,
      failedRate: 0,
      ...overrides
    })

  test('is absorbed when failures are under 1% and the wait is bounded', () => {
    expect(
      outcomeVerdict({ metrics: window({ failedRate: 0 }), fault: MDM_ERROR })
        .verdict
    ).toBe('absorbed')
  })

  test('is failed cleanly when requests failed but every one answered in time', () => {
    expect(
      outcomeVerdict({
        metrics: window({ failedRate: 0.47 }),
        fault: MDM_ERROR
      }).verdict
    ).toBe('failed cleanly')
  })

  test('is UNCLEAN when a request failed below HTTP', () => {
    const verdict = outcomeVerdict({
      metrics: window({ failedRate: 0.5, transport: 2 }),
      fault: MDM_ERROR
    })

    expect(verdict.verdict).toBe('UNCLEAN')
    expect(verdict.reasons).toEqual(['2 requests failed below HTTP'])
  })

  test('ignores transport errors that are not the caller own', () => {
    const metrics = {
      ...window({ failedRate: 0.5, transport: 0 }),
      ...counter('transport_errors', { phase: 'fault-mdm-error' }, 3)
    }

    expect(outcomeVerdict({ metrics, fault: MDM_ERROR }).verdict).toBe(
      'failed cleanly'
    )
  })

  test('is UNCLEAN when the caller own transport errors are counted', () => {
    const metrics = {
      ...window({ failedRate: 0.5, transport: 2 }),
      ...counter('transport_errors', { phase: 'fault-mdm-error' }, 0)
    }

    expect(outcomeVerdict({ metrics, fault: MDM_ERROR }).verdict).toBe(
      'UNCLEAN'
    )
  })

  test('counts a Defra ID fault transport errors on the sign-in endpoint', () => {
    const metrics = {
      ...trend(
        { endpoint: 'sign-in', phase: 'fault-defra-id-error' },
        { count: 20, max: 500, 'p(95)': 500 }
      ),
      ...rate({ endpoint: 'sign-in', phase: 'fault-defra-id-error' }, 0.5),
      ...counter(
        'transport_errors',
        { endpoint: 'sign-in', phase: 'fault-defra-id-error' },
        2
      )
    }

    expect(outcomeVerdict({ metrics, fault: DEFRA_ID_ERROR }).verdict).toBe(
      'UNCLEAN'
    )
  })

  test('is NOT AS DECLARED when the outcome is not the declared one', () => {
    const verdict = outcomeVerdict({
      metrics: window({ failedRate: 0.47 }),
      fault: MDM_ERROR,
      declarations: { 'mdm-error': 'absorbed' }
    })

    expect(verdict).toMatchObject({
      verdict: 'NOT AS DECLARED',
      declared: 'absorbed'
    })
    expect(outcomeLine({ fault: MDM_ERROR, verdict })).toBe(
      'Failure mdm-error (reference-data): declared absorbed: NOT AS DECLARED'
    )
  })

  test('passes when the outcome is the declared one', () => {
    expect(
      outcomeVerdict({
        metrics: window({ failedRate: 0.47 }),
        fault: MDM_ERROR,
        declarations: { 'mdm-error': 'failed cleanly' }
      }).verdict
    ).toBe('failed cleanly')
  })

  test('stays not measured when there is nothing to hold to the declaration', () => {
    expect(
      outcomeVerdict({
        metrics: {},
        fault: MDM_ERROR,
        declarations: { 'mdm-error': 'absorbed' }
      }).verdict
    ).toBe('not measured')
  })

  test('is UNCLEAN when the wait was unbounded', () => {
    const verdict = outcomeVerdict({
      metrics: window({ failedRate: 0, maxMs: 60_000 }),
      fault: MDM_ERROR
    })

    expect(verdict.verdict).toBe('UNCLEAN')
    expect(verdict.reasons).toEqual(['slowest 60000ms over 30000ms'])
  })

  test('is not measured with no requests', () => {
    expect(outcomeVerdict({ metrics: {}, fault: MDM_ERROR }).verdict).toBe(
      'not measured'
    )
  })

  test('is failed cleanly for Service Bus when messages dead-lettered', () => {
    const metrics = {
      ...gauge(
        'resilience_dead_letters',
        { fault: 'azure-service-bus-reset' },
        3
      ),
      ...gauge(
        'resilience_backlog_drained_seconds',
        { fault: 'azure-service-bus-reset' },
        12
      )
    }

    expect(outcomeVerdict({ metrics, fault: BUS_RESET })).toMatchObject({
      verdict: 'failed cleanly',
      deadLetters: 3
    })
  })

  test('is absorbed for Service Bus when nothing dead-lettered and the backlog drained', () => {
    const metrics = {
      ...gauge(
        'resilience_dead_letters',
        { fault: 'azure-service-bus-reset' },
        0
      ),
      ...gauge(
        'resilience_backlog_drained_seconds',
        { fault: 'azure-service-bus-reset' },
        12
      )
    }

    expect(outcomeVerdict({ metrics, fault: BUS_RESET }).verdict).toBe(
      'absorbed'
    )
  })

  test('is not measured for Service Bus when the backlog never drained', () => {
    const metrics = gauge(
      'resilience_dead_letters',
      { fault: 'azure-service-bus-reset' },
      0
    )

    expect(outcomeVerdict({ metrics, fault: BUS_RESET }).verdict).toBe(
      'not measured'
    )
  })
})

const pairsOf = () => [
  ...Object.entries(scenarioSet).flatMap(([scenario, { endpoints }]) =>
    kindsIn(endpoints).map((kind) => ({ scenario, kind }))
  ),
  { scenario: WATCH, kind: 'api' }
]

const recoveryMetrics = ({
  baselineP95 = 100,
  stepP95s,
  stepFailedRate = 0
}) => {
  const scenarios = [...Object.keys(scenarioSet), WATCH]

  return {
    ...Object.assign(
      {},
      ...pairsOf().map(({ scenario, kind }) =>
        trend(
          { scenario, kind, phase: 'baseline' },
          { count: 50, 'p(95)': baselineP95 }
        )
      ),
      ...pairsOf().flatMap(({ scenario, kind }) =>
        stepP95s.map((p95, index) =>
          trend(
            { scenario, kind, phase: `cleared-mdm-error-${index + 1}` },
            { count: 50, 'p(95)': p95 }
          )
        )
      ),
      ...scenarios.map((scenario) => rate({ scenario, phase: 'baseline' }, 0)),
      ...scenarios.flatMap((scenario) =>
        stepP95s.map((_, index) =>
          rate(
            { scenario, phase: `cleared-mdm-error-${index + 1}` },
            stepFailedRate
          )
        )
      )
    )
  }
}

describe('recoveryVerdict', () => {
  const judge = (options) =>
    recoveryVerdict({
      metrics: recoveryMetrics(options),
      fault: MDM_ERROR,
      scenarioSet,
      model
    })

  test('recovers within the first step when every step is within', () => {
    expect(judge({ stepP95s: [105, 100, 100, 100] })).toMatchObject({
      verdict: 'recovered',
      stepsText: '30s'
    })
  })

  test('recovers within 60s when the first step is still over', () => {
    expect(judge({ stepP95s: [400, 105, 100, 100] })).toMatchObject({
      verdict: 'recovered',
      stepsText: '1m'
    })
  })

  test('is NOT RECOVERED when the last step is over', () => {
    expect(judge({ stepP95s: [105, 100, 100, 400] }).verdict).toBe(
      'NOT RECOVERED'
    )
  })

  test('is NOT RECOVERED on a late relapse after an early recovery', () => {
    expect(judge({ stepP95s: [100, 100, 400, 100] }).stepsText).toBe('2m')
    expect(judge({ stepP95s: [100, 100, 400, 400] }).verdict).toBe(
      'NOT RECOVERED'
    )
  })

  test('is NOT RECOVERED when failures stay above both 1% and the baseline', () => {
    expect(
      judge({ stepP95s: [100, 100, 100, 100], stepFailedRate: 0.2 }).verdict
    ).toBe('NOT RECOVERED')
  })

  test('is not judged when no pair has enough requests', () => {
    const metrics = recoveryMetrics({ stepP95s: [100, 100, 100, 100] })

    for (const value of Object.values(metrics)) {
      if (value.values.count !== undefined) {
        value.values.count = 3
      }
    }

    expect(
      recoveryVerdict({ metrics, fault: MDM_ERROR, scenarioSet, model }).verdict
    ).toBe('not judged')
  })

  test('also needs the Service Bus backlog to drain', () => {
    const drained = {
      ...recoveryMetrics({ stepP95s: [100, 100, 100, 100] }),
      ...gauge(
        'resilience_backlog_drained_seconds',
        { fault: 'azure-service-bus-reset' },
        12
      )
    }
    const stepsOnly = Object.fromEntries(
      Object.entries(recoveryMetrics({ stepP95s: [100, 100, 100, 100] })).map(
        ([key, value]) => [
          key.replaceAll('mdm-error', 'azure-service-bus-reset'),
          value
        ]
      )
    )
    const busFault = { ...BUS_RESET }

    expect(
      recoveryVerdict({
        metrics: { ...stepsOnly, ...drained },
        fault: busFault,
        scenarioSet,
        model
      })
    ).toMatchObject({ verdict: 'recovered', drained: true, drainSeconds: 12 })
    expect(
      recoveryVerdict({
        metrics: stepsOnly,
        fault: busFault,
        scenarioSet,
        model
      })
    ).toMatchObject({ verdict: 'NOT RECOVERED', drained: false })
  })
})

describe('recoveryVerdict for a Service Bus backlog that was never read', () => {
  const busStepsOnly = Object.fromEntries(
    Object.entries(recoveryMetrics({ stepP95s: [100, 100, 100, 100] })).map(
      ([key, value]) => [
        key.replaceAll('mdm-error', 'azure-service-bus-reset'),
        value
      ]
    )
  )
  const judge = (metrics) =>
    recoveryVerdict({ metrics, fault: BUS_RESET, scenarioSet, model })

  test('is not judged when the backlog depth could not be read when the fault was applied', () => {
    const metrics = {
      ...busStepsOnly,
      ...gauge(
        'resilience_backlog_unread',
        { fault: 'azure-service-bus-reset' },
        1
      )
    }

    expect(judge(metrics)).toMatchObject({
      verdict: 'not judged',
      reason: 'backlog depth could not be read when the fault was applied',
      drained: false
    })
    expect(
      recoveryLine({ fault: BUS_RESET, verdict: judge(metrics), model })
    ).toBe(
      'Recovery azure-service-bus-reset: not judged, backlog depth could not be read when the fault was applied'
    )
  })

  test('does not fail the run', () => {
    const recovery = judge({
      ...busStepsOnly,
      ...gauge(
        'resilience_backlog_unread',
        { fault: 'azure-service-bus-reset' },
        1
      )
    })
    const report = {
      faults: [
        {
          id: 'azure-service-bus-reset',
          wait: { verdict: 'not measured' },
          retries: { verdict: 'not measured' },
          outcome: { verdict: 'not measured' },
          recovery,
          cascade: { verdict: 'no cascade' },
          lines: { recovery: 'recovery line' }
        }
      ]
    }

    expect(isFailingVerdict(recovery)).toBe(false)
    expect(failedResilienceLines(report)).toEqual([])
  })

  test('is still NOT RECOVERED when a baseline was read and the backlog never drained', () => {
    expect(judge(busStepsOnly)).toMatchObject({
      verdict: 'NOT RECOVERED',
      drained: false
    })
  })
})

describe('cascadeVerdict', () => {
  const journeyWindow = ({ scenario, kind, p95, phase }) =>
    trend({ scenario, kind, phase }, { count: 40, 'p(95)': p95, 'p(99)': p95 })

  test('states a scenario that failed once, whatever its kinds', () => {
    const phase = 'fault-mdm-error'
    const metrics = {
      ...journeyWindow({
        scenario: 'live-animals',
        kind: 'page',
        p95: 800,
        phase
      }),
      ...journeyWindow({
        scenario: 'live-animals',
        kind: 'api',
        p95: 100,
        phase
      }),
      ...rate({ scenario: 'live-animals', phase }, 0.03)
    }

    expect(
      cascadeVerdict({ metrics, fault: MDM_ERROR, scenarioSet }).findings
    ).toEqual(['live-animals failed 3% against 1%'])
  })

  test('names a journey that went over while mdm was faulted', () => {
    const metrics = journeyWindow({
      scenario: 'high-risk-plants',
      kind: 'page',
      p95: 2410,
      phase: 'fault-mdm-error'
    })

    expect(
      cascadeVerdict({ metrics, fault: MDM_ERROR, scenarioSet })
    ).toMatchObject({
      verdict: 'CASCADED',
      findings: ['high-risk-plants page P95 2410ms against 2000ms']
    })
  })

  test('finds no cascade when everything judged stayed within its limits', () => {
    const metrics = journeyWindow({
      scenario: 'live-animals',
      kind: 'page',
      p95: 800,
      phase: 'fault-mdm-error'
    })

    expect(
      cascadeVerdict({ metrics, fault: MDM_ERROR, scenarioSet })
    ).toMatchObject({
      verdict: 'no cascade',
      judged: [
        'live-animals',
        'high-risk-plants',
        'ins-front-door',
        'ins-address-book',
        'sign-in',
        'Service Bus'
      ]
    })
  })

  test('catches sign-in failures and dead letters', () => {
    const metrics = {
      ...rate({ endpoint: 'sign-in', phase: 'fault-mdm-error' }, 0.03),
      ...gauge('resilience_dead_letters', { fault: 'mdm-error' }, 2)
    }

    expect(
      cascadeVerdict({ metrics, fault: MDM_ERROR, scenarioSet }).findings
    ).toEqual(['sign-in failed 3% against 1%', '2 messages dead-lettered'])
  })

  test('does not judge a scenario with no requests', () => {
    expect(
      cascadeVerdict({ metrics: {}, fault: MDM_ERROR, scenarioSet }).verdict
    ).toBe('no cascade')
  })

  test('judges only the reference-data watch and dead letters for Defra ID', () => {
    const metrics = {
      ...journeyWindow({
        scenario: 'high-risk-plants',
        kind: 'page',
        p95: 9000,
        phase: 'fault-defra-id-error'
      }),
      ...watchWindow({
        phase: 'fault-defra-id-error',
        requests: 10,
        maxMs: 150,
        failedRate: 0
      })
    }
    const verdict = cascadeVerdict({
      metrics,
      fault: DEFRA_ID_ERROR,
      scenarioSet
    })

    expect(verdict.verdict).toBe('no cascade')
    expect(verdict.judged).toEqual(['reference-data watch', 'Service Bus'])
  })

  test('judges the reference-data watch while Service Bus is faulted', () => {
    const metrics = trend(
      { scenario: WATCH, kind: 'api', phase: 'fault-azure-service-bus-reset' },
      { count: 10, 'p(95)': 900 }
    )

    expect(
      cascadeVerdict({ metrics, fault: BUS_RESET, scenarioSet }).findings
    ).toEqual(['reference-data watch P95 900ms against 200ms'])
  })
})

describe('toxicsCleared', () => {
  test('is cleared when every removal answered 204 or 404', () => {
    expect(toxicsCleared([204, 404, 204])).toBe(true)
  })

  test.each([[500], [200], [null]])(
    'is not cleared when a removal answered %s',
    (status) => {
      expect(toxicsCleared([204, status, 404])).toBe(false)
    }
  )
})

describe('isFailingVerdict', () => {
  test.each([
    'UNBOUNDED',
    'UNCLEAN',
    'NOT AS DECLARED',
    'NOT RECOVERED',
    'CASCADED'
  ])('%s fails the run', (verdict) => {
    expect(isFailingVerdict({ verdict })).toBe(true)
  })

  test.each([
    'bounded',
    'absorbed',
    'failed cleanly',
    'recovered',
    'no cascade',
    'not measured',
    'not judged'
  ])('%s does not', (verdict) => {
    expect(isFailingVerdict({ verdict })).toBe(false)
  })
})

describe('lines', () => {
  const metrics = {
    ...counter(
      'stub_requests',
      { integration: 'mdm', phase: 'fault-mdm-error' },
      31
    ),
    ...counter(
      'stub_faults_injected',
      { integration: 'mdm', phase: 'fault-mdm-error' },
      14
    )
  }

  test('states the injection at the stub', () => {
    expect(faultLine({ fault: MDM_ERROR, metrics })).toBe(
      'Fault mdm-error (reference-data): injected 14 of 31 requests at the stub'
    )
  })

  test('states a toxic for Service Bus', () => {
    expect(
      faultLine({
        fault: BUS_RESET,
        metrics: gauge(
          'service_bus_forwarded_in_phase',
          { fault: 'azure-service-bus-reset' },
          12
        )
      })
    ).toBe(
      'Fault azure-service-bus-reset (dynamics gateway): toxic applied for the fault window; the gateway forwarded 12 messages during it'
    )
  })

  test('states a bounded wait', () => {
    expect(
      waitLine({
        fault: MDM_ERROR,
        verdict: { verdict: 'bounded', maxMs: 812, limitMs: 30_000 }
      })
    ).toBe(
      'Bounded wait mdm-error (reference-data): slowest 812ms against 30000ms: bounded'
    )
  })

  test('states an unbounded wait, and the Service Bus wait that is not measured', () => {
    expect(
      waitLine({
        fault: MDM_ERROR,
        verdict: { verdict: 'UNBOUNDED', maxMs: 60_001, limitMs: 30_000 }
      })
    ).toBe(
      'Bounded wait mdm-error (reference-data): slowest 60001ms against 30000ms: UNBOUNDED'
    )
    expect(
      waitLine({
        fault: BUS_RESET,
        verdict: waitVerdict({ metrics: {}, fault: BUS_RESET })
      })
    ).toBe(
      "Bounded wait azure-service-bus-reset (dynamics gateway): not measured: the gateway's wait is not visible to a request; the backlog and dead letters stand in"
    )
  })

  test('states bounded retries', () => {
    expect(
      retryLine({
        fault: MDM_ERROR,
        verdict: retryVerdict({
          metrics: mdmRetryMetrics({ stubFault: 31, calls: 30 }),
          fault: MDM_ERROR
        })
      })
    ).toBe(
      "Bounded retries mdm-error (reference-data): 31 stub requests for 30 calls, against 121 allowed (4 times the baseline's 1 a call): bounded"
    )
  })

  test('states the Service Bus retries that are not measured', () => {
    expect(
      retryLine({
        fault: BUS_RESET,
        verdict: retryVerdict({
          metrics: gauge(
            'resilience_dead_letters',
            { fault: 'azure-service-bus-reset' },
            4
          ),
          fault: BUS_RESET
        })
      })
    ).toBe(
      "Bounded retries azure-service-bus-reset (dynamics gateway): not measured: the gateway's retries are bounded by the SQS redrive (maxReceiveCount); dead letters in the fault: 4"
    )
  })

  test('states a clean failure', () => {
    expect(
      outcomeLine({
        fault: MDM_ERROR,
        verdict: outcomeVerdict({
          metrics: watchWindow({
            phase: 'fault-mdm-error',
            requests: 31,
            maxMs: 812,
            failedRate: 0.47
          }),
          fault: MDM_ERROR
        })
      })
    ).toBe(
      'Failure mdm-error (reference-data): 47% failed, every one answered within 30000ms: failed cleanly'
    )
  })

  test('states an unclean failure with its reasons', () => {
    expect(
      outcomeLine({
        fault: MDM_ERROR,
        verdict: outcomeVerdict({
          metrics: watchWindow({
            phase: 'fault-mdm-error',
            requests: 31,
            maxMs: 60_000,
            failedRate: 1,
            transport: 4
          }),
          fault: MDM_ERROR
        })
      })
    ).toBe(
      'Failure mdm-error (reference-data): 100% failed, slowest 60000ms over 30000ms, 4 requests failed below HTTP: UNCLEAN'
    )
  })

  test('states a Service Bus outcome', () => {
    expect(
      outcomeLine({
        fault: BUS_RESET,
        verdict: {
          verdict: 'failed cleanly',
          deadLetters: 3,
          drainSeconds: 12
        }
      })
    ).toBe(
      'Failure azure-service-bus-reset (dynamics gateway): 3 messages dead-lettered, backlog drained in 12s: failed cleanly'
    )
  })

  test('states recovery and how long it took', () => {
    expect(
      recoveryLine({
        fault: MDM_ERROR,
        verdict: { verdict: 'recovered', stepsText: '30s' },
        model
      })
    ).toBe(
      'Recovery mdm-error: recovered within 30s of the fault clearing (P95 within 10% of baseline and failures back to baseline in every scenario)'
    )
    expect(
      recoveryLine({
        fault: MDM_ERROR,
        verdict: { verdict: 'NOT RECOVERED' },
        model
      })
    ).toBe('Recovery mdm-error: NOT RECOVERED within 2m of the fault clearing')
  })

  test('adds the backlog drain to a Service Bus recovery', () => {
    expect(
      recoveryLine({
        fault: BUS_RESET,
        verdict: {
          verdict: 'NOT RECOVERED',
          drained: false,
          drainSeconds: null
        },
        model
      })
    ).toBe(
      'Recovery azure-service-bus-reset: NOT RECOVERED within 2m of the fault clearing; backlog did not drain within 2m'
    )
  })

  test('states no cascade and a cascade', () => {
    expect(
      cascadeLine({
        fault: MDM_ERROR,
        verdict: {
          verdict: 'no cascade',
          judged: [
            'live-animals',
            'high-risk-plants',
            'ins-front-door',
            'ins-address-book',
            'sign-in',
            'Service Bus'
          ],
          findings: []
        }
      })
    ).toBe(
      'Cascade mdm-error: no cascade (live-animals, high-risk-plants, ins-front-door, ins-address-book, sign-in, Service Bus)'
    )
    expect(
      cascadeLine({
        fault: MDM_ERROR,
        verdict: {
          verdict: 'CASCADED',
          judged: [],
          findings: ['high-risk-plants page P95 2410ms against 2000ms']
        }
      })
    ).toBe(
      'Cascade mdm-error: CASCADED: high-risk-plants page P95 2410ms against 2000ms'
    )
  })

  test('states a fault that was not injected', () => {
    expect(
      notInjectedLine(
        DEFRA_ID_ERROR,
        'the stub predates fault injection (GET /faults answered 404)'
      )
    ).toBe(
      'Fault not injected: defra-id-error: the stub predates fault injection (GET /faults answered 404); nothing judged'
    )
  })
})

describe('failedResilienceLines', () => {
  test('lists each failing verdict as its line and skips the rest', () => {
    const report = {
      faults: [
        {
          id: 'mdm-error',
          wait: { verdict: 'UNBOUNDED' },
          retries: { verdict: 'bounded' },
          outcome: { verdict: 'UNCLEAN' },
          recovery: { verdict: 'recovered' },
          cascade: { verdict: 'no cascade' },
          lines: {
            wait: 'wait line',
            retries: 'retries line',
            outcome: 'outcome line',
            recovery: 'recovery line',
            cascade: 'cascade line'
          }
        },
        {
          id: 'defra-id-error',
          wait: { verdict: 'not judged' },
          retries: { verdict: 'not judged' },
          outcome: { verdict: 'not judged' },
          recovery: { verdict: 'not judged' },
          cascade: { verdict: 'not judged' },
          lines: {}
        }
      ]
    }

    expect(failedResilienceLines(report)).toEqual(['wait line', 'outcome line'])
  })
})
