import { describe, expect, test } from 'vitest'

import {
  DESIGN_TARGETS,
  SCENARIO_LENGTH_PROFILES,
  SHAPES,
  phaseSchedule,
  scenarioSetForShape
} from '../config/design-target.js'
import { SCENARIOS } from '../config/smoke.js'
import { subMetricKey } from '../config/thresholds.js'
import { resolveTrafficModel } from '../config/traffic.js'
import {
  achievedBurst,
  achievedBurstLine,
  achievedFrontDoor,
  achievedFrontDoorLine,
  achievedJourney,
  achievedJourneyLine,
  achievedSpike,
  averageLoadHours,
  comparisonOutcomeLine,
  designTargetHtml,
  designTargetReport,
  designTargetText,
  driftLine,
  endpointLine,
  endpointRows,
  failedComparisonLines,
  hourLine,
  hourTarget,
  p95Comparison,
  phaseSeconds,
  reauthenticationLines,
  reauthenticationTrafficLine,
  reauthentications,
  recoveryLine,
  relativeBurstVerdicts,
  relativeLine,
  relativeOutcomeLine,
  requestMixLine,
  signInCascadeLine,
  spikeLine,
  transportErrorLine,
  valueOf
} from './design-target-summary.js'

const metric = (values) => ({ values })
const duration = (tags, values) => [
  subMetricKey('http_req_duration', tags),
  metric(values)
]

const SCENARIO_SET = {
  'live-animals': { endpoints: ['animals-origin', 'animals-backend-list'] },
  'ins-front-door': { endpoints: ['sign-in', 'ins-dashboard'] }
}

describe('valueOf and phaseSeconds', () => {
  test('reads one statistic of a metric', () => {
    expect(valueOf({ a: metric({ count: 3 }) }, 'a', 'count')).toBe(3)
    expect(valueOf({}, 'a', 'count')).toBeUndefined()
  })

  test('gives a phase its length', () => {
    expect(
      phaseSeconds(
        [{ phase: 'hold', startSeconds: 10, endSeconds: 70 }],
        'hold'
      )
    ).toBe(60)
  })
})

describe('achievedJourney', () => {
  const metrics = Object.fromEntries([
    [
      subMetricKey('notifications_started', {
        scenario: 'live-animals',
        phase: 'hold'
      }),
      metric({ count: 87 })
    ],
    [
      subMetricKey('page_requests', { frontend: 'animals', phase: 'hold' }),
      metric({ count: 3528 })
    ],
    [
      subMetricKey('session_seconds', {
        scenario: 'live-animals',
        phase: 'hold'
      }),
      metric({ avg: 1200, count: 130 })
    ]
  ])
  const achieved = achievedJourney({
    metrics,
    scenario: 'live-animals',
    phase: 'hold',
    seconds: 7200
  })

  test('works out notifications an hour from the started count', () => {
    expect(achieved.notificationsPerHour).toBe(43.5)
  })

  test('works out the frontend RPS and derives the backend RPS from it', () => {
    expect(achieved.frontendRps).toBeCloseTo(0.49, 2)
    expect(achieved.backendRps).toBe(achieved.frontendRps)
  })

  test('works out concurrent users as session seconds over the phase length', () => {
    expect(achieved.concurrentUsers).toBeCloseTo(21.67, 2)
  })

  test('is zero users with no samples', () => {
    expect(
      achievedJourney({
        metrics: {},
        scenario: 'live-animals',
        phase: 'hold',
        seconds: 60
      }).concurrentUsers
    ).toBe(0)
  })
})

describe('achievedFrontDoor and achievedBurst', () => {
  test('works out sign-ins, core RPS, users and the dashboard share', () => {
    const metrics = {
      [subMetricKey('page_requests', {
        traffic_class: 'sign-in',
        phase: 'hold'
      })]: metric({ count: 400 }),
      [subMetricKey('page_requests', { frontend: 'ins', phase: 'hold' })]:
        metric({ count: 3000 }),
      [subMetricKey('session_seconds', { phase: 'hold' })]: metric({
        avg: 300,
        count: 1200
      }),
      [subMetricKey('dashboard_read_share', { phase: 'hold' })]: metric({
        rate: 0.248
      })
    }

    expect(
      achievedFrontDoor({ metrics, phase: 'hold', seconds: 7200 })
    ).toEqual({
      signInsPerHour: 200,
      coreRps: 3000 / 7200,
      concurrentUsers: 50,
      dashboardReadShare: 0.248
    })
  })

  test("works out each frontend's page rate in the burst minute", () => {
    const metrics = {
      [subMetricKey('page_requests', { frontend: 'animals', phase: 'burst' })]:
        metric({ count: 44 }),
      [subMetricKey('page_requests', { frontend: 'plants', phase: 'burst' })]:
        metric({ count: 45 })
    }

    expect(achievedBurst({ metrics, seconds: 60 })).toEqual({
      animals: 44 / 60,
      plants: 0.75,
      ins: 0
    })
  })
})

