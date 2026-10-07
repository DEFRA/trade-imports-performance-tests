import { describe, expect, test } from 'vitest'

import { SCENARIO_LENGTH_PROFILES } from './design-target.js'
import {
  CALLER_EVIDENCE,
  CASCADE_SCOPE,
  DECLARED_DEGRADATION,
  FAULT_CATALOGUE,
  FAULT_EXPIRY_MARGIN_SECONDS,
  INJECTION_CODES,
  SERVICE_BUS_PROXY,
  STUB_HOSTED_INTEGRATIONS,
  TOXIC_PREFIX,
  faultId,
  notInjectedReason,
  recoveryStepCount,
  resilienceProfileLine,
  resolveResilienceFaults,
  stepsDurationText,
  stubFaultBody,
  toxicBody,
  toxicName
} from './resilience.js'
import { STUBBED_INTEGRATIONS } from './stub-profiles.js'
import { resolveTrafficModel } from './traffic.js'

const model = resolveTrafficModel({})
const localModel = resolveTrafficModel({}, SCENARIO_LENGTH_PROFILES.local)

const kindsOf = (integration) =>
  FAULT_CATALOGUE.filter((fault) => fault.integration === integration).map(
    ({ kind }) => kind
  )

describe('FAULT_CATALOGUE', () => {
  test('lists 18 faults in run order', () => {
    expect(FAULT_CATALOGUE).toHaveLength(18)
    expect(FAULT_CATALOGUE.map(({ id }) => id)).toEqual([
      'defra-id-slow',
      'defra-id-hang',
      'defra-id-reset',
      'defra-id-throttle',
      'defra-id-error',
      'trade-token-slow',
      'trade-token-hang',
      'trade-token-reset',
      'trade-token-throttle',
      'trade-token-error',
      'mdm-slow',
      'mdm-hang',
      'mdm-reset',
      'mdm-throttle',
      'mdm-error',
      'azure-service-bus-slow',
      'azure-service-bus-hang',
      'azure-service-bus-reset'
    ])
  })

  test('faults only stubbed integrations, never SNS, SQS or cdp-uploader', () => {
    const stubbed = STUBBED_INTEGRATIONS.map(({ integration }) => integration)

    for (const { integration, id } of FAULT_CATALOGUE) {
      expect(stubbed).toContain(integration)
      expect(id).not.toMatch(/sns|sqs|cdp-uploader/)
    }
  })

  test('gives Service Bus only slow, hang and reset', () => {
    expect(kindsOf('azure-service-bus')).toEqual(['slow', 'hang', 'reset'])
  })

  test('gives every other integration all five kinds', () => {
    for (const integration of ['defra-id', 'trade-token', 'mdm']) {
      expect(kindsOf(integration)).toEqual([
        'slow',
        'hang',
        'reset',
        'throttle',
        'error'
      ])
    }
  })

  test('hosts each fault where the dependency answers', () => {
    expect(
      Object.fromEntries(
        ['defra-id', 'trade-token', 'mdm', 'azure-service-bus'].map(
          (integration) => [
            integration,
            FAULT_CATALOGUE.find((fault) => fault.integration === integration)
              .host
          ]
        )
      )
    ).toEqual({
      'defra-id': 'trade-imports-defra-id-stub',
      'trade-token': 'trade-imports-stub',
      mdm: 'trade-imports-stub',
      'azure-service-bus': 'toxiproxy'
    })
  })

  test('names a fault from its integration and kind', () => {
    expect(faultId('mdm', 'error')).toBe('mdm-error')
  })

  test('has caller evidence and a cascade scope for every integration', () => {
    for (const { integration } of FAULT_CATALOGUE) {
      expect(CALLER_EVIDENCE[integration]).toBeDefined()
      expect(CASCADE_SCOPE[integration]).toBeDefined()
    }
  })

  test('judges neither journey for a Defra ID cascade', () => {
    expect(CASCADE_SCOPE['defra-id'].scenarios).toEqual([])
    expect(CASCADE_SCOPE['defra-id'].watch).toBe(true)
  })

  test('declares no degradation yet', () => {
    expect(DECLARED_DEGRADATION).toEqual({})
  })
})

describe('STUB_HOSTED_INTEGRATIONS', () => {
  test('lists the integrations a stub hosts', () => {
    expect([...STUB_HOSTED_INTEGRATIONS].sort()).toEqual([
      'defra-id',
      'mdm',
      'trade-token'
    ])
  })
})

