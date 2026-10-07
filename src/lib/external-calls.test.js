import { describe, expect, test } from 'vitest'

import { PAGE_REQUEST_SERVICES } from '../config/call-ratios.js'
import { EXTERNAL_CALLS } from '../config/external-calls.js'
import { STUBBED_INTEGRATIONS } from '../config/stub-profiles.js'
import {
  externalCallHtml,
  externalCallLines,
  externalCallReport,
  metricDataRequest,
  pageRequestCountsFromResults,
  stubProfilesFromSummary
} from './external-calls.js'

const STARTED = '2026-09-29T10:00:17Z'
const ENDED = '2026-09-29T10:07:41Z'

const MDM_INDEX = EXTERNAL_CALLS.findIndex(
  ({ operation }) => operation === 'get-countries'
)

const request = (overrides = {}) =>
  metricDataRequest({
    externalCalls: EXTERNAL_CALLS,
    runStartedAt: STARTED,
    runEndedAt: ENDED,
    ...overrides
  })

describe('metricDataRequest', () => {
  test('rounds the window out to whole minutes and reads it as one period', () => {
    const { StartTime, EndTime, MetricDataQueries } = request()

    expect(StartTime).toBe('2026-09-29T10:00:00.000Z')
    expect(EndTime).toBe('2026-09-29T10:08:00.000Z')
    expect(
      new Set(MetricDataQueries.map(({ MetricStat }) => MetricStat.Period))
    ).toEqual(new Set([480]))
  })

  test('makes the window at least a minute for a short run', () => {
    const { StartTime, EndTime, MetricDataQueries } = request({
      runStartedAt: '2026-09-29T10:00:10Z',
      runEndedAt: '2026-09-29T10:00:15Z'
    })

    expect(StartTime).toBe('2026-09-29T10:00:00.000Z')
    expect(EndTime).toBe('2026-09-29T10:01:00.000Z')
    expect(MetricDataQueries[0].MetricStat.Period).toBe(60)
  })

  test('asks for each statistic of each call, 80 queries in all', () => {
    const { MetricDataQueries, ScanBy } = request()

    expect(ScanBy).toBe('TimestampAscending')
    expect(MetricDataQueries).toHaveLength(80)
    expect(MetricDataQueries[0]).toEqual({
      Id: 'c0_p50ms',
      ReturnData: true,
      MetricStat: {
        Metric: {
          Namespace: 'trade-imports-ins-frontend',
          MetricName: 'ExternalCallDuration',
          Dimensions: [
            { Name: 'Dependency', Value: 'defra-id' },
            { Name: 'Operation', Value: 'openid-configuration' }
          ]
        },
        Period: 480,
        Stat: 'p50'
      }
    })
    const mdmErrorRate = MetricDataQueries.find(
      ({ Id }) => Id === `c${MDM_INDEX}_errorrate`
    )
    expect(mdmErrorRate.MetricStat.Metric).toEqual({
      Namespace: 'trade-imports-reference-data',
      MetricName: 'ExternalCallFailure',
      Dimensions: [
        { Name: 'Dependency', Value: 'mdm' },
        { Name: 'Operation', Value: 'get-countries' }
      ]
    })
    expect(mdmErrorRate.MetricStat.Stat).toBe('Average')
    expect(
      MetricDataQueries.find(({ Id }) => Id === `c${MDM_INDEX}_calls`)
        .MetricStat.Stat
    ).toBe('SampleCount')
  })

  test('gives every query a unique id CloudWatch accepts', () => {
    const ids = request().MetricDataQueries.map(({ Id }) => Id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(/^[a-z][a-zA-Z0-9_]*$/)
    }
  })

  test.each([
    ['runStartedAt', undefined, 'RUN_STARTED_AT must be an ISO date-time'],
    ['runStartedAt', 'yesterday', 'RUN_STARTED_AT must be an ISO date-time'],
    ['runEndedAt', undefined, 'RUN_ENDED_AT must be an ISO date-time'],
    ['runEndedAt', 'later', 'RUN_ENDED_AT must be an ISO date-time']
  ])('throws when %s is %s', (name, value, message) => {
    expect(() => request({ [name]: value })).toThrow(message)
  })

  test('throws when the run ends before it starts', () => {
    expect(() => request({ runStartedAt: ENDED, runEndedAt: STARTED })).toThrow(
      'RUN_ENDED_AT must not be before RUN_STARTED_AT'
    )
  })

  test('asks for no page request counts unless it is given frontends', () => {
    expect(
      request().MetricDataQueries.some(({ Id }) => Id.startsWith('p'))
    ).toBe(false)
  })

  test('asks for the backend calls, their sample count and the session resolutions of each frontend', () => {
    const { MetricDataQueries } = request({
      pageRequestServices: PAGE_REQUEST_SERVICES
    })
    const pageQueries = MetricDataQueries.filter(({ Id }) => Id.startsWith('p'))

    expect(MetricDataQueries).toHaveLength(86)
    expect(pageQueries.map(({ Id }) => Id)).toEqual([
      'p0_backend_sum',
      'p0_backend_count',
      'p0_session_sum',
      'p1_backend_sum',
      'p1_backend_count',
      'p1_session_sum'
    ])
    expect(pageQueries[0]).toEqual({
      Id: 'p0_backend_sum',
      ReturnData: true,
      MetricStat: {
        Metric: {
          Namespace: 'trade-imports-animals-frontend',
          MetricName: 'BackendCalls',
          Dimensions: [{ Name: 'RequestKind', Value: 'page' }]
        },
        Period: 480,
        Stat: 'Sum'
      }
    })
    expect(pageQueries[1].MetricStat.Stat).toBe('SampleCount')
    expect(pageQueries[2].MetricStat.Metric.MetricName).toBe(
      'SessionResolutions'
    )
    expect(pageQueries[3].MetricStat.Metric.Namespace).toBe(
      'trade-imports-plants-frontend'
    )
  })
})