describe('relativeBurstVerdicts', () => {
  const metrics = Object.fromEntries([
    duration(
      { scenario: 'live-animals', kind: 'page', phase: 'peak' },
      { 'p(95)': 300, count: 500 }
    ),
    duration(
      { scenario: 'live-animals', kind: 'page', phase: 'burst' },
      { 'p(95)': 410, count: 40 }
    ),
    duration(
      { scenario: 'live-animals', kind: 'api', phase: 'peak' },
      { 'p(95)': 50, count: 20 }
    ),
    duration(
      { scenario: 'live-animals', kind: 'api', phase: 'burst' },
      { 'p(95)': 130, count: 12 }
    ),
    duration(
      { scenario: 'ins-front-door', kind: 'page', phase: 'peak' },
      { 'p(95)': 100, count: 200 }
    ),
    duration(
      { scenario: 'ins-front-door', kind: 'page', phase: 'burst' },
      { 'p(95)': 900, count: 6 }
    )
  ])
  const verdicts = relativeBurstVerdicts({
    metrics,
    scenarioSet: SCENARIO_SET
  })
  const verdictOf = (scenario, kind) =>
    verdicts.find((entry) => entry.scenario === scenario && entry.kind === kind)

  test('is within when the burst P95 is no worse than twice the peak P95', () => {
    expect(verdictOf('live-animals', 'page')).toMatchObject({
      verdict: 'within',
      limitMs: 600
    })
  })

  test('is over when it is worse', () => {
    expect(verdictOf('live-animals', 'api').verdict).toBe('over')
  })

  test('is not judged with fewer than 10 requests in the burst minute', () => {
    expect(verdictOf('ins-front-door', 'page')).toMatchObject({
      verdict: 'not judged',
      burstCount: 6
    })
  })
})

describe('endpointRows', () => {
  const metrics = Object.fromEntries([
    duration(
      { scenario: 'live-animals', endpoint: 'animals-origin', phase: 'hold' },
      { count: 50, 'p(95)': 1500, 'p(99)': 2000 }
    ),
    duration(
      {
        scenario: 'live-animals',
        endpoint: 'animals-backend-list',
        phase: 'hold'
      },
      { count: 5, 'p(95)': 100, 'p(99)': 1500 }
    )
  ])
  const rows = endpointRows({
    metrics,
    scenarioSet: SCENARIO_SET,
    phase: 'hold'
  })

  test('has one row per endpoint with samples, tagged by journey', () => {
    expect(rows.map(({ endpoint }) => endpoint)).toEqual([
      'animals-origin',
      'animals-backend-list'
    ])
    expect(rows[0]).toMatchObject({
      journey: 'live-animals',
      kind: 'page',
      p95LimitMs: 2000,
      p99LimitMs: 5000,
      within: true
    })
  })

  test('is over when only the P99 breaks its limit', () => {
    expect(rows[1]).toMatchObject({ kind: 'api', within: false })
  })
})

describe('line writers', () => {
  test('states a journey against its targets', () => {
    expect(
      achievedJourneyLine({
        scenario: 'live-animals',
        phase: 'hold',
        seconds: 7200,
        achieved: {
          notificationsPerHour: 43.5,
          frontendRps: 0.4837,
          backendRps: 0.4837,
          concurrentUsers: 21.6
        },
        target: DESIGN_TARGETS['live-animals']
      })
    ).toBe(
      'Achieved live-animals over the hold (2h): 43.5 notifications an hour against 44, frontend 0.48 RPS against 0.5, backend 0.48 RPS against 0.5 (derived: 1 backend call a page), 21.6 concurrent users against 22 (NFR-VOL-AG-01 to AG-04)'
    )
  })

  test('states the front door', () => {
    expect(
      achievedFrontDoorLine({
        phase: 'hold',
        seconds: 360,
        achieved: {
          signInsPerHour: 190.12,
          coreRps: 0.41,
          concurrentUsers: 52.3,
          dashboardReadShare: 0.25
        },
        target: DESIGN_TARGETS.frontDoor
      })
    ).toContain(
      'Achieved front door over the hold (6m): 190.1 sign-ins an hour against'
    )
  })

  test('states the request mix', () => {
    expect(requestMixLine({ phase: 'hold', share: 0.248 })).toBe(
      'Request mix over the hold: dashboard reads 24.8% of page requests against the 25% target (D7)'
    )
  })

  test('states the burst', () => {
    expect(
      achievedBurstLine({
        burstDuration: '60s',
        burstFactor: 1.5,
        achieved: { animals: 0.7333, plants: 0.75, ins: 0.66 },
        targets: { animals: 0.7, plants: 0.7, ins: 0.6 }
      })
    ).toBe(
      'Achieved burst (60s at 1.5x): animals frontend 0.73 RPS against 0.7, plants 0.75 against 0.7, INS 0.66 against 0.6'
    )
  })

  test.each([
    [
      {
        scenario: 'live-animals',
        kind: 'page',
        peakP95Ms: 300,
        burstP95Ms: 410,
        burstCount: 40,
        limitMs: 600,
        verdict: 'within'
      },
      "Burst P95 live-animals page: 410ms against twice the peak's 300ms (600ms): within"
    ],
    [
      {
        scenario: 'live-animals',
        kind: 'page',
        peakP95Ms: 300,
        burstP95Ms: 700,
        burstCount: 40,
        limitMs: 600,
        verdict: 'over'
      },
      "Burst P95 live-animals page: 700ms against twice the peak's 300ms (600ms): OVER"
    ],
    [
      {
        scenario: 'live-animals',
        kind: 'page',
        peakP95Ms: 300,
        burstP95Ms: 900,
        burstCount: 6,
        limitMs: 600,
        verdict: 'not judged'
      },
      'Burst P95 live-animals page: not judged, 6 requests in the burst minute, fewer than 10'
    ]
  ])('states a relative verdict', (verdict, line) => {
    expect(relativeLine(verdict)).toBe(line)
  })

  test('states that a burst with enough requests is not judged when the peak had none', () => {
    expect(
      relativeLine({
        scenario: 'live-animals',
        kind: 'page',
        peakP95Ms: undefined,
        burstP95Ms: 900,
        burstCount: 40,
        limitMs: undefined,
        verdict: 'not judged'
      })
    ).toBe(
      'Burst P95 live-animals page: not judged, no requests in the peak phase'
    )
  })

  test('states an endpoint', () => {
    expect(
      endpointLine({
        journey: 'live-animals',
        scenario: 'live-animals',
        endpoint: 'animals-origin',
        kind: 'page',
        count: 50,
        p95Ms: 1500.4,
        p99Ms: 6000,
        p95LimitMs: 2000,
        p99LimitMs: 5000,
        within: false
      })
    ).toBe(
      'Endpoint live-animals live-animals animals-origin (page, 50 requests): P95 1500ms against 2000ms, P99 6000ms against 5000ms: OVER'
    )
  })

  test.each([
    [
      [{ scenario: 'a', kind: 'page', verdict: 'within' }],
      'Relative thresholds: passed'
    ],
    [
      [
        { scenario: 'a', kind: 'page', verdict: 'over' },
        { scenario: 'b', kind: 'api', verdict: 'over' }
      ],
      'Relative thresholds: FAILED: a page; b api'
    ]
  ])('states the relative outcome', (verdicts, line) => {
    expect(relativeOutcomeLine({ verdicts })).toBe(line)
  })
})

