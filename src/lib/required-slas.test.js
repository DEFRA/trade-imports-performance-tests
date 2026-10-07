import { describe, expect, test } from 'vitest'

import { TRAFFIC_DEFAULTS } from '../config/traffic.js'
import {
  designNotificationsPerSecond,
  designPagesPerSecond,
  metOf,
  requiredSlaHtml,
  requiredSlaLines,
  requiredSlaStatement,
  riskOf
} from './required-slas.js'

const SECONDS_PER_HOUR = 3600
const WINDOW = {
  startedAt: '2026-10-07T10:00:00Z',
  endedAt: '2026-10-07T10:02:00Z'
}

const gauge = (value) => ({ value, min: value, max: value })

const CALL_COUNTS = {
  source: 'call-counts',
  journeys: {
    'live-animals': {
      pageRequests: 1000,
      backendCalls: 1380,
      sessionResolutions: 1970,
      externalCalls: { 'defra-id': { jwks: 30, 'token-exchange': 20 } }
    },
    'high-risk-plants': {
      pageRequests: 500,
      backendCalls: 520,
      sessionResolutions: 900,
      externalCalls: { 'defra-id': { jwks: 20 } }
    }
  }
}

const SUMMARY = {
  metrics: {
    'stub_latency_answered_count{integration:trade-token}': gauge(45),
    'stub_latency_answered_count{integration:mdm}': gauge(90),
    'service_bus_forwarded{schema_version:0.1.0}': gauge(40),
    'service_bus_forwarded{schema_version:0.2.0}': gauge(40),
    'notifications_submitted{scenario:live-animals,submission:first}': {
      count: 40,
      rate: 0.3
    },
    'stub_profile{integration:mdm,profile:sla}': gauge(1),
    'stub_latency{integration:mdm,source:target,quantile:p50}': gauge(100),
    'stub_latency{integration:mdm,source:target,quantile:p95}': gauge(400),
    'stub_latency{integration:mdm,source:target,quantile:p99}': gauge(1000)
  }
}

const NO_CLOUDWATCH = {
  source: 'unavailable',
  unavailableReason: 'Local runs have no CloudWatch',
  rows: []
}

const statementWith = (overrides = {}) =>
  requiredSlaStatement({
    environment: 'local',
    window: WINDOW,
    callCounts: CALL_COUNTS,
    summaryExport: SUMMARY,
    externalReport: NO_CLOUDWATCH,
    design: TRAFFIC_DEFAULTS,
    ...overrides
  })

const dependencyOf = (statement, name) =>
  statement.dependencies.find(({ dependency }) => dependency === name)

const row = (overrides = {}) => ({
  service: 'trade-imports-reference-data',
  dependency: 'mdm',
  operation: 'get-countries',
  calls: 10,
  p95Ms: 300,
  p99Ms: 800,
  stubProfile: null,
  ...overrides
})

const LATENCY = { p95Ms: 400, p99Ms: 1000 }

describe('design traffic', () => {
  test('turns notifications an hour into notifications and pages a second', () => {
    expect(
      designNotificationsPerSecond(TRAFFIC_DEFAULTS, 'live-animals')
    ).toBeCloseTo(44 / SECONDS_PER_HOUR, 10)
    expect(designPagesPerSecond(TRAFFIC_DEFAULTS, 'live-animals')).toBeCloseTo(
      (44 * 40) / SECONDS_PER_HOUR,
      10
    )
    expect(
      designPagesPerSecond(TRAFFIC_DEFAULTS, 'high-risk-plants')
    ).toBeCloseTo((36 * 50) / SECONDS_PER_HOUR, 10)
  })
})