describe('pageRequestCountsFromResults', () => {
  const results = {
    MetricDataResults: [
      { Id: 'p0_backend_sum', Values: [138] },
      { Id: 'p0_backend_count', Values: [100] },
      { Id: 'p0_session_sum', Values: [197] }
    ]
  }

  test('maps a frontend that published to its counts', () => {
    expect(
      pageRequestCountsFromResults(results, PAGE_REQUEST_SERVICES)[
        'live-animals'
      ]
    ).toEqual({ pageRequests: 100, backendCalls: 138, sessionResolutions: 197 })
  })

  test('gives null to a frontend that published nothing', () => {
    expect(
      pageRequestCountsFromResults(results, PAGE_REQUEST_SERVICES)[
        'high-risk-plants'
      ]
    ).toBeNull()
  })

  test('gives null for every journey when CloudWatch could not be read', () => {
    expect(
      pageRequestCountsFromResults(
        { unavailableReason: 'no CloudWatch' },
        PAGE_REQUEST_SERVICES
      )
    ).toEqual({ 'live-animals': null, 'high-risk-plants': null })
  })
})

const stubMetric = (value) => ({
  min: value,
  max: value,
  value,
  thresholds: { 'value>=0': false }
})

const stubSummary = (answeredCount) => ({
  metrics: {
    'stub_profile{integration:mdm,profile:zero-delay}': stubMetric(0),
    'stub_profile{integration:mdm,profile:sla}': stubMetric(1),
    'stub_profile{integration:mdm,profile:not-reported}': stubMetric(0),
    'stub_latency{integration:mdm,source:target,quantile:p50}': stubMetric(100),
    'stub_latency{integration:mdm,source:target,quantile:p95}': stubMetric(400),
    'stub_latency{integration:mdm,source:target,quantile:p99}':
      stubMetric(1000),
    'stub_latency{integration:mdm,source:answered,quantile:p50}':
      stubMetric(104),
    'stub_latency{integration:mdm,source:answered,quantile:p95}':
      stubMetric(410),
    'stub_latency{integration:mdm,source:answered,quantile:p99}':
      stubMetric(990),
    'stub_latency_answered_count{integration:mdm}': stubMetric(answeredCount)
  }
})

