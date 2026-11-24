import { describe, expect, test } from 'vitest'

import { PAGE_REQUEST_SERVICES } from './call-ratios.js'
import {
  EXTERNAL_CALLS,
  EXTERNAL_CALL_STATISTICS,
  METRIC_SCHEMES,
  SCHEME_BY_SERVICE
} from './external-calls.js'
import { STUBBED_INTEGRATIONS } from './stub-profiles.js'
import { unfrozenPaths } from '../test-support/unfrozen-paths.js'

const defraIdRows = (service) => [
  {
    service,
    dependency: 'defra-id',
    operation: 'openid-configuration',
    interfaceId: null
  },
  {
    service,
    dependency: 'defra-id',
    operation: 'jwks',
    interfaceId: 'SYN-12'
  },
  {
    service,
    dependency: 'defra-id',
    operation: 'token-exchange',
    interfaceId: 'SYN-11'
  },
  {
    service,
    dependency: 'defra-id',
    operation: 'token-refresh',
    interfaceId: 'SYN-13'
  }
]

describe('EXTERNAL_CALLS', () => {
  test('is the 16 calls to systems outside the INS boundary that the report reads, in order', () => {
    expect(EXTERNAL_CALLS).toEqual([
      ...defraIdRows('trade-imports-ins-frontend'),
      ...defraIdRows('trade-imports-animals-frontend'),
      ...defraIdRows('trade-imports-plants-frontend'),
      {
        service: 'trade-imports-reference-data',
        dependency: 'trade-token',
        operation: 'client-credentials-token',
        interfaceId: 'SYN-19'
      },
      {
        service: 'trade-imports-reference-data',
        dependency: 'mdm',
        operation: 'get-countries',
        interfaceId: 'SYN-19'
      },
      {
        service: 'trade-imports-reference-data',
        dependency: 'mdm',
        operation: 'get-ports-of-entry',
        interfaceId: 'SYN-19'
      },
      {
        service: 'trade-imports-dynamics-gateway',
        dependency: 'azure-service-bus',
        operation: 'send-message',
        interfaceId: null
      }
    ])
    expect(EXTERNAL_CALLS).toHaveLength(16)
  })

  test('has no two rows with the same service, dependency and operation', () => {
    const keys = EXTERNAL_CALLS.map(
      ({ service, dependency, operation }) =>
        `${service}/${dependency}/${operation}`
    )

    expect(new Set(keys).size).toBe(keys.length)
  })

  test('names only stubbed integrations, never SNS, SQS or cdp-uploader', () => {
    const integrations = STUBBED_INTEGRATIONS.map(
      ({ integration }) => integration
    )

    for (const { dependency } of EXTERNAL_CALLS) {
      expect(integrations).toContain(dependency)
    }
  })

  test('freezes the list and every row inside it', () => {
    expect(unfrozenPaths(EXTERNAL_CALLS)).toEqual([])
  })
})

describe('SCHEME_BY_SERVICE', () => {
  test('reads external calls PascalCase from ins-frontend and plants-frontend and dotted from the rest, and page requests dotted from animals-frontend and plants-frontend', () => {
    expect(SCHEME_BY_SERVICE).toEqual({
      'trade-imports-ins-frontend': { externalCalls: 'pascal' },
      'trade-imports-animals-frontend': {
        externalCalls: 'dotted',
        pageRequests: 'dotted'
      },
      'trade-imports-plants-frontend': {
        externalCalls: 'pascal',
        pageRequests: 'dotted'
      },
      'trade-imports-reference-data': { externalCalls: 'dotted' },
      'trade-imports-dynamics-gateway': { externalCalls: 'dotted' }
    })
  })

  test('names a METRIC_SCHEMES entry for the external calls of every service in EXTERNAL_CALLS', () => {
    for (const { service } of EXTERNAL_CALLS) {
      expect(Object.keys(METRIC_SCHEMES)).toContain(
        SCHEME_BY_SERVICE[service].externalCalls
      )
    }
  })

  test('names a METRIC_SCHEMES entry for the page requests of every frontend in PAGE_REQUEST_SERVICES', () => {
    for (const { service } of PAGE_REQUEST_SERVICES) {
      expect(Object.keys(METRIC_SCHEMES)).toContain(
        SCHEME_BY_SERVICE[service].pageRequests
      )
    }
  })

  test('freezes the services and every entry inside them', () => {
    expect(unfrozenPaths(SCHEME_BY_SERVICE)).toEqual([])
  })
})

describe('METRIC_SCHEMES', () => {
  test('names the PascalCase and the dotted metrics and dimensions of external calls, and the dotted ones of page requests', () => {
    expect(METRIC_SCHEMES).toEqual({
      pascal: {
        externalCalls: {
          duration: 'ExternalCallDuration',
          failure: 'ExternalCallFailure',
          dependency: 'Dependency',
          operation: 'Operation'
        }
      },
      dotted: {
        externalCalls: {
          duration: 'external.call.duration',
          failure: 'external.call.failure',
          dependency: 'dependency',
          operation: 'operation'
        },
        pageRequests: {
          dimension: { Name: 'request.kind', Value: 'page' },
          backendCalls: 'page.request.backend.calls',
          sessionResolutions: 'page.request.session.resolutions'
        }
      }
    })
  })

  test('freezes the schemes and every scheme inside them', () => {
    expect(unfrozenPaths(METRIC_SCHEMES)).toEqual([])
  })
})

describe('EXTERNAL_CALL_STATISTICS', () => {
  test('reads p50, p95, p99 and the call count from the duration and the error rate from the failure metric', () => {
    expect(
      EXTERNAL_CALL_STATISTICS.map(({ key, metric, stat }) => [
        key,
        metric,
        stat
      ])
    ).toEqual([
      ['p50Ms', 'duration', 'p50'],
      ['p95Ms', 'duration', 'p95'],
      ['p99Ms', 'duration', 'p99'],
      ['calls', 'duration', 'SampleCount'],
      ['errorRate', 'failure', 'Average']
    ])
  })
})