describe('requiredSlaStatement', () => {
  const statement = statementWith()

  test('names its environment, window and where the calls were counted', () => {
    expect(statement.environment).toBe('local')
    expect(statement.window).toEqual(WINDOW)
    expect(statement.callCountsSource).toBe('call-counts')
  })

  test('lists address lookup first, flagged for both reasons', () => {
    const [first] = statement.dependencies

    expect(first.dependency).toBe('address-lookup')
    expect(first.risk.flagged).toBe(true)
    expect(first.risk.reasons).toEqual([
      'no published service level (§9.5: TBC)',
      'no INS service calls it yet: its SLA is raised now so it is in place before one does'
    ])
    expect(first.met.verdict).toBe('not judged: no caller')
  })

  test('flags every dependency while no service level is published', () => {
    for (const entry of statement.dependencies) {
      expect(entry.risk.flagged).toBe(true)
      expect(entry.risk.reasons).toContain(
        'no published service level (§9.5: TBC)'
      )
    }
  })

  test('states address lookup from D4 and D5 over the design traffic', () => {
    const entry = dependencyOf(statement, 'address-lookup')
    const notificationsPerSecond = (44 + 36) / SECONDS_PER_HOUR

    expect(
      entry.journeys.map(({ callsPerNotification }) => callsPerNotification)
    ).toEqual([6, 6])
    expect(entry.journeys[0].callsPerPage).toBeCloseTo(6 / 40, 10)
    expect(entry.requiredRate.standardPerSecond).toBeCloseTo(
      6 * notificationsPerSecond,
      10
    )
    expect(entry.requiredRate.p99BurstPerSecond).toBeCloseTo(
      6 * notificationsPerSecond * 1.5,
      10
    )
    expect(entry.requiredRate.spikePerSecond).toBeNull()
    expect(entry.requiredRate.note).toContain('240 an hour')
  })

  test('measures defra-id calls a page and a notification for both journeys', () => {
    const entry = dependencyOf(statement, 'defra-id')
    const [animals, plants] = entry.journeys

    expect(animals.callsPerPage).toBeCloseTo(0.05, 10)
    expect(animals.callsPerNotification).toBeCloseTo(0.05 * 40, 10)
    expect(plants.callsPerPage).toBeCloseTo(0.04, 10)
    expect(plants.callsPerNotification).toBeCloseTo(0.04 * 50, 10)
    expect(animals.operations).toEqual([
      { operation: 'jwks', callsPerPage: 0.03 },
      { operation: 'token-exchange', callsPerPage: 0.02 }
    ])
  })

  test('adds the front door sign-ins to defra-id as a derived figure', () => {
    const entry = dependencyOf(statement, 'defra-id')
    const journeyStandard =
      0.05 * ((44 * 40) / SECONDS_PER_HOUR) +
      0.04 * ((36 * 50) / SECONDS_PER_HOUR)

    expect(entry.frontDoor).toMatchObject({ callsPerHour: 600, derived: true })
    expect(entry.requiredRate.standardPerSecond).toBeCloseTo(
      journeyStandard + 600 / SECONDS_PER_HOUR,
      10
    )
    expect(entry.requiredRate.p99BurstPerSecond).toBeCloseTo(
      entry.requiredRate.standardPerSecond * 1.5,
      10
    )
    expect(entry.requiredRate.spikePerSecond).toBeCloseTo(
      5 * 0.05 + 5 * 0.04 + 15,
      10
    )
  })

  test('asks the interim latency of defra-id, trade-token and mdm', () => {
    for (const name of ['defra-id', 'trade-token', 'mdm']) {
      expect(dependencyOf(statement, name).requiredLatency).toMatchObject({
        p50Ms: 100,
        p95Ms: 400,
        p99Ms: 1000
      })
    }

    expect(
      dependencyOf(statement, 'azure-service-bus').requiredLatency
    ).toBeNull()
    expect(dependencyOf(statement, 'address-lookup').requiredLatency).toBeNull()
  })

  test('shares the stub answered count of trade-token and mdm over both journeys pages', () => {
    const tradeToken = dependencyOf(statement, 'trade-token')
    const mdm = dependencyOf(statement, 'mdm')

    expect(tradeToken.journeys[0].callsPerPage).toBeCloseTo(45 / 1500, 10)
    expect(mdm.journeys[0].callsPerPage).toBeCloseTo(90 / 1500, 10)
    expect(mdm.journeys[0].note).toContain('both journeys together')
    expect(mdm.journeys[1].callsPerNotification).toBeCloseTo(
      (90 / 1500) * 50,
      10
    )
  })

  test('works Service Bus messages for each notification from forwarded and first submissions', () => {
    const entry = dependencyOf(statement, 'azure-service-bus')
    const [animals, plants] = entry.journeys

    expect(animals.callsPerNotification).toBe(2)
    expect(animals.callsPerPage).toBeCloseTo(80 / 1000, 10)
    expect(plants.callsPerNotification).toBe(0)
    expect(plants.note).toContain('pbe-022')
    expect(entry.requiredRate.standardPerSecond).toBeCloseTo(
      (2 * 44) / SECONDS_PER_HOUR,
      10
    )
    expect(entry.requiredRate.spikePerSecond).toBeNull()
  })

  test('says Service Bus is not measured by this suite when no forwarded count is recorded', () => {
    const entry = dependencyOf(
      statementWith({ summaryExport: { metrics: {} } }),
      'azure-service-bus'
    )

    expect(entry.journeys[0].note).toBe(
      'not measured: not measured by this suite'
    )
    expect(entry.requiredRate.standardPerSecond).toBeNull()
  })

  test('says a journey is not measured when no call counts were read', () => {
    const entry = dependencyOf(statementWith({ callCounts: null }), 'defra-id')

    expect(statementWith({ callCounts: null }).callCountsSource).toBeNull()
    expect(entry.journeys[0].callsPerPage).toBeNull()
    expect(entry.journeys[0].note).toBe(
      'not measured: no call counts were read in this run'
    )
    expect(entry.requiredRate.standardPerSecond).toBeNull()
  })

  test('judges met only from the per-dependency metrics and names the stub profile', () => {
    expect(new Set(statement.dependencies.map(({ met }) => met.basis))).toEqual(
      new Set(['per-dependency metrics'])
    )
    expect(dependencyOf(statement, 'mdm').stubProfile.profile).toBe('sla')
    expect(
      statement.dependencies.every((entry) => 'stubProfile' in entry)
    ).toBe(true)
  })

  test('says met is not measured, with the reason, where CloudWatch could not be read', () => {
    expect(dependencyOf(statement, 'defra-id').met.verdict).toBe(
      'not measured: Local runs have no CloudWatch'
    )
  })
})

