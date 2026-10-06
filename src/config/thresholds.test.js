import { describe, expect, test } from 'vitest'

import { DATASTORES } from './background-volume.js'
import { HOUR_PHASES } from './design-target.js'
import { SCHEMA_VERSIONS } from './eventing.js'
import { STUBBED_INTEGRATIONS } from './stub-profiles.js'
import {
  INTERIM_TARGETS,
  asReportingOnly,
  backgroundVolumeReportThresholds,
  backgroundVolumeThresholds,
  designTargetReportThresholds,
  designTargetThresholds,
  documentScanThresholds,
  eventArrivalThresholds,
  eventingReportThresholds,
  hourlyReportThresholds,
  notificationSplitThresholds,
  peakDayThresholds,
  reauthenticationReportThresholds,
  runEnvironmentReportThresholds,
  scenarioThresholds,
  serviceBusThresholds,
  signInTargetThresholds,
  smokeThresholds,
  stubCeilingStepThresholds,
  stubHeadroomReportThresholds,
  stubProfileReportThresholds,
  subMetricKey
} from './thresholds.js'

const SCENARIO = 'live-animals'
const ENDPOINTS = ['ins-dashboard', 'animals-backend-list']

const thresholds = scenarioThresholds(SCENARIO, ENDPOINTS)
const limitsOf = (key) => thresholds[key].map(({ threshold }) => threshold)

describe('scenarioThresholds', () => {
  test('scopes every key to the scenario', () => {
    for (const key of Object.keys(thresholds)) {
      expect(key).toContain(`scenario:${SCENARIO}`)
    }
  })

  test('scopes every response time key to an endpoint', () => {
    const durationKeys = Object.keys(thresholds).filter((key) =>
      key.startsWith('http_req_duration')
    )

    expect(durationKeys).toHaveLength(ENDPOINTS.length)

    for (const key of durationKeys) {
      expect(key).toContain('endpoint:')
    }
  })

  test('holds a page endpoint to P95 under 2000ms and P99 under 5000ms', () => {
    expect(
      limitsOf(`http_req_duration{scenario:${SCENARIO},endpoint:ins-dashboard}`)
    ).toEqual(['p(95)<2000', 'p(99)<5000'])
  })

  test('holds an api endpoint to P95 under 200ms and P99 under 1200ms', () => {
    expect(
      limitsOf(
        `http_req_duration{scenario:${SCENARIO},endpoint:animals-backend-list}`
      )
    ).toEqual(['p(95)<200', 'p(99)<1200'])
  })

  test('limits failed requests to under 1%', () => {
    expect(limitsOf(`http_req_failed{scenario:${SCENARIO}}`)).toEqual([
      'rate<0.01'
    ])
  })

  test('requires more than 99% of checks to pass', () => {
    expect(limitsOf(`checks{scenario:${SCENARIO}}`)).toEqual(['rate>0.99'])
  })

  test('fails the run when the open model could not start an iteration on time', () => {
    expect(thresholds[`dropped_iterations{scenario:${SCENARIO}}`]).toEqual([
      'count<1'
    ])
  })

  test('aborts the run on a breach after 30s, for every key but dropped iterations', () => {
    const aborting = Object.entries(thresholds).filter(
      ([key]) => !key.startsWith('dropped_iterations')
    )

    expect(aborting.length).toBeGreaterThan(0)

    for (const [, entries] of aborting) {
      for (const entry of entries) {
        expect(entry).toMatchObject({
          abortOnFail: true,
          delayAbortEval: '30s'
        })
      }
    }
  })

  test('has no other key without an abort', () => {
    const plain = Object.keys(thresholds).filter((key) =>
      thresholds[key].every((entry) => typeof entry === 'string')
    )

    expect(plain).toEqual([`dropped_iterations{scenario:${SCENARIO}}`])
  })

  test('throws for an endpoint outside the catalogue', () => {
    expect(() => scenarioThresholds(SCENARIO, ['no-such-endpoint'])).toThrow(
      'Unknown endpoint "no-such-endpoint"'
    )
  })
})

describe('upload endpoints', () => {
  const upload = scenarioThresholds(SCENARIO, ['animals-documents-upload'])

  test('are held to P99 under 60000ms only, with abort', () => {
    expect(
      upload[
        `http_req_duration{scenario:${SCENARIO},endpoint:animals-documents-upload}`
      ]
    ).toEqual([
      { threshold: 'p(99)<60000', abortOnFail: true, delayAbortEval: '30s' }
    ])
  })
})