describe('designTargetReport', () => {
  const model = resolveTrafficModel({}, SCENARIO_LENGTH_PROFILES.local)
  const scenarioSet = SCENARIOS
  const schedule = phaseSchedule({
    shape: 'p99-burst',
    model,
    scenarioNames: Object.keys(scenarioSet)
  })
  const metrics = Object.fromEntries([
    duration(
      { scenario: 'live-animals', kind: 'page', phase: 'peak' },
      { 'p(95)': 300, count: 500 }
    ),
    duration(
      { scenario: 'live-animals', kind: 'page', phase: 'burst' },
      { 'p(95)': 900, count: 40 }
    ),
    [
      'checks{scenario:live-animals}',
      { thresholds: { 'rate>0.99': { ok: true } } }
    ]
  ])
  const reportFor = () =>
    designTargetReport({
      metrics,
      shape: 'p99-burst',
      scenarioLength: 'local',
      environment: 'local',
      stubProfile: 'zero-delay',
      schedule,
      scenarioSet,
      model
    })

  test('fails the relative rule with one pair over', () => {
    expect(reportFor().relativeFailed).toBe(true)
  })

  test('lists every threshold with its result', () => {
    expect(reportFor().thresholds).toEqual([
      {
        metric: 'checks{scenario:live-animals}',
        expression: 'rate>0.99',
        ok: true
      }
    ])
  })

  test('writes text that ends with the threshold lines', () => {
    const text = designTargetText(reportFor(), metrics)

    expect(text).toContain('Design-target run: p99-burst')
    expect(text).toContain('Relative thresholds: FAILED: live-animals page')
    expect(
      text.endsWith(
        'Threshold checks{scenario:live-animals} rate>0.99: passed\n'
      )
    ).toBe(true)
  })

  test('writes a complete HTML page that escapes its values', () => {
    const report = reportFor()
    const html = designTargetHtml({
      ...report,
      relative: [
        { ...report.relative[0], scenario: '<script>alert(1)</script>' }
      ]
    })

    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<title>Design-target run: p99-burst</title>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('designTargetReport for a sustained peak', () => {
  const model = resolveTrafficModel({}, SCENARIO_LENGTH_PROFILES.local)
  const scenarioSet = SCENARIOS
  const schedule = phaseSchedule({
    shape: SHAPES.SUSTAINED_PEAK,
    model,
    scenarioNames: Object.keys(scenarioSet)
  })
  const metrics = Object.fromEntries([
    duration(
      {
        scenario: 'live-animals',
        endpoint: 'animals-origin',
        phase: 'hold'
      },
      { 'p(95)': 300, 'p(99)': 400, count: 500 }
    ),
    [
      'checks{scenario:live-animals}',
      { thresholds: { 'rate>0.99': { ok: true } } }
    ]
  ])
  const report = designTargetReport({
    metrics,
    shape: SHAPES.SUSTAINED_PEAK,
    scenarioLength: 'local',
    environment: 'local',
    stubProfile: 'zero-delay',
    schedule,
    scenarioSet,
    model
  })

  test('has no burst and no relative verdicts, and works over the hold', () => {
    expect(report.burst).toBeUndefined()
    expect(report.relative).toEqual([])
    expect(report.run.steadyPhase).toBe('hold')
  })

  test('writes text with no burst or relative line', () => {
    const text = designTargetText(report, metrics)

    expect(text).not.toMatch(/burst/i)
    expect(text).not.toContain('Relative')
  })

  test('writes HTML whose Burst table has no rows', () => {
    const html = designTargetHtml(report)
    const burstTable = html.slice(
      html.indexOf('<h2>Burst</h2>'),
      html.indexOf('<h2>Relative P95')
    )

    expect(burstTable).not.toContain('<td')
  })
})

describe('hourTarget', () => {
  test('scales a journey target, drops the burst rate and keeps the source', () => {
    expect(hourTarget(DESIGN_TARGETS['live-animals'], 0.25)).toEqual({
      notificationsPerHour: 11,
      frontendRps: 0.125,
      backendRps: 0.125,
      concurrentUsers: 5.5,
      source: 'NFR-VOL-AG-01 to AG-04'
    })
  })

  test('scales the front door target', () => {
    expect(hourTarget(DESIGN_TARGETS.frontDoor, 0.25)).toEqual({
      signInsPerHour: 50,
      coreRps: 0.1,
      concurrentUsers: 12.75,
      source: 'NFR-VOL-CORE-01 to CORE-04'
    })
  })
})

describe('average-load hours', () => {
  const model = resolveTrafficModel({
    TRAFFIC_MODEL: '{"averageLoad":{"hourDuration":"10m"}}'
  })
  const scheduleFor = () =>
    phaseSchedule({
      shape: SHAPES.AVERAGE_LOAD,
      model,
      scenarioNames: Object.keys(SCENARIOS)
    })
  const metrics = Object.fromEntries([
    [
      subMetricKey('notifications_started', {
        scenario: 'live-animals',
        phase: 'hour-11'
      }),
      metric({ count: 2 })
    ],
    [
      subMetricKey('page_requests', { frontend: 'animals', phase: 'hour-11' }),
      metric({ count: 72 })
    ],
    [
      subMetricKey('session_seconds', {
        scenario: 'live-animals',
        phase: 'hour-11'
      }),
      metric({ avg: 600, count: 5 })
    ],
    [
      subMetricKey('page_requests', {
        traffic_class: 'sign-in',
        phase: 'hour-11'
      }),
      metric({ count: 20 })
    ],
    [
      subMetricKey('page_requests', { frontend: 'ins', phase: 'hour-11' }),
      metric({ count: 60 })
    ],
    [
      subMetricKey('session_seconds', { phase: 'hour-11' }),
      metric({ avg: 60, count: 300 })
    ]
  ])
  const hoursFor = () =>
    averageLoadHours({
      metrics,
      schedule: scheduleFor(),
      model,
      scenarioSet: SCENARIOS
    })

  test('works out one row per hour against that hour of the profile', () => {
    const hours = hoursFor()

    expect(hours).toHaveLength(24)
    expect(hours[11]).toMatchObject({
      hour: 11,
      phase: 'hour-11',
      label: '11:00',
      segment: 'sustained window',
      share: 0.08,
      factor: 0.25,
      seconds: 600
    })
    expect(
      hours[11].journeys['live-animals'].achieved.notificationsPerHour
    ).toBe(12)
    expect(hours[11].journeys['live-animals'].achieved.frontendRps).toBeCloseTo(
      0.12,
      9
    )
    expect(hours[11].journeys['live-animals'].target.notificationsPerHour).toBe(
      11
    )
  })

  test('gives an hour with no metrics zeros, never NaN', () => {
    const { journeys, frontDoor } = hoursFor()[3]

    expect(journeys['live-animals'].achieved).toEqual({
      notificationsPerHour: 0,
      frontendRps: 0,
      backendRps: 0,
      concurrentUsers: 0
    })
    expect(frontDoor.achieved).toMatchObject({
      signInsPerHour: 0,
      coreRps: 0,
      concurrentUsers: 0
    })
  })

  test('states an hour for both journeys and the front door', () => {
    expect(
      hourLine({
        row: hoursFor()[11]
      })
    ).toBe(
      'Hour 11:00 (sustained window, 8% of a weekday, 10m): live-animals 12 notifications an hour against 11, frontend 0.12 RPS against 0.13, 5 concurrent users against 5.5; high-risk-plants 0 notifications an hour against 9, frontend 0 RPS against 0.13, 0 concurrent users against 5.5; front door 120 sign-ins an hour against 50, core pages 0.1 RPS against 0.1, 30 concurrent users against 12.8'
    )
  })

  test('reads endpoint rows over the whole run when no phase is given', () => {
    const rows = endpointRows({
      metrics: Object.fromEntries([
        duration(
          { scenario: 'live-animals', endpoint: 'animals-origin' },
          { count: 50, 'p(95)': 1500, 'p(99)': 2000 }
        )
      ]),
      scenarioSet: SCENARIO_SET
    })

    expect(rows.map(({ endpoint }) => endpoint)).toEqual(['animals-origin'])
  })
})

describe('designTargetReport for average load', () => {
  const model = resolveTrafficModel({}, SCENARIO_LENGTH_PROFILES.local)
  const scenarioSet = SCENARIOS
  const schedule = phaseSchedule({
    shape: SHAPES.AVERAGE_LOAD,
    model,
    scenarioNames: Object.keys(scenarioSet)
  })
  const metrics = Object.fromEntries([
    duration(
      { scenario: 'live-animals', endpoint: 'animals-origin' },
      { 'p(95)': 300, 'p(99)': 400, count: 500 }
    ),
    [
      'checks{scenario:live-animals}',
      { thresholds: { 'rate>0.99': { ok: true } } }
    ]
  ])
  const report = designTargetReport({
    metrics,
    shape: SHAPES.AVERAGE_LOAD,
    scenarioLength: 'local',
    environment: 'local',
    stubProfile: 'zero-delay',
    schedule,
    scenarioSet,
    model
  })

  test('reports 24 hours, with no relative verdicts, achieved figure or burst', () => {
    expect(report.hours).toHaveLength(24)
    expect(report.relative).toEqual([])
    expect(report.relativeFailed).toBe(false)
    expect(report.run.profileLine).toContain('Average weekday:')
    expect(report).not.toHaveProperty('achieved')
    expect(report).not.toHaveProperty('burst')
    expect(report.endpoints).toHaveLength(1)
  })

  test('writes text with the run line, the profile line, 24 hours and the threshold lines', () => {
    const lines = designTargetText(report, metrics).trimEnd().split('\n')

    expect(lines[0]).toBe(report.run.line)
    expect(lines[1]).toBe(report.run.profileLine)
    expect(lines.filter((line) => line.startsWith('Hour '))).toHaveLength(24)
    expect(lines.at(-1)).toBe(
      'Threshold checks{scenario:live-animals} rate>0.99: passed'
    )
  })

  test('writes HTML with the hour table, no burst table, and escaped values', () => {
    const html = designTargetHtml({
      ...report,
      hours: [
        { ...report.hours[0], segment: '<script>alert(1)</script>' },
        ...report.hours.slice(1)
      ]
    })

    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<h2>Each hour of the weekday</h2>')
    expect(html).not.toContain('<h2>Burst</h2>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

const pairMetrics = ({ scenario, kind, before, after, beforeP95, afterP95 }) =>
  Object.fromEntries([
    duration(
      { scenario, kind, phase: before },
      { 'p(95)': beforeP95, count: 500 }
    ),
    duration({ scenario, kind, phase: after }, { 'p(95)': afterP95, count: 40 })
  ])

describe('p95Comparison', () => {
  const compare = (metrics, overrides = {}) =>
    p95Comparison({
      metrics,
      scenario: 'live-animals',
      kind: 'page',
      before: 'baseline',
      after: 'recovered',
      factor: 1.1,
      minSamples: 10,
      ...overrides
    })
  const pair = (afterP95) =>
    pairMetrics({
      scenario: 'live-animals',
      kind: 'page',
      before: 'baseline',
      after: 'recovered',
      beforeP95: 600,
      afterP95
    })

  test('is within when the later P95 is no worse than the factor times the earlier', () => {
    expect(compare(pair(640))).toMatchObject({
      beforeP95Ms: 600,
      afterP95Ms: 640,
      afterCount: 40,
      verdict: 'within'
    })
    expect(compare(pair(640)).limitMs).toBeCloseTo(660, 6)
  })

  test('is over when it is worse', () => {
    expect(compare(pair(700)).verdict).toBe('over')
  })

  test('is not judged with fewer requests than the minimum in the later phase', () => {
    expect(compare(pair(700), { minSamples: 41 })).toMatchObject({
      verdict: 'not judged',
      afterCount: 40
    })
  })

  test('is not judged with fewer requests than the minimum in the earlier phase', () => {
    expect(compare(pair(700), { minBeforeSamples: 501 })).toMatchObject({
      verdict: 'not judged',
      beforeCount: 500
    })
    expect(compare(pair(700), { minBeforeSamples: 500 }).verdict).toBe('over')
  })

  test('judges a pair with few requests in the earlier phase unless asked not to', () => {
    expect(compare(pair(700), { minBeforeSamples: 0 }).verdict).toBe('over')
  })

  test('is not judged with no requests in the earlier phase', () => {
    expect(compare({})).toMatchObject({
      verdict: 'not judged',
      afterCount: 0,
      limitMs: undefined
    })
  })
})

describe('achievedSpike', () => {
  const metrics = {
    [subMetricKey('page_requests', { frontend: 'animals', phase: 'spike' })]:
      metric({ count: 49 }),
    [subMetricKey('page_requests', { frontend: 'plants', phase: 'spike' })]:
      metric({ count: 50 }),
    [subMetricKey('page_requests', { frontend: 'ins', phase: 'spike' })]:
      metric({ count: 51 }),
    [subMetricKey('page_requests', {
      traffic_class: 'sign-in',
      phase: 'spike'
    })]: metric({ count: 3 })
  }

  test('works out each frontend page rate over the spike and derives the backends', () => {
    const achieved = achievedSpike({
      metrics,
      seconds: 10
    })

    expect(achieved).toMatchObject({
      animals: 4.9,
      animalsBackend: 4.9,
      plants: 5,
      plantsBackend: 5,
      ins: 5.1,
      signIns: 3
    })
  })

  test('derives the session path as every frontend page plus a backend call a journey page', () => {
    const { sessionPath } = achievedSpike({
      metrics,
      seconds: 10
    })

    expect(sessionPath).toBeCloseTo(4.9 + 5 + 5.1 + 4.9 + 5, 6)
  })

  test('is zero, never NaN, with no samples', () => {
    const achieved = achievedSpike({
      metrics: {},
      seconds: 10
    })

    expect(Object.values(achieved).every((value) => value === 0)).toBe(true)
  })
})

describe('spike and endurance line writers', () => {
  const capacities = { ins: 5, animals: 5, plants: 5, sessionPath: 25 }
  const comparison = {
    scenario: 'live-animals',
    kind: 'page',
    beforeP95Ms: 600,
    afterP95Ms: 640,
    beforeCount: 500,
    afterCount: 40,
    limitMs: 660,
    verdict: 'within',
    window: '2m'
  }

  test('states the spike against the stated capacities', () => {
    expect(
      spikeLine({
        duration: '10s',
        capacities,
        achieved: {
          animals: 4.9,
          animalsBackend: 4.9,
          plants: 5,
          plantsBackend: 5,
          ins: 5.1,
          signIns: 3,
          sessionPath: 24.8
        }
      })
    ).toBe(
      'Spike (10s): animals frontend 4.9 RPS against 5, backend 4.9 RPS against 5 (derived: 1 backend call a page); plants frontend 5 RPS against 5, backend 5 RPS against 5; INS front door 5.1 RPS against 5 including 3 sign-ins; session path 24.8 RPS against 25 (derived: every frontend page plus 1 backend call a journey page)'
    )
  })

  test('states a recovery that is within', () => {
    expect(recoveryLine(comparison)).toBe(
      "Recovery P95 live-animals page: 640ms in the recovered 2m against the baseline's 600ms plus 10% (660ms): within"
    )
  })

  test('states a recovery that is over', () => {
    expect(
      recoveryLine({ ...comparison, afterP95Ms: 700, verdict: 'over' })
    ).toContain('(660ms): OVER')
  })

  test('states the two recoveries that are not judged', () => {
    expect(
      recoveryLine({ ...comparison, afterCount: 6, verdict: 'not judged' })
    ).toBe(
      'Recovery P95 live-animals page: not judged, 6 requests in the recovered 2m, fewer than 10'
    )
    expect(
      recoveryLine({ ...comparison, beforeCount: 3, verdict: 'not judged' })
    ).toBe(
      'Recovery P95 live-animals page: not judged, 3 requests in the baseline, fewer than 10'
    )
  })

  test('states a drift that is within, over and not judged', () => {
    const drift = {
      ...comparison,
      beforeP95Ms: 700,
      afterP95Ms: 812,
      limitMs: 840
    }

    expect(driftLine(drift)).toBe(
      "Drift P95 live-animals page: 812ms in the final hour against 1.2 times the first hour's 700ms (840ms): within"
    )
    expect(driftLine({ ...drift, verdict: 'over' })).toContain('(840ms): OVER')
    expect(driftLine({ ...drift, afterCount: 3, verdict: 'not judged' })).toBe(
      'Drift P95 live-animals page: not judged, 3 requests in the final hour, fewer than 10'
    )
    expect(driftLine({ ...drift, beforeCount: 0, verdict: 'not judged' })).toBe(
      'Drift P95 live-animals page: not judged, 0 requests in the first hour, fewer than 10'
    )
  })

  test('states whether a relative rule passed or failed', () => {
    const over = { ...comparison, verdict: 'over' }

    expect(
      comparisonOutcomeLine({
        label: 'Recovery',
        comparisons: [comparison]
      })
    ).toBe('Recovery: passed')
    expect(
      comparisonOutcomeLine({
        label: 'Drift',
        comparisons: [comparison, over]
      })
    ).toBe('Drift: FAILED: live-animals page')
  })

  test('states that the Defra ID stub did not cascade', () => {
    expect(signInCascadeLine({})).toBe(
      'Defra ID stub: sign-in requests failed 0% in the spike and 0% in the recovery against 1%: no cascade'
    )
  })

  test('states that the Defra ID stub cascaded when sign-ins failed in the recovery', () => {
    const metrics = {
      [subMetricKey('http_req_failed', {
        endpoint: 'sign-in',
        phase: 'recovery'
      })]: metric({ rate: 0.05 })
    }

    expect(signInCascadeLine(metrics)).toBe(
      'Defra ID stub: sign-in requests failed 0% in the spike and 5% in the recovery against 1%: CASCADED'
    )
  })

  test('states how often each returning user signed in again', () => {
    expect(
      reauthenticationLines({
        entries: [
          { scenario: 'returning-ins', frontend: 'ins', count: 2, expected: 2 }
        ],
        expiry: 'sessions expire at the frontends after 4h'
      })
    ).toEqual([
      'Re-authentication ins: 2 times, about 2 expected (sessions expire at the frontends after 4h)'
    ])
  })

  test('counts the re-authentications of each returning scenario', () => {
    const model = resolveTrafficModel({}, SCENARIO_LENGTH_PROFILES.local)
    const metrics = {
      'reauthentications{scenario:returning-animals}': metric({ count: 3 })
    }

    expect(reauthentications({ metrics, model, runSeconds: 960 })).toEqual([
      { scenario: 'returning-ins', frontend: 'ins', count: 0, expected: 4 },
      {
        scenario: 'returning-animals',
        frontend: 'animals',
        count: 3,
        expected: 4
      },
      {
        scenario: 'returning-plants',
        frontend: 'plants',
        count: 0,
        expected: 4
      }
    ])
  })

  test('states the re-authentication traffic', () => {
    const tags = { auth: 're-authentication' }
    const metrics = Object.fromEntries([
      duration(tags, { count: 24, 'p(95)': 310 }),
      [subMetricKey('http_req_failed', tags), metric({ rate: 0 })]
    ])

    expect(reauthenticationTrafficLine(metrics)).toBe(
      'Re-authentication traffic (auth:re-authentication): 24 requests, P95 310ms, 0% failed'
    )
    expect(reauthenticationTrafficLine({})).toBe(
      'Re-authentication traffic (auth:re-authentication): 0 requests'
    )
  })

  test('states the transport errors', () => {
    expect(transportErrorLine({})).toBe(
      'Transport errors (refused, reset or timed out): 0'
    )
    expect(transportErrorLine({ transport_errors: metric({ count: 2 }) })).toBe(
      'Transport errors (refused, reset or timed out): 2'
    )
  })
})

describe('designTargetReport for spike and recovery', () => {
  const model = resolveTrafficModel({}, SCENARIO_LENGTH_PROFILES.local)
  const scenarioSet = SCENARIOS
  const schedule = phaseSchedule({
    shape: SHAPES.SPIKE_RECOVERY,
    model,
    scenarioNames: Object.keys(scenarioSet)
  })
  const metrics = {
    ...pairMetrics({
      scenario: 'live-animals',
      kind: 'page',
      before: 'baseline',
      after: 'recovered',
      beforeP95: 600,
      afterP95: 700
    }),
    [subMetricKey('page_requests', { frontend: 'animals', phase: 'spike' })]:
      metric({ count: 49 }),
    'checks{scenario:live-animals}': {
      thresholds: { 'rate>0.99': { ok: true } }
    }
  }
  const reportFor = () =>
    designTargetReport({
      metrics,
      shape: SHAPES.SPIKE_RECOVERY,
      scenarioLength: 'local',
      environment: 'local',
      stubProfile: 'zero-delay',
      schedule,
      scenarioSet: SCENARIOS,
      model
    })

  test('compares the baseline with the recovered window at 1.1 times', () => {
    const entry = reportFor().relative.find(
      ({ scenario, kind }) => scenario === 'live-animals' && kind === 'page'
    )

    expect(entry.limitMs).toBeCloseTo(660, 6)
    expect(entry).toMatchObject({ verdict: 'over', window: '1m' })
  })

  test('fails the run when a recovered P95 is over', () => {
    expect(reportFor().relativeFailed).toBe(true)
  })

  test('reports the spike against the stated capacities', () => {
    const { spike } = reportFor()

    expect(spike).toMatchObject({
      duration: '10s',
      seconds: 10,
      capacities: { sessionPath: 25 },
      achieved: { animals: 4.9 }
    })
  })

  test('writes text that states the profile, the spike, every recovery and the cascade', () => {
    const report = reportFor()
    const lines = designTargetText(report, metrics).trimEnd().split('\n')

    expect(lines[0]).toBe(report.run.line)
    expect(lines[1]).toMatch(/^Spike: 10s at the stated capacities/)
    expect(lines.some((line) => line.startsWith('Spike (10s): animals'))).toBe(
      true
    )
    expect(
      lines.filter((line) => line.startsWith('Recovery P95 '))
    ).toHaveLength(report.relative.length)
    expect(report.relative.length).toBeGreaterThanOrEqual(4)
    expect(lines).toContain('Recovery: FAILED: live-animals page')
    expect(lines.some((line) => line.startsWith('Defra ID stub: '))).toBe(true)
  })

  test('writes HTML with the spike and recovery tables and escaped values', () => {
    const report = reportFor()
    const html = designTargetHtml({
      ...report,
      relative: [
        { ...report.relative[0], scenario: '<script>alert(1)</script>' }
      ]
    })

    expect(html).toContain('<h2>Achieved over the baseline</h2>')
    expect(html).toContain('<h2>Spike (10s)</h2>')
    expect(html).toContain('<h2>Recovery P95</h2>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  test('lists the pairs that are over as recovery lines', () => {
    expect(failedComparisonLines(reportFor())).toEqual([
      "Recovery P95 live-animals page: 700ms in the recovered 1m against the baseline's 600ms plus 10% (660ms): OVER"
    ])
  })
})

describe('designTargetReport for endurance', () => {
  const model = resolveTrafficModel({}, SCENARIO_LENGTH_PROFILES.local)
  const scenarioSet = scenarioSetForShape({
    shape: SHAPES.ENDURANCE
  })
  const schedule = phaseSchedule({
    shape: SHAPES.ENDURANCE,
    model,
    scenarioNames: Object.keys(SCENARIOS)
  })
  const metrics = {
    ...pairMetrics({
      scenario: 'live-animals',
      kind: 'page',
      before: 'first-hour',
      after: 'final-hour',
      beforeP95: 700,
      afterP95: 850
    }),
    'reauthentications{scenario:returning-ins}': metric({ count: 4 }),
    transport_errors: metric({ count: 0 }),
    'checks{scenario:live-animals}': {
      thresholds: { 'rate>0.99': { ok: true } }
    }
  }
  const report = designTargetReport({
    metrics,
    shape: SHAPES.ENDURANCE,
    scenarioLength: 'local',
    environment: 'local',
    stubProfile: 'zero-delay',
    schedule,
    scenarioSet,
    model
  })

  test('compares the first hour with the final hour at 1.2 times', () => {
    const entry = report.relative.find(
      ({ scenario, kind }) => scenario === 'live-animals' && kind === 'page'
    )

    expect(entry.limitMs).toBeCloseTo(840, 6)
    expect(entry.verdict).toBe('over')
    expect(report.relativeFailed).toBe(true)
  })

  test('reports each window, the re-authentications and the transport errors', () => {
    expect(report.windows.map(({ phase }) => phase)).toEqual([
      'first-hour',
      'final-hour'
    ])
    expect(report.reauthentication).toContainEqual({
      scenario: 'returning-ins',
      frontend: 'ins',
      count: 4,
      expected: 4
    })
    expect(report.transportErrors).toBe(0)
    expect(report.run.runSeconds).toBe(960)
  })

  test('writes text with the profile, the drift, the re-authentication and the transport errors', () => {
    const lines = designTargetText(report, metrics).trimEnd().split('\n')

    expect(lines[0]).toBe(report.run.line)
    expect(lines[1]).toMatch(/^Endurance: one returning user each/)
    expect(lines.filter((line) => line.startsWith('Drift P95 '))).toHaveLength(
      report.relative.length
    )
    expect(report.relative.length).toBeGreaterThanOrEqual(4)
    expect(lines).toContain('Drift: FAILED: live-animals page')
    expect(
      lines.filter((line) => line.startsWith('Re-authentication '))
    ).toHaveLength(4)
    expect(lines).toContain('Transport errors (refused, reset or timed out): 0')
  })

  test('writes HTML with the drift and re-authentication tables and escaped values', () => {
    const html = designTargetHtml({
      ...report,
      reauthentication: [
        {
          scenario: 'x',
          frontend: '<script>alert(1)</script>',
          count: 1,
          expected: 1
        }
      ]
    })

    expect(html).toContain('<h2>Achieved over the first-hour</h2>')
    expect(html).toContain('<h2>Achieved over the final-hour</h2>')
    expect(html).toContain('<h2>Drift P95</h2>')
    expect(html).toContain('<h2>Re-authentication</h2>')
    expect(html).not.toContain('<script>')
  })

  test('lists the pairs that are over as drift lines', () => {
    expect(failedComparisonLines(report)).toEqual([
      "Drift P95 live-animals page: 850ms in the final hour against 1.2 times the first hour's 700ms (840ms): OVER"
    ])
  })
})

describe('failedComparisonLines for a burst', () => {
  test('words the over pairs the way the burst always has', () => {
    const verdict = {
      scenario: 'live-animals',
      kind: 'page',
      peakP95Ms: 300,
      burstP95Ms: 900,
      burstCount: 40,
      limitMs: 600,
      verdict: 'over'
    }

    expect(
      failedComparisonLines({
        run: { shape: 'p99-burst' },
        relative: [verdict, { ...verdict, kind: 'api', verdict: 'within' }]
      })
    ).toEqual([relativeLine(verdict)])
  })
})

describe('eventing in the burst and spike reports', () => {
  const model = resolveTrafficModel({}, SCENARIO_LENGTH_PROFILES.local)
  const gauge = (value) => metric({ value })
  const drainedMetrics = (phase) => ({
    eventing_backlog_pre_burst_depth: gauge(2),
    eventing_backlog_peak_depth: gauge(9),
    service_bus_peak_per_second: gauge(3),
    eventing_backlog_drain_seconds: gauge(14),
    eventing_backlog_drained: metric({ rate: 1 }),
    [subMetricKey('notifications_submitted', { phase })]: metric({ count: 12 })
  })
  const undrainedMetrics = (phase) => ({
    ...drainedMetrics(phase),
    eventing_backlog_drain_seconds: gauge(0),
    eventing_backlog_drained: metric({ rate: 0 })
  })
  const reportFor = (shape, metrics) =>
    designTargetReport({
      metrics,
      shape,
      scenarioLength: 'local',
      environment: 'local',
      stubProfile: 'zero-delay',
      schedule: phaseSchedule({
        shape,
        model,
        scenarioNames: Object.keys(SCENARIOS)
      }),
      scenarioSet: SCENARIOS,
      model
    })

  test('the burst report holds the eventing figures and states smoothing and drain', () => {
    const metrics = drainedMetrics('burst')
    const report = reportFor(SHAPES.P99_BURST, metrics)
    const lines = designTargetText(report, metrics).trimEnd().split('\n')

    expect(report.eventing).toEqual({
      phase: 'burst',
      windowSeconds: 60,
      watchSeconds: 180,
      preBurstDepth: 2,
      peakDepth: 9,
      peakPerSecond: 3,
      drainSeconds: 14,
      submittedInWindow: 12
    })
    expect(lines).toContain(
      'Smoothing over the burst (1m): 12 notifications submitted; the Service Bus stand-in received at most 3 events in any one second, and the SQS backlog peaked at 9 messages'
    )
    expect(lines).toContain(
      'SQS backlog after the burst: drained to its pre-burst depth of 2 in 14 seconds'
    )
  })

  test('the burst text says the backlog did not drain within the watch', () => {
    const metrics = undrainedMetrics('burst')
    const report = reportFor(SHAPES.P99_BURST, metrics)

    expect(report.eventing.drainSeconds).toBeNull()
    expect(designTargetText(report, metrics)).toContain(
      'SQS backlog after the burst: did not drain within 180s (pre-burst depth 2, peak 9)'
    )
  })

  test('the burst HTML has an Eventing table with the drain time', () => {
    const html = designTargetHtml(
      reportFor(SHAPES.P99_BURST, drainedMetrics('burst'))
    )

    expect(html).toContain('<h2>Eventing</h2>')
    expect(html).toContain('Drain time in seconds')
    expect(html).toContain('>14<')
  })

  test('the burst HTML says the backlog did not drain', () => {
    const html = designTargetHtml(
      reportFor(SHAPES.P99_BURST, undrainedMetrics('burst'))
    )

    expect(html).toContain('did not drain within 180s')
  })

  test('the spike report states smoothing and drain over the spike window', () => {
    const metrics = drainedMetrics('spike')
    const report = reportFor(SHAPES.SPIKE_RECOVERY, metrics)
    const lines = designTargetText(report, metrics).trimEnd().split('\n')

    expect(report.eventing).toMatchObject({
      phase: 'spike',
      windowSeconds: 10,
      submittedInWindow: 12
    })
    expect(
      lines.some((line) => line.startsWith('Smoothing over the spike (10s): '))
    ).toBe(true)
    expect(lines).toContain(
      'SQS backlog after the spike: drained to its pre-spike depth of 2 in 14 seconds'
    )
  })

  test('the spike watch runs until 180s after the tail begins, so its drain watch counts from the spike end', () => {
    const report = reportFor(SHAPES.SPIKE_RECOVERY, undrainedMetrics('spike'))

    expect(report.eventing.watchSeconds).toBe(300)
  })

  test('a sustained peak report has no eventing figures', () => {
    const report = reportFor(SHAPES.SUSTAINED_PEAK, {})

    expect(report.eventing).toBeUndefined()
  })
})
