import { describe, expect, test } from 'vitest'

import { DATASTORES } from './background-volume.js'
import { STUBBED_INTEGRATIONS } from './stub-profiles.js'
import {
  backgroundVolumeReportThresholds,
  backgroundVolumeThresholds,
  documentScanThresholds,
  notificationSplitThresholds,
  scenarioThresholds,
  signInTargetThresholds,
  smokeThresholds,
  stubCeilingStepThresholds,
  stubHeadroomReportThresholds,
  stubProfileReportThresholds
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
  const keys = signInTargetThresholds({
    gating: ['defra-id-target-two-journeys'],
    reporting: ['defra-id-target-with-iuu']
  })

  test('gates the two-journey target on failures, checks and dropped iterations', () => {
    expect(
      keys['http_req_failed{scenario:defra-id-target-two-journeys}']
    ).toEqual(['rate<0.01'])
    expect(keys['checks{scenario:defra-id-target-two-journeys}']).toEqual([
      'rate>0.99'
    ])
    expect(
      keys['dropped_iterations{scenario:defra-id-target-two-journeys}']
    ).toEqual(['count<1'])
  })

  test('only reports the with-IUU target', () => {
    expect(keys['http_req_failed{scenario:defra-id-target-with-iuu}']).toEqual([
      'rate>=0'
    ])
    expect(keys['checks{scenario:defra-id-target-with-iuu}']).toEqual([
      'rate>=0'
    ])
    expect(
      keys['dropped_iterations{scenario:defra-id-target-with-iuu}']
    ).toEqual(['count>=0'])
  })

  test('reports the p95 of the profiled requests of both', () => {
    expect(
      keys[
        'http_req_duration{scenario:defra-id-target-two-journeys,profiled:yes}'
      ]
    ).toEqual(['p(95)>=0'])
    expect(
      keys['http_req_duration{scenario:defra-id-target-with-iuu,profiled:yes}']
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