describe('documentScanThresholds', () => {
  test('is one key, scoped to the scenario, P99 under 60000ms and never aborting', () => {
    expect(documentScanThresholds('live-animals')).toEqual({
      'document_scan_duration{scenario:live-animals}': ['p(99)<60000']
    })
  })
})

describe('notificationSplitThresholds', () => {
  test('gives each pair a reporting-only count threshold', () => {
    expect(
      notificationSplitThresholds([
        ['live-animals', 'live-animals'],
        ['high-risk-plants', 'potatoes']
      ])
    ).toEqual({
      'notifications_started{scenario:live-animals,notification_type:live-animals}':
        ['count>=0'],
      'notifications_started{scenario:high-risk-plants,notification_type:potatoes}':
        ['count>=0']
    })
  })
})

describe('backgroundVolumeThresholds', () => {
  const background = backgroundVolumeThresholds(['seed-live-animals'])

  test('has the failed-request, checks and dropped-iteration keys only', () => {
    expect(Object.keys(background).sort()).toEqual([
      'checks{scenario:seed-live-animals}',
      'dropped_iterations{scenario:seed-live-animals}',
      'http_req_failed{scenario:seed-live-animals}'
    ])
  })

  test('fails on more than 1% failed requests or fewer than 99% passed checks', () => {
    expect(background['http_req_failed{scenario:seed-live-animals}']).toEqual([
      { threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '30s' }
    ])
    expect(background['checks{scenario:seed-live-animals}']).toEqual([
      { threshold: 'rate>0.99', abortOnFail: true, delayAbortEval: '30s' }
    ])
  })

  test('aborts on failed requests and failed checks after 30s', () => {
    for (const key of [
      'checks{scenario:seed-live-animals}',
      'http_req_failed{scenario:seed-live-animals}'
    ]) {
      for (const entry of background[key]) {
        expect(entry).toMatchObject({
          abortOnFail: true,
          delayAbortEval: '30s'
        })
      }
    }
  })

  test('judges dropped iterations at the end of the run', () => {
    expect(
      background['dropped_iterations{scenario:seed-live-animals}']
    ).toEqual(['count<1'])
  })

  test('sets no response-time threshold', () => {
    expect(
      Object.keys(background).filter((key) => key.includes('http_req_duration'))
    ).toEqual([])
  })
})

describe('backgroundVolumeReportThresholds', () => {
  test('is one reporting-only threshold for each datastore', () => {
    const report = backgroundVolumeReportThresholds(DATASTORES)

    expect(Object.keys(report)).toEqual(
      DATASTORES.map((datastore) => `background_volume{datastore:${datastore}}`)
    )

    for (const limits of Object.values(report)) {
      expect(limits).toEqual(['value>=0'])
    }
  })
})

describe('runEnvironmentReportThresholds', () => {
  test('is one reporting-only threshold naming the environment', () => {
    expect(runEnvironmentReportThresholds('dev')).toEqual({
      'run_environment{environment:dev}': ['value>=0']
    })
  })
})

describe('stubProfileReportThresholds', () => {
  const report = stubProfileReportThresholds(STUBBED_INTEGRATIONS)
  const keysStarting = (prefix) =>
    Object.keys(report).filter((key) => key.startsWith(prefix))

  test('is one profile key for each integration and profile', () => {
    expect(keysStarting('stub_profile{')).toHaveLength(12)
  })

  test('is one flag key for each integration and flag', () => {
    expect(keysStarting('stub_profile_flagged{')).toHaveLength(8)
  })

  test('is a target latency key for every integration and an answered key for each stub-hosted one', () => {
    expect(
      keysStarting('stub_latency{').filter((key) =>
        key.includes('source:target')
      )
    ).toHaveLength(12)
    expect(
      keysStarting('stub_latency{').filter((key) =>
        key.includes('source:answered')
      )
    ).toHaveLength(9)
    expect(
      Object.keys(report).filter(
        (key) =>
          key.includes('azure-service-bus') && key.includes('source:answered')
      )
    ).toEqual([])
  })

  test('is an answered count key for each stub-hosted integration and none for the others', () => {
    const stubHosted = STUBBED_INTEGRATIONS.filter(({ stub }) => stub !== null)

    expect(keysStarting('stub_latency_answered_count{')).toEqual(
      stubHosted.map(
        ({ integration }) =>
          `stub_latency_answered_count{integration:${integration}}`
      )
    )
    expect(stubHosted.length).toBeGreaterThan(0)
    expect(
      keysStarting('stub_latency_answered_count{').filter((key) =>
        key.includes('azure-service-bus')
      )
    ).toEqual([])
  })

  test('is reporting-only: every threshold is value>=0', () => {
    for (const limits of Object.values(report)) {
      expect(limits).toEqual(['value>=0'])
    }
  })
})