describe('riskOf', () => {
  const dependency = { basis: 'measured' }
  const required = {
    requiredRate: { p99BurstPerSecond: 0.3, spikePerSecond: 15 },
    requiredLatency: LATENCY
  }

  test('flags a dependency with no published service level', () => {
    expect(riskOf({ dependency, required, published: null })).toEqual({
      flagged: true,
      reasons: ['no published service level (§9.5: TBC)']
    })
  })

  test('flags a published throughput below the required spike', () => {
    const risk = riskOf({
      dependency,
      required,
      published: { throughputPerSecond: 10, p95Ms: 300, p99Ms: 900 }
    })

    expect(risk.flagged).toBe(true)
    expect(risk.reasons[0]).toContain('falls short')
  })

  test('falls back to the burst where the spike is TBC', () => {
    const risk = riskOf({
      dependency,
      required: {
        requiredRate: { p99BurstPerSecond: 0.3, spikePerSecond: null },
        requiredLatency: LATENCY
      },
      published: { throughputPerSecond: 0.2, p95Ms: 300, p99Ms: 900 }
    })

    expect(risk.reasons).toHaveLength(1)
    expect(risk.reasons[0]).toContain('falls short of the 0.30 a second')
  })

  test('flags a published latency above the required one', () => {
    const risk = riskOf({
      dependency,
      required,
      published: { throughputPerSecond: 20, p95Ms: 500, p99Ms: 1200 }
    })

    expect(risk.reasons).toEqual([
      'published p95 500ms falls short of the 400ms needed',
      'published p99 1200ms falls short of the 1000ms needed'
    ])
  })

  test('flags a published service level when the required rate was not measured', () => {
    const risk = riskOf({
      dependency,
      required: {
        requiredRate: { spikePerSecond: null, p99BurstPerSecond: null },
        requiredLatency: LATENCY
      },
      published: { throughputPerSecond: 0.05, p95Ms: 300, p99Ms: 900 }
    })

    expect(risk.flagged).toBe(true)
    expect(risk.reasons).toEqual([
      'required rate not measured, cannot compare published throughput'
    ])
  })

  test('flags a published service level that states no throughput', () => {
    const risk = riskOf({
      dependency,
      required,
      published: { p95Ms: 300, p99Ms: 900 }
    })

    expect(risk.flagged).toBe(true)
    expect(risk.reasons).toEqual([
      'published service level states no throughput'
    ])
  })

  test('does not flag a published service level that covers the requirement', () => {
    expect(
      riskOf({
        dependency,
        required,
        published: { throughputPerSecond: 20, p95Ms: 300, p99Ms: 900 }
      })
    ).toEqual({ flagged: false, reasons: [] })
  })
})