describe('resolveResilienceFaults', () => {
  test('throws when the list holds only separators', () => {
    expect(() => resolveResilienceFaults({ RESILIENCE_FAULTS: ',' })).toThrow(
      'RESILIENCE_FAULTS names no fault'
    )
    expect(() => resolveResilienceFaults({ RESILIENCE_FAULTS: ' , ' })).toThrow(
      'RESILIENCE_FAULTS names no fault'
    )
  })

  test('gives every fault when blank or unset', () => {
    expect(resolveResilienceFaults({})).toHaveLength(18)
    expect(resolveResilienceFaults({ RESILIENCE_FAULTS: '  ' })).toHaveLength(
      18
    )
  })

  test('gives the named faults in catalogue order', () => {
    expect(
      resolveResilienceFaults({
        RESILIENCE_FAULTS: 'azure-service-bus:reset, mdm:error'
      }).map(({ id }) => id)
    ).toEqual(['mdm-error', 'azure-service-bus-reset'])
  })

  test('throws naming an unknown fault', () => {
    expect(() =>
      resolveResilienceFaults({ RESILIENCE_FAULTS: 'mdm:error,sqs:error' })
    ).toThrow(
      /^RESILIENCE_FAULTS has an unknown fault: sqs:error\. Known: defra-id:slow, /
    )
  })

  test('refuses a Service Bus throttle, which AMQP cannot do', () => {
    expect(() =>
      resolveResilienceFaults({
        RESILIENCE_FAULTS: 'azure-service-bus:throttle'
      })
    ).toThrow('azure-service-bus:throttle')
  })
})

describe('stubFaultBody', () => {
  test.each([
    ['slow', { kind: 'slow', rate: 1, delayMs: 5000, expiresInSeconds: 150 }],
    [
      'hang',
      { kind: 'hang', rate: 1, delayMs: 120_000, expiresInSeconds: 150 }
    ],
    ['reset', { kind: 'reset', rate: 1, expiresInSeconds: 150 }],
    [
      'throttle',
      {
        kind: 'throttle',
        rate: 0.5,
        retryAfterSeconds: 5,
        expiresInSeconds: 150
      }
    ],
    ['error', { kind: 'error', rate: 0.5, status: 503, expiresInSeconds: 150 }]
  ])('builds the %s body at the defaults', (kind, expected) => {
    expect(stubFaultBody({ kind, model })).toEqual(expected)
  })

  test('expires a margin after the fault window', () => {
    expect(
      stubFaultBody({ kind: 'error', model: localModel }).expiresInSeconds
    ).toBe(60 + FAULT_EXPIRY_MARGIN_SECONDS)
  })
})

describe('toxicBody', () => {
  test.each([
    [
      'slow',
      {
        name: 'resilience-slow',
        type: 'latency',
        stream: 'downstream',
        toxicity: 1,
        attributes: { latency: 5000, jitter: 0 }
      }
    ],
    [
      'hang',
      {
        name: 'resilience-hang',
        type: 'timeout',
        stream: 'downstream',
        toxicity: 1,
        attributes: { timeout: 0 }
      }
    ],
    [
      'reset',
      {
        name: 'resilience-reset',
        type: 'reset_peer',
        stream: 'downstream',
        toxicity: 1,
        attributes: { timeout: 0 }
      }
    ]
  ])('builds the %s toxic', (kind, expected) => {
    expect(toxicBody({ kind, model })).toEqual(expected)
  })

  test('names toxics with the prefix a run clears by', () => {
    expect(toxicName('hang')).toBe(`${TOXIC_PREFIX}hang`)
    expect(SERVICE_BUS_PROXY).toBe('servicebus')
  })
})

describe('resilienceProfileLine', () => {
  test('states the faults and what each applies', () => {
    expect(
      resilienceProfileLine({
        model,
        faults: [
          { id: 'mdm-error' },
          { id: 'azure-service-bus-reset' },
          { id: 'defra-id-error' }
        ]
      })
    ).toBe(
      'Resilience: 3 faults (mdm-error, azure-service-bus-reset, defra-id-error), each 2m injected then 2m cleared in 30s steps; slow 5000ms, hang 120000ms, throttle 429 at 50% with Retry-After 5s, error 503 at 50%; SNS, SQS and cdp-uploader are never faulted'
    )
  })

  test('says fault in the singular for one', () => {
    expect(
      resilienceProfileLine({ model, faults: [{ id: 'mdm-error' }] })
    ).toContain('Resilience: 1 fault (mdm-error)')
  })
})

describe('recovery steps', () => {
  test('counts four steps in the full cleared window', () => {
    expect(recoveryStepCount(model)).toBe(4)
    expect(stepsDurationText(model, 2)).toBe('1m')
  })

  test('counts four 15 second steps at local length', () => {
    expect(recoveryStepCount(localModel)).toBe(4)
    expect(stepsDurationText(localModel, 1)).toBe('15s')
  })
})

describe('notInjectedReason', () => {
  test('words why each fault host could not inject', () => {
    expect(
      notInjectedReason(INJECTION_CODES.STUB_PREDATES_FAULTS, 'local')
    ).toBe('the stub predates fault injection (GET /faults answered 404)')
    expect(notInjectedReason(INJECTION_CODES.HOST_UNREACHABLE, 'local')).toBe(
      'the stub could not be reached'
    )
    expect(
      notInjectedReason(INJECTION_CODES.NO_SERVICE_BUS_PROXY, 'perf-test')
    ).toBe(
      'no Service Bus fault proxy in perf-test: CDP configuration (req-006)'
    )
  })
})