describe('smokeThresholds', () => {
  const merged = smokeThresholds({
    'live-animals': { endpoints: ['ins-dashboard'] },
    'high-risk-plants': { endpoints: ['plants-dashboard'] }
  })

  test('keeps every scenario separate', () => {
    expect(Object.keys(merged)).toEqual(
      expect.arrayContaining([
        'http_req_duration{scenario:live-animals,endpoint:ins-dashboard}',
        'http_req_duration{scenario:high-risk-plants,endpoint:plants-dashboard}',
        'checks{scenario:live-animals}',
        'checks{scenario:high-risk-plants}'
      ])
    )
  })

  test('has no unscoped key, so the readiness wait is never measured', () => {
    const unscoped = ['http_req_duration', 'http_req_failed', 'checks']

    for (const key of Object.keys(merged)) {
      expect(unscoped).not.toContain(key)
      expect(key).toContain('scenario:')
    }
  })
})

describe('stubCeilingStepThresholds', () => {
  const keys = stubCeilingStepThresholds(['ceiling-mdm-0010'])

  test('gives the five figures of a step', () => {
    expect(Object.keys(keys)).toEqual([
      'http_req_failed{scenario:ceiling-mdm-0010}',
      'checks{scenario:ceiling-mdm-0010}',
      'dropped_iterations{scenario:ceiling-mdm-0010}',
      'iterations{scenario:ceiling-mdm-0010}',
      'http_req_duration{scenario:ceiling-mdm-0010,profiled:yes}'
    ])
  })

  test('can never fail', () => {
    expect(Object.values(keys).flat()).toEqual([
      'rate>=0',
      'rate>=0',
      'count>=0',
      'count>=0',
      'p(95)>=0'
    ])
  })
})

describe('signInTargetThresholds', () => {
  const keys = signInTargetThresholds(['defra-id-target'])

  test('gates the target on failures, checks and dropped iterations', () => {
    expect(keys['http_req_failed{scenario:defra-id-target}']).toEqual([
      'rate<0.01'
    ])
    expect(keys['checks{scenario:defra-id-target}']).toEqual(['rate>0.99'])
    expect(keys['dropped_iterations{scenario:defra-id-target}']).toEqual([
      'count<1'
    ])
  })

  test('reports the p95 of the profiled requests', () => {
    expect(
      keys['http_req_duration{scenario:defra-id-target,profiled:yes}']
    ).toEqual(['p(95)>=0'])
  })
})

describe('stubHeadroomReportThresholds', () => {
  const keys = Object.keys(stubHeadroomReportThresholds(STUBBED_INTEGRATIONS))

  test('has a load for each measure of each stub-hosted integration', () => {
    expect(keys.filter((key) => key.startsWith('stub_load'))).toHaveLength(6)
  })

  test('has a ceiling and a headroom for each stub-hosted integration', () => {
    expect(keys.filter((key) => key.startsWith('stub_ceiling'))).toHaveLength(3)
    expect(keys.filter((key) => key.startsWith('stub_headroom'))).toHaveLength(
      3
    )
  })

  test('has the trust verdict and nothing for Azure Service Bus', () => {
    expect(keys).toContain('run_trusted')
    expect(keys.filter((key) => key.includes('azure-service-bus'))).toEqual([])
  })

  test('can never fail', () => {
    expect(
      Object.values(stubHeadroomReportThresholds(STUBBED_INTEGRATIONS)).flat()
    ).toEqual(Array(13).fill('value>=0'))
  })
})

describe('subMetricKey', () => {
  test('spells a sub-metric the way k6 keys its summary', () => {
    expect(
      subMetricKey('http_req_duration', {
        scenario: 'a',
        endpoint: 'b',
        phase: 'hold'
      })
    ).toBe('http_req_duration{scenario:a,endpoint:b,phase:hold}')
  })
})