describe('stubProfilesFromSummary', () => {
  test('reads the profile a run had, its targets and what the stub answered', () => {
    expect(
      stubProfilesFromSummary(stubSummary(240), STUBBED_INTEGRATIONS)
    ).toEqual({
      mdm: {
        profile: 'sla',
        targets: { p50Ms: 100, p95Ms: 400, p99Ms: 1000 },
        answered: { p50Ms: 104, p95Ms: 410, p99Ms: 990 }
      }
    })
  })

  test('reads values nested under values, as some k6 exports write them', () => {
    const summary = {
      metrics: {
        'stub_profile{integration:mdm,profile:sla}': { values: { value: 1 } }
      }
    }

    expect(
      stubProfilesFromSummary(summary, STUBBED_INTEGRATIONS).mdm.profile
    ).toBe('sla')
  })

  test('gives no answered figures when the stub answered nothing', () => {
    expect(
      stubProfilesFromSummary(stubSummary(0), STUBBED_INTEGRATIONS).mdm.answered
    ).toBeNull()
  })

  test('gives nothing when there is no summary or it names no profile', () => {
    expect(stubProfilesFromSummary(undefined, STUBBED_INTEGRATIONS)).toEqual({})
    expect(
      stubProfilesFromSummary({ metrics: {} }, STUBBED_INTEGRATIONS)
    ).toEqual({})
  })
})

const CALLS = EXTERNAL_CALLS.slice(MDM_INDEX, MDM_INDEX + 2)
const resultsFor = (values) => ({
  MetricDataResults: Object.entries(values).map(([Id, Values]) => ({
    Id,
    Values
  }))
})
const MEASURED = resultsFor({
  c0_p50ms: [98],
  c0_p95ms: [460],
  c0_p99ms: [880.4],
  c0_calls: [240],
  c0_errorrate: [0.0042],
  c1_p50ms: [],
  c1_calls: []
})
const STUB_PROFILES = {
  mdm: {
    profile: 'sla',
    targets: { p50Ms: 100, p95Ms: 400, p99Ms: 1000 },
    answered: { p50Ms: 104, p95Ms: 410, p99Ms: 990 }
  }
}

const report = (overrides = {}) =>
  externalCallReport({
    environment: 'perf-test',
    runStartedAt: STARTED,
    runEndedAt: ENDED,
    externalCalls: CALLS,
    metricResults: MEASURED,
    stubProfiles: STUB_PROFILES,
    ...overrides
  })

describe('externalCallReport', () => {
  test('maps CloudWatch results onto each call, beside its stub profile', () => {
    const { environment, window, source, unavailableReason, rows } = report()

    expect(environment).toBe('perf-test')
    expect(window).toEqual({ startedAt: STARTED, endedAt: ENDED })
    expect(source).toBe('cloudwatch')
    expect(unavailableReason).toBeNull()
    expect(rows[0]).toEqual({
      service: 'trade-imports-reference-data',
      dependency: 'mdm',
      operation: 'get-countries',
      interfaceId: 'SYN-19',
      calls: 240,
      p50Ms: 98,
      p95Ms: 460,
      p99Ms: 880.4,
      errorRate: 0.0042,
      stubProfile: STUB_PROFILES.mdm
    })
  })

  test('reads absent or empty values as null', () => {
    const [, second] = report().rows

    expect(second.calls).toBeNull()
    expect(second.p50Ms).toBeNull()
    expect(second.errorRate).toBeNull()
  })

  test('nulls every measurement when the call count is 0', () => {
    const [first] = report({
      metricResults: resultsFor({
        c0_p50ms: [98],
        c0_calls: [0],
        c0_errorrate: [0]
      })
    }).rows

    expect(first.calls).toBe(0)
    expect(first.p50Ms).toBeNull()
    expect(first.errorRate).toBeNull()
  })

  test('says why the figures are unavailable and leaves every row empty', () => {
    const unavailable = report({
      metricResults: { unavailableReason: 'No AWS CLI' }
    })

    expect(unavailable.source).toBe('unavailable')
    expect(unavailable.unavailableReason).toBe('No AWS CLI')
    for (const row of unavailable.rows) {
      expect(row.calls).toBeNull()
      expect(row.p50Ms).toBeNull()
    }
  })

  test('says so when no CloudWatch results were written at all', () => {
    expect(report({ metricResults: {} }).unavailableReason).toBe(
      'No CloudWatch results were written'
    )
  })

  test('joins the stub profile by dependency and is null when there is none', () => {
    const rows = report({ stubProfiles: {} }).rows

    expect(rows[0].stubProfile).toBeNull()
    expect(report().rows[1].stubProfile).toEqual(STUB_PROFILES.mdm)
  })
})

