import { describe, expect, test } from 'vitest'

import {
  resolveEnvironment,
  resolveServiceUrl,
  serviceUrlVariable
} from './target.js'

const SERVICE = 'trade-imports-ins-frontend'

describe('resolveEnvironment', () => {
  test('returns the environment name without surrounding spaces', () => {
    expect(resolveEnvironment({ ENVIRONMENT: ' perf-test ' })).toBe('perf-test')
  })

  test.each([{}, { ENVIRONMENT: '' }, { ENVIRONMENT: '   ' }])(
    'throws when ENVIRONMENT is missing or blank: %o',
    (env) => {
      expect(() => resolveEnvironment(env)).toThrow('ENVIRONMENT is not set')
    }
  )
})

describe('serviceUrlVariable', () => {
  test('turns a service name into its override variable name', () => {
    expect(serviceUrlVariable(SERVICE)).toBe('TRADE_IMPORTS_INS_FRONTEND_URL')
  })
})

describe('resolveServiceUrl', () => {
  test('builds the CDP address from the environment', () => {
    expect(resolveServiceUrl({ ENVIRONMENT: 'perf-test' }, SERVICE)).toBe(
      'https://trade-imports-ins-frontend.perf-test.cdp-int.defra.cloud'
    )
  })

  test('uses the override when one is set, dropping any trailing slash', () => {
    const env = {
      ENVIRONMENT: 'local',
      TRADE_IMPORTS_INS_FRONTEND_URL: 'http://target:8080/'
    }

    expect(resolveServiceUrl(env, SERVICE)).toBe('http://target:8080')
  })

  test('prefers the override over the CDP address', () => {
    const env = {
      ENVIRONMENT: 'perf-test',
      TRADE_IMPORTS_INS_FRONTEND_URL: 'https://elsewhere.example'
    }

    expect(resolveServiceUrl(env, SERVICE)).toBe('https://elsewhere.example')
  })

  test('throws on a local run with no override', () => {
    expect(() => resolveServiceUrl({ ENVIRONMENT: 'local' }, SERVICE)).toThrow(
      'TRADE_IMPORTS_INS_FRONTEND_URL must be set when ENVIRONMENT is local.'
    )
  })

  test('throws when ENVIRONMENT is missing, even with an override', () => {
    const env = { TRADE_IMPORTS_INS_FRONTEND_URL: 'http://target:8080' }

    expect(() => resolveServiceUrl(env, SERVICE)).toThrow(
      'ENVIRONMENT is not set'
    )
  })
})