describe('scenarioThresholds with a phase', () => {
  const scoped = scenarioThresholds(SCENARIO, ENDPOINTS, 'hold')

  test('scopes every response time key to the phase', () => {
    const durationKeys = Object.keys(scoped).filter((key) =>
      key.startsWith('http_req_duration')
    )

    expect(durationKeys).toHaveLength(ENDPOINTS.length)

    for (const key of durationKeys) {
      expect(key.endsWith(',phase:hold}')).toBe(true)
    }
  })

  test('leaves the health keys as they are without a phase', () => {
    const health = (set) =>
      Object.entries(set).filter(
        ([key]) => !key.startsWith('http_req_duration')
      )

    expect(health(scoped)).toEqual(health(thresholds))
  })
})

describe('asReportingOnly', () => {
  test('maps each metric to a limit that can never fail', () => {
    expect(
      asReportingOnly({
        'http_req_duration{scenario:a}': [],
        'session_seconds{phase:hold}': [],
        'document_scan_duration{scenario:a}': [],
        'http_req_failed{scenario:a}': [],
        'checks{scenario:a}': [],
        'server_errors{scenario:a}': [],
        'dashboard_read_share{phase:hold}': [],
        'dropped_iterations{scenario:a}': [],
        'page_requests{scenario:a}': [],
        'notifications_started{scenario:a}': [],
        run_trusted: []
      })
    ).toEqual({
      'http_req_duration{scenario:a}': ['p(95)>=0'],
      'session_seconds{phase:hold}': ['p(95)>=0'],
      'document_scan_duration{scenario:a}': ['p(95)>=0'],
      'http_req_failed{scenario:a}': ['rate>=0'],
      'checks{scenario:a}': ['rate>=0'],
      'server_errors{scenario:a}': ['rate>=0'],
      'dashboard_read_share{phase:hold}': ['rate>=0'],
      'dropped_iterations{scenario:a}': ['count>=0'],
      'page_requests{scenario:a}': ['count>=0'],
      'notifications_started{scenario:a}': ['count>=0'],
      run_trusted: ['value>=0']
    })
  })
})

describe('designTargetThresholds', () => {
  const scenarioSet = { [SCENARIO]: { endpoints: ENDPOINTS } }

  test('judges sustained-peak response times in the hold phase without aborting, and still aborts on failed requests', () => {
    const set = designTargetThresholds({
      shape: 'sustained-peak',
      scenarioSet
    })
    const key = `http_req_duration{scenario:${SCENARIO},endpoint:ins-dashboard,phase:hold}`

    expect(set[key]).toEqual(['p(95)<2000', 'p(99)<5000'])
    expect(set[key].some((entry) => entry.abortOnFail)).toBe(false)
    expect(set[`http_req_failed{scenario:${SCENARIO}}`][0].abortOnFail).toBe(
      true
    )
  })

  test('judges sustained-peak failures, checks and dropped iterations over the whole scenario', () => {
    const set = designTargetThresholds({
      shape: 'sustained-peak',
      scenarioSet
    })

    expect(Object.keys(set)).toEqual(
      expect.arrayContaining([
        `http_req_failed{scenario:${SCENARIO}}`,
        `checks{scenario:${SCENARIO}}`,
        `dropped_iterations{scenario:${SCENARIO}}`
      ])
    )
  })

  test('gates the burst run on 5xx in the burst minute, checks and dropped iterations', () => {
    const set = designTargetThresholds({
      shape: 'p99-burst',
      scenarioSet
    })

    expect(set[`server_errors{scenario:${SCENARIO},phase:burst}`]).toEqual([
      'rate<0.01'
    ])
    expect(set[`checks{scenario:${SCENARIO}}`]).toEqual(['rate>0.99'])
    expect(set[`dropped_iterations{scenario:${SCENARIO}}`]).toEqual(['count<1'])
  })

  test('only reports the burst run peak-phase response times, and never aborts', () => {
    const set = designTargetThresholds({
      shape: 'p99-burst',
      scenarioSet
    })
    const key = `http_req_duration{scenario:${SCENARIO},endpoint:ins-dashboard,phase:peak}`

    expect(set[key]).toEqual(['p(95)>=0'])

    for (const limits of Object.values(set)) {
      expect(limits.every((limit) => typeof limit === 'string')).toBe(true)
    }
  })

  test('judges average-load response times, failed requests and checks over the whole run, without aborting', () => {
    const set = designTargetThresholds({
      shape: 'average-load',
      scenarioSet
    })
    const key = `http_req_duration{scenario:${SCENARIO},endpoint:ins-dashboard}`

    expect(set[key]).toEqual(['p(95)<2000', 'p(99)<5000'])
    expect(set[`http_req_failed{scenario:${SCENARIO}}`]).toEqual(['rate<0.01'])
    expect(set[`checks{scenario:${SCENARIO}}`]).toEqual(['rate>0.99'])
    expect(set[`dropped_iterations{scenario:${SCENARIO}}`]).toEqual(['count<1'])
    expect(Object.keys(set).some((name) => name.includes('phase:'))).toBe(false)

    for (const limits of Object.values(set)) {
      expect(limits.every((limit) => typeof limit === 'string')).toBe(true)
    }
  })
})