describe('externalCallLines', () => {
  test('gives one line for each measured call, beside its stub profile', () => {
    expect(externalCallLines(report())).toEqual([
      'External call: trade-imports-reference-data mdm get-countries (SYN-19) p50 98ms, p95 460ms, p99 880ms over 240 calls, 0.42% failed, beside stub profile sla targets p50 100ms, p95 400ms, p99 1000ms'
    ])
  })

  test('says when the suite reported no stub profile, and leaves out an absent interface', () => {
    const [line] = externalCallLines(
      report({
        externalCalls: [
          {
            service: 'trade-imports-dynamics-gateway',
            dependency: 'azure-service-bus',
            operation: 'send-message',
            interfaceId: null
          }
        ],
        metricResults: resultsFor({
          c0_p50ms: [3],
          c0_p95ms: [5],
          c0_p99ms: [9],
          c0_calls: [12],
          c0_errorrate: [0]
        }),
        stubProfiles: {}
      })
    )

    expect(line).toBe(
      'External call: trade-imports-dynamics-gateway azure-service-bus send-message p50 3ms, p95 5ms, p99 9ms over 12 calls, 0.00% failed, beside stub profile not reported by this suite'
    )
  })

  test('says the error rate was not measured when calls were counted but the failure metric is absent', () => {
    const options = {
      metricResults: resultsFor({ c0_calls: [240] })
    }
    const [row] = report(options).rows
    const [line] = externalCallLines(report(options))

    expect(row.calls).toBe(240)
    expect(row.p50Ms).toBeNull()
    expect(row.p95Ms).toBeNull()
    expect(row.p99Ms).toBeNull()
    expect(row.errorRate).toBeNull()
    expect(line).not.toContain('0.00% failed')
    expect(line).toContain('error rate not measured')
  })

  test('says when no call was measured over the run window', () => {
    expect(
      externalCallLines(report({ metricResults: resultsFor({}) }))
    ).toEqual(['External calls: none measured over the run window'])
  })

  test('says why the figures were not read', () => {
    expect(
      externalCallLines(
        report({ metricResults: { unavailableReason: 'No AWS CLI' } })
      )
    ).toEqual(['External calls: not measured: No AWS CLI'])
  })
})

describe('externalCallHtml', () => {
  test('is one header row and one row for each call', () => {
    const html = externalCallHtml(report())

    expect(html).toContain('<h1>External calls</h1>')
    expect(html.match(/<tr>/g)).toHaveLength(1 + CALLS.length)
    expect(html).toContain('Stub target p50/p95/p99 ms')
    expect(html).toContain('perf-test')
    expect(html).toContain('100 / 400 / 1000')
    expect(html).toContain('0.42%')
  })

  test('names the environment and the reason when the figures are unavailable', () => {
    const html = externalCallHtml(
      report({ metricResults: { unavailableReason: 'No AWS CLI' } })
    )

    expect(html).toContain('perf-test')
    expect(html).toContain('No AWS CLI')
  })

  test('shows a dash for anything null', () => {
    const html = externalCallHtml(report({ stubProfiles: {} }))

    expect(html).toContain('>-</td>')
  })

  test('escapes every value', () => {
    const html = externalCallHtml(
      report({
        externalCalls: [
          {
            service: '<script>alert(1)</script>',
            dependency: 'mdm',
            operation: 'get-countries',
            interfaceId: null
          }
        ]
      })
    )

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