describe('metOf', () => {
  const dependency = { basis: 'measured' }

  test('is met when the highest p95 and p99 are within the required latency', () => {
    const met = metOf({
      dependency,
      requiredLatency: LATENCY,
      rows: [
        row(),
        row({ operation: 'get-ports-of-entry', p95Ms: 350, p99Ms: 950 })
      ],
      unavailableReason: null
    })

    expect(met.verdict).toBe('met')
    expect(met.measured).toEqual({ p95Ms: 350, p99Ms: 950, calls: 20 })
    expect(met.basis).toBe('per-dependency metrics')
  })

  test('is not met when a figure is over, and says by how much', () => {
    const met = metOf({
      dependency,
      requiredLatency: LATENCY,
      rows: [row({ p95Ms: 520 })],
      unavailableReason: null
    })

    expect(met.verdict).toBe('NOT MET (p95 520ms against 400ms)')
  })

  test('names the stub profile the calls went to', () => {
    const met = metOf({
      dependency,
      requiredLatency: LATENCY,
      rows: [row({ stubProfile: { profile: 'sla' } })],
      unavailableReason: null
    })

    expect(met.stubProfile).toBe('sla')
    expect(met.reason).toBe(
      'measured against the sla stub, not the real system'
    )
  })

  test('is not measured, with the reason, when CloudWatch could not be read', () => {
    const met = metOf({
      dependency,
      requiredLatency: LATENCY,
      rows: [],
      unavailableReason: 'Local runs have no CloudWatch'
    })

    expect(met.verdict).toBe('not measured: Local runs have no CloudWatch')
  })

  test('is not measured when there were no calls over the window', () => {
    const met = metOf({
      dependency,
      requiredLatency: LATENCY,
      rows: [row({ calls: 0 })],
      unavailableReason: null
    })

    expect(met.verdict).toBe('not measured: no calls over the window')
  })

  test('is not judged when there is no required latency', () => {
    expect(
      metOf({
        dependency,
        requiredLatency: null,
        rows: [row()],
        unavailableReason: null
      }).verdict
    ).toBe('not judged: no required latency (TBC)')
  })

  test('is not judged when nothing calls the dependency', () => {
    expect(
      metOf({
        dependency: { basis: 'no-caller' },
        requiredLatency: null,
        rows: [],
        unavailableReason: null
      }).verdict
    ).toBe('not judged: no caller')
  })
})

describe('requiredSlaLines', () => {
  const lines = requiredSlaLines(statementWith())

  test('opens with the traffic the statement is stated at and where the calls came from', () => {
    expect(lines[0]).toBe(
      'Required service levels (environment local, design-target traffic: standard is the sustained design target, peak the P99 burst (x1.5, T5) and the 10s spike (5 RPS a journey frontend, §4.2)); calls measured from call-counts'
    )
  })

  test('gives one line for each dependency, address lookup first', () => {
    expect(lines).toHaveLength(6)
    expect(lines[1]).toContain(
      'Required SLA address-lookup (APIM / address service owner; SYN-20a, SYN-20b, SYN-20c): no INS service calls it yet; 6 calls a notification (D4 x D5, derived); needs 0.13 a second standard, 0.20 at the P99 burst, spike TBC (D6: type-ahead unknown); latency TBC (§9.5; open item 12); RISK: no published service level (§9.5: TBC)'
    )
    expect(lines[1]).toContain('met: not judged: no caller')
  })

  test('words Service Bus per journey, with the reason high-risk plants sends none', () => {
    expect(lines[5]).toContain(
      'live-animals 0.08 calls a page, 2.0 a notification; high-risk-plants 0 calls (publishes no events today (pbe-022))'
    )
  })

  test('words a calls figure too small to show as below the smallest shown', () => {
    const statement = statementWith({
      summaryExport: {
        metrics: {
          ...SUMMARY.metrics,
          'stub_latency_answered_count{integration:mdm}': gauge(1)
        }
      }
    })

    expect(requiredSlaLines(statement)[4]).toContain('<0.01 calls a page')
  })

  test('words defra-id with its measured calls, the front door and its latency', () => {
    expect(lines[2]).toContain(
      'Required SLA defra-id (Customer Identity; SYN-11, SYN-12, SYN-13): live-animals 0.05 calls a page, 2.0 a notification; high-risk-plants 0.04 calls a page, 2.0 a notification; front door 600 an hour (derived); needs 0.21 a second standard, 0.32 at the P99 burst,'
    )
    expect(lines[2]).toContain(
      'in the spike, at p95 400ms and p99 1000ms; RISK: no published service level (§9.5: TBC); met: not measured: Local runs have no CloudWatch'
    )
  })
})

describe('requiredSlaHtml', () => {
  test('is a complete page with both tables', () => {
    const html = requiredSlaHtml(statementWith())

    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<h2>Required service level per dependency</h2>')
    expect(html).toContain('<h2>Calls per journey</h2>')
    expect(html).toContain('address-lookup')
  })

  test('escapes every value', () => {
    const statement = statementWith()
    const html = requiredSlaHtml({
      ...statement,
      dependencies: [
        {
          ...statement.dependencies[0],
          owner: 'Owner <script>alert(1)</script>'
        },
        ...statement.dependencies.slice(1)
      ]
    })

    expect(html).not.toContain('<script>')
    expect(html).toContain('Owner &lt;script&gt;')
  })
})