describe('hourlyReportThresholds', () => {
  const set = hourlyReportThresholds({
    scenarioSet: {
      'live-animals': { endpoints: ['ins-dashboard'] },
      'high-risk-plants': { endpoints: ['ins-dashboard'] },
      'ins-front-door': { endpoints: ['ins-dashboard'] }
    },
    phases: HOUR_PHASES
  })

  test('holds the eleven keys of each hour', () => {
    expect(Object.keys(set)).toHaveLength(264)
  })

  test('holds each hour for each journey and for the front door', () => {
    expect(set).toHaveProperty([
      'notifications_started{scenario:live-animals,phase:hour-11}'
    ])
    expect(set).toHaveProperty([
      'session_seconds{scenario:high-risk-plants,phase:hour-00}'
    ])
    expect(set).toHaveProperty(['page_requests{frontend:ins,phase:hour-23}'])
    expect(set).toHaveProperty([
      'page_requests{traffic_class:sign-in,phase:hour-06}'
    ])
  })

  test('holds no notification count for the front door', () => {
    expect(
      Object.keys(set).some(
        (key) =>
          key.startsWith('notifications_started') &&
          key.includes('ins-front-door')
      )
    ).toBe(false)
  })

  test('can never fail', () => {
    for (const limits of Object.values(set)) {
      expect(limits).toHaveLength(1)
      expect(limits[0].endsWith('>=0')).toBe(true)
    }
  })
})

describe('designTargetReportThresholds', () => {
  const set = designTargetReportThresholds({
    scenarioSet: {
      [SCENARIO]: { endpoints: ['animals-origin', 'animals-backend-list'] }
    },
    phases: ['peak', 'burst']
  })

  test('holds the run-wide frontend and sign-in keys for each phase', () => {
    for (const phase of ['peak', 'burst']) {
      expect(set).toHaveProperty([`page_requests{frontend:ins,phase:${phase}}`])
      expect(set).toHaveProperty([
        `page_requests{frontend:animals,phase:${phase}}`
      ])
      expect(set).toHaveProperty([
        `page_requests{traffic_class:sign-in,phase:${phase}}`
      ])
    }
  })

  test('holds a key for each request kind the scenario makes', () => {
    expect(set).toHaveProperty([
      `http_req_duration{scenario:${SCENARIO},kind:page,phase:peak}`
    ])
    expect(set).toHaveProperty([
      `http_req_duration{scenario:${SCENARIO},kind:api,phase:burst}`
    ])
  })

  test('can never fail', () => {
    for (const limits of Object.values(set)) {
      expect(limits).toHaveLength(1)
      expect(limits[0].endsWith('>=0')).toBe(true)
    }
  })
})

describe('INTERIM_TARGETS.burst', () => {
  test('is c-004: 5xx under 1%, P95 within twice the peak, 10 samples to judge', () => {
    expect(INTERIM_TARGETS.burst).toEqual({
      maxServerErrorRate: 0.01,
      p95FactorOverPeak: 2,
      minSamples: 10
    })
  })
})

