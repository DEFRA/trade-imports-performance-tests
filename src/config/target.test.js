import { describe, expect, test } from 'vitest'

import {
  resolveEnvironment,
  resolveLocalhostAlias,
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

  test.each(['prod', 'PROD', ' prod '])(
    'refuses to run against prod: %j',
    (environment) => {
      expect(() => resolveEnvironment({ ENVIRONMENT: environment })).toThrow(
        'Refusing to run against prod'
      )
    }
  )

  test.each(['dev', 'test'])('returns %s unchanged', (environment) => {
    expect(resolveEnvironment({ ENVIRONMENT: environment })).toBe(environment)
  })
})

describe('resolveLocalhostAlias', () => {
  test('returns the alias without surrounding spaces', () => {
    expect(
      resolveLocalhostAlias({ LOCALHOST_ALIAS: ' host.docker.internal ' })
    ).toBe('host.docker.internal')
  })

  test.each([{}, { LOCALHOST_ALIAS: '' }, { LOCALHOST_ALIAS: '   ' }])(
    'falls back to localhost when the alias is missing or blank: %o',
    (env) => {
      expect(resolveLocalhostAlias(env)).toBe('localhost')
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

  test.each([
    [
      'dev',
      'trade-imports-ins-frontend',
      'https://trade-imports-ins-frontend.dev.cdp-int.defra.cloud'
    ],
    [
      'test',
      'trade-imports-plants-frontend',
      'https://trade-imports-plants-frontend.test.cdp-int.defra.cloud'
    ],
    [
      'dev',
      'trade-imports-animals-backend',
      'https://trade-imports-animals-backend.dev.cdp-int.defra.cloud'
    ],
    [
      'test',
      'trade-imports-plants-backend',
      'https://trade-imports-plants-backend.test.cdp-int.defra.cloud'
    ]
  ])('%s resolves %s to its CDP address', (environment, service, expected) => {
    expect(resolveServiceUrl({ ENVIRONMENT: environment }, service)).toBe(
      expected
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

  test('resolves a local run to the workspace stack port on localhost', () => {
    expect(resolveServiceUrl({ ENVIRONMENT: 'local' }, SERVICE)).toBe(
      'http://localhost:3002'
    )
  })

  test('resolves a local run to the alias host when one is set', () => {
    const env = {
      ENVIRONMENT: 'local',
      LOCALHOST_ALIAS: 'host.docker.internal'
    }

    expect(resolveServiceUrl(env, SERVICE)).toBe(
      'http://host.docker.internal:3002'
    )
  })

  test('lets an override win on a local run', () => {
    const env = {
      ENVIRONMENT: 'local',
      LOCALHOST_ALIAS: 'host.docker.internal',
      TRADE_IMPORTS_INS_FRONTEND_URL: 'http://target:8080'
    }

    expect(resolveServiceUrl(env, SERVICE)).toBe('http://target:8080')
  })

  test('throws on a local run of a service with no local port', () => {
    expect(() =>
      resolveServiceUrl({ ENVIRONMENT: 'local' }, 'trade-imports-unknown')
    ).toThrow(
      'TRADE_IMPORTS_UNKNOWN_URL must be set when ENVIRONMENT is local and trade-imports-unknown has no local port.'
    )
  })

  test('throws when ENVIRONMENT is missing, even with an override', () => {
    const env = { TRADE_IMPORTS_INS_FRONTEND_URL: 'http://target:8080' }

    expect(() => resolveServiceUrl(env, SERVICE)).toThrow(
      'ENVIRONMENT is not set'
    )
  })
})
