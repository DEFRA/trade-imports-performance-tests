import { describe, expect, test } from 'vitest'

import {
  DESIGN_TARGETS,
  SCENARIO_LENGTH_PROFILES,
  SHAPES,
  phaseSchedule,
  scenarioSetFor
} from '../config/design-target.js'
import { subMetricKey } from '../config/thresholds.js'
import { resolveTrafficModel } from '../config/traffic.js'
import {
  achievedBurst,
  achievedBurstLine,
  achievedFrontDoor,
  achievedFrontDoorLine,
  achievedJourney,
  achievedJourneyLine,
  designTargetHtml,
  designTargetReport,
  designTargetText,
  endpointLine,
  endpointRows,
  phaseSeconds,
  relativeBurstVerdicts,
  relativeLine,
  relativeOutcomeLine,
  requestMixLine,
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

  test.each([
    ['two-journeys', 'two journeys'],
    ['with-iuu', 'with IUU']
  ])('states the front door for %s', (loadProfile, label) => {
    expect(
      achievedFrontDoorLine({
        loadProfile,
        phase: 'hold',
        seconds: 360,
        achieved: {
          signInsPerHour: 190.12,
          coreRps: 0.41,
          concurrentUsers: 52.3,
          dashboardReadShare: 0.25
        },
        target: DESIGN_TARGETS.frontDoor[loadProfile]
      })
    ).toContain(
      `Achieved front door (${label}) over the hold (6m): 190.1 sign-ins an hour against`
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
      true,
      'Relative thresholds: passed'
    ],
    [
      [
        { scenario: 'a', kind: 'page', verdict: 'over' },
        { scenario: 'b', kind: 'api', verdict: 'over' }
      ],
      true,
      'Relative thresholds: FAILED: a page; b api'
    ],
    [
      [{ scenario: 'a', kind: 'page', verdict: 'over' }],
      false,
      'Relative thresholds: reported, not gated (with-IUU profile)'
    ]
  ])('states the relative outcome', (verdicts, gating, line) => {
    expect(relativeOutcomeLine({ verdicts, gating })).toBe(line)
  })
})

describe('designTargetReport', () => {
  const model = resolveTrafficModel({}, SCENARIO_LENGTH_PROFILES.local)
  const scenarioSet = scenarioSetFor('two-journeys')
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
  const reportFor = (loadProfile) =>
    designTargetReport({
      metrics,
      shape: 'p99-burst',
      loadProfile,
      scenarioLength: 'local',
      environment: 'local',
      stubProfile: 'zero-delay',
      schedule,
      scenarioSet,
      model
    })

  test('fails the relative rule for two journeys with one over', () => {
    expect(reportFor('two-journeys').relativeFailed).toBe(true)
  })

  test('reports the same verdict without failing the with-IUU profile', () => {
    const report = reportFor('with-iuu')

    expect(report.relativeFailed).toBe(false)
    expect(report.relative.some(({ verdict }) => verdict === 'over')).toBe(true)
  })

  test('lists every threshold with its result', () => {
    expect(reportFor('two-journeys').thresholds).toEqual([
      {
        metric: 'checks{scenario:live-animals}',
        expression: 'rate>0.99',
        ok: true
      }
    ])
  })

  test('writes text that ends with the threshold lines', () => {
    const text = designTargetText(reportFor('two-journeys'), metrics)

    expect(text).toContain('Design-target run: p99-burst, two-journeys profile')
    expect(text).toContain('Relative thresholds: FAILED: live-animals page')
    expect(
      text.endsWith(
        'Threshold checks{scenario:live-animals} rate>0.99: passed\n'
      )
    ).toBe(true)
  })

  test('writes a complete HTML page that escapes its values', () => {
    const report = reportFor('two-journeys')
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
  const scenarioSet = scenarioSetFor('two-journeys')
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
    loadProfile: 'two-journeys',
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