describe('designTargetThresholds for spike and recovery', () => {
  const scenarioSet = { [SCENARIO]: { endpoints: ENDPOINTS } }
  const set = designTargetThresholds({
    shape: 'spike-recovery',
    scenarioSet
  })

  test('judges response times in the baseline phase, without aborting', () => {
    const key = `http_req_duration{scenario:${SCENARIO},endpoint:ins-dashboard,phase:baseline}`

    expect(set[key]).toEqual(['p(95)<2000', 'p(99)<5000'])
  })

  test('judges failed requests, checks and dropped iterations at the end, without aborting', () => {
    expect(set[`http_req_failed{scenario:${SCENARIO}}`]).toEqual(['rate<0.01'])
    expect(set[`checks{scenario:${SCENARIO}}`]).toEqual(['rate>0.99'])
    expect(set[`dropped_iterations{scenario:${SCENARIO}}`]).toEqual(['count<1'])

    for (const limits of Object.values(set)) {
      expect(limits.every((limit) => typeof limit === 'string')).toBe(true)
    }
  })

  test('fails the run on sign-in failures in the spike or the recovery, and on dead-letter growth', () => {
    expect(set['http_req_failed{endpoint:sign-in,phase:spike}']).toEqual([
      'rate<0.01'
    ])
    expect(set['http_req_failed{endpoint:sign-in,phase:recovery}']).toEqual([
      'rate<0.01'
    ])
    expect(set['downstream_dead_letters{downstream:service-bus}']).toEqual([
      'value<1'
    ])
  })

  test('never judges response times in the spike phase', () => {
    expect(
      Object.keys(set).filter(
        (key) =>
          key.startsWith('http_req_duration') && key.includes('phase:spike')
      )
    ).toEqual([])
  })
})

describe('designTargetThresholds for endurance', () => {
  const scenarioSet = {
    'high-risk-plants': { endpoints: ENDPOINTS },
    'returning-animals': { endpoints: ['sign-in', 'animals-dashboard'] },
    'returning-ins': { endpoints: ['sign-in', 'ins-dashboard'] }
  }
  const set = designTargetThresholds({
    shape: 'endurance',
    scenarioSet
  })

  test('fails the run on a transport error in any scenario', () => {
    expect(set['transport_errors{scenario:high-risk-plants}']).toEqual([
      'count<1'
    ])
    expect(set['transport_errors{scenario:returning-ins}']).toEqual(['count<1'])
  })

  test('needs a re-authentication from each returning user only', () => {
    expect(set['reauthentications{scenario:returning-animals}']).toEqual([
      'count>=1'
    ])
    expect(set['reauthentications{scenario:high-risk-plants}']).toBeUndefined()
  })

  test('judges each returning scenario against the page limits over the whole run', () => {
    expect(
      set['http_req_duration{scenario:returning-ins,endpoint:sign-in}']
    ).toEqual(['p(95)<2000', 'p(99)<5000'])
  })

  test('judges failures, checks and dropped iterations at the end and fails on dead-letter growth', () => {
    expect(set['http_req_failed{scenario:high-risk-plants}']).toEqual([
      'rate<0.01'
    ])
    expect(set['downstream_dead_letters{downstream:service-bus}']).toEqual([
      'value<1'
    ])
    expect(Object.keys(set).some((key) => key.includes('phase:'))).toBe(false)
  })
})

describe('reauthenticationReportThresholds', () => {
  test('names the re-authentication traffic and the transport errors, all reporting-only', () => {
    const set = reauthenticationReportThresholds()

    expect(Object.keys(set)).toEqual([
      'http_req_duration{auth:re-authentication}',
      'http_req_failed{auth:re-authentication}',
      'page_requests{traffic_class:re-authentication}',
      'transport_errors'
    ])

    for (const limits of Object.values(set)) {
      expect(limits).toHaveLength(1)
      expect(limits[0].endsWith('>=0')).toBe(true)
    }
  })
})

describe('INTERIM_TARGETS for spike and endurance', () => {
  test('is c-004: P95 back within 10% of the baseline, final hour within 1.2 times the first', () => {
    expect(INTERIM_TARGETS.spike).toEqual({
      p95FactorOverBaseline: 1.1,
      minSamples: 10,
      maxSignInFailureRate: 0.01
    })
    expect(INTERIM_TARGETS.endurance).toEqual({
      p95FactorOverFirstHour: 1.2,
      minSamples: 10
    })
  })
})

describe('eventArrivalThresholds', () => {
  test('requires every live-animals notification to arrive, and names no other journey', () => {
    expect(
      eventArrivalThresholds({
        'ins-front-door': {},
        'live-animals': {},
        'high-risk-plants': {}
      })
    ).toEqual({ 'event_arrivals{scenario:live-animals}': ['rate==1'] })
  })

  test('has no threshold for a set with no publishing journey', () => {
    expect(eventArrivalThresholds({ 'high-risk-plants': {} })).toEqual({})
  })
})

describe('serviceBusThresholds', () => {
  test('gates the v0.1.0 count at one or more in local, and reports v0.2.0', () => {
    expect(serviceBusThresholds('local')).toEqual({
      'service_bus_forwarded{schema_version:0.1.0}': ['value>=1'],
      'service_bus_forwarded{schema_version:0.2.0}': ['value>=0']
    })
  })

  test('only reports both counts outside local', () => {
    expect(serviceBusThresholds('test')).toEqual({
      'service_bus_forwarded{schema_version:0.1.0}': ['value>=0'],
      'service_bus_forwarded{schema_version:0.2.0}': ['value>=0']
    })
  })
})

describe('eventingReportThresholds', () => {
  const set = eventingReportThresholds()

  test('names the submissions of both journeys, both kinds', () => {
    for (const scenario of ['live-animals', 'high-risk-plants']) {
      for (const submission of ['first', 'amendment']) {
        expect(
          set[
            `notifications_submitted{scenario:${scenario},submission:${submission}}`
          ]
        ).toEqual(['count>=0'])
      }
    }
  })

  test('names events published and arrival times for live animals alone', () => {
    expect(set['external_events_published{scenario:live-animals}']).toEqual([
      'count>=0'
    ])
    expect(set['event_arrival_seconds{scenario:live-animals}']).toEqual([
      'p(95)>=0'
    ])
    expect(
      Object.keys(set).filter((key) => key.includes('high-risk-plants'))
    ).toEqual([
      'notifications_submitted{scenario:high-risk-plants,submission:first}',
      'notifications_submitted{scenario:high-risk-plants,submission:amendment}'
    ])
  })

  test('names the watch gauges and the outbound counter', () => {
    expect(set.eventing_backlog_depth).toEqual(['value>=0'])
    expect(set.eventing_backlog_pre_burst_depth).toEqual(['value>=0'])
    expect(set.eventing_backlog_peak_depth).toEqual(['value>=0'])
    expect(set.eventing_backlog_drain_seconds).toEqual(['value>=0'])
    expect(set.eventing_backlog_drained).toEqual(['rate>=0'])
    expect(set.service_bus_peak_per_second).toEqual(['value>=0'])
    expect(set.service_bus_forwarded_messages).toEqual(['count>=0'])
  })

  test('keeps the forwarded count of every schema version', () => {
    for (const version of SCHEMA_VERSIONS) {
      expect(Object.keys(set)).toContain(
        subMetricKey('service_bus_forwarded', { schema_version: version })
      )
    }
  })

  test('leaves the smoke gate on the first version when the gate is spread after it', () => {
    const smoke = {
      ...eventingReportThresholds(),
      ...serviceBusThresholds('local')
    }

    expect(
      smoke[
        subMetricKey('service_bus_forwarded', {
          schema_version: SCHEMA_VERSIONS[0]
        })
      ]
    ).toEqual(['value>=1'])
  })

  test('can never fail: every limit is always true', () => {
    for (const limits of Object.values(set)) {
      expect(limits).toHaveLength(1)
      expect(limits[0].endsWith('>=0')).toBe(true)
    }
  })
})

describe('peakDayThresholds', () => {
  const set = peakDayThresholds({ 'live-animals': {}, 'high-risk-plants': {} })

  test('judges each journey at the end of the run, with no abort', () => {
    for (const scenario of ['live-animals', 'high-risk-plants']) {
      expect(set[`http_req_failed{scenario:${scenario}}`]).toEqual([
        'rate<0.01'
      ])
      expect(set[`checks{scenario:${scenario}}`]).toEqual(['rate>0.99'])
      expect(set[`dropped_iterations{scenario:${scenario}}`]).toEqual([
        'count<1'
      ])
    }
  })

  test('gates only live animals on arrival', () => {
    expect(set['event_arrivals{scenario:live-animals}']).toEqual(['rate==1'])
    expect(
      Object.keys(set).filter((key) => key.startsWith('event_arrivals'))
    ).toEqual(['event_arrivals{scenario:live-animals}'])
  })
})
