import { describe, expect, test } from 'vitest'

import {
  backendRouteLine,
  gatewayHeaders,
  isCdpLocal,
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

const GATEWAY = 'https://ephemeral-protected.api.dev.cdp-int.defra.cloud'
const FAKE_KEY = 'test-key'
const CDP_LOCAL_DEV = {
  ENVIRONMENT: 'dev',
  CDP_LOCAL: 'true',
  DEVELOPER_API_KEY: FAKE_KEY
}

describe('isCdpLocal', () => {
  test.each(['true', ' true '])('is true for %j', (value) => {
    expect(isCdpLocal({ CDP_LOCAL: value })).toBe(true)
  })

  test.each([undefined, '', 'false', 'TRUE'])('is false for %j', (value) => {
    expect(isCdpLocal({ CDP_LOCAL: value })).toBe(false)
  })
})

describe('resolveServiceUrl through the protected gateway', () => {
  test.each([
    'trade-imports-animals-backend',
    'trade-imports-plants-backend',
    'trade-imports-ins-backend',
    'trade-imports-reference-data',
    'trade-imports-stub',
    'trade-imports-dynamics-gateway'
  ])('sends %s through the gateway', (service) => {
    expect(resolveServiceUrl(CDP_LOCAL_DEV, service)).toBe(
      `${GATEWAY}/${service}`
    )
  })

  test('uses the gateway of the environment it runs in', () => {
    expect(
      resolveServiceUrl(
        { ...CDP_LOCAL_DEV, ENVIRONMENT: 'test' },
        'trade-imports-animals-backend'
      )
    ).toBe(
      'https://ephemeral-protected.api.test.cdp-int.defra.cloud/trade-imports-animals-backend'
    )
  })

  test.each([
    'trade-imports-ins-frontend',
    'trade-imports-animals-frontend',
    'trade-imports-plants-frontend',
    'trade-imports-defra-id-stub'
  ])('keeps %s on its direct address', (service) => {
    expect(resolveServiceUrl(CDP_LOCAL_DEV, service)).toBe(
      `https://${service}.dev.cdp-int.defra.cloud`
    )
  })

  test('keeps the direct address when CDP_LOCAL is false', () => {
    expect(
      resolveServiceUrl(
        { ...CDP_LOCAL_DEV, CDP_LOCAL: 'false' },
        'trade-imports-animals-backend'
      )
    ).toBe('https://trade-imports-animals-backend.dev.cdp-int.defra.cloud')
  })

  test.each([undefined, '', '  '])(
    'throws for a backend when the key is %j',
    (key) => {
      const env = { ...CDP_LOCAL_DEV, DEVELOPER_API_KEY: key }

      expect(() =>
        resolveServiceUrl(env, 'trade-imports-animals-backend')
      ).toThrow('DEVELOPER_API_KEY is not set')
    }
  )

  test('does not need the key for a frontend', () => {
    const env = { ENVIRONMENT: 'dev', CDP_LOCAL: 'true' }

    expect(resolveServiceUrl(env, 'trade-imports-ins-frontend')).toBe(
      'https://trade-imports-ins-frontend.dev.cdp-int.defra.cloud'
    )
  })

  test('ignores CDP_LOCAL on a local run', () => {
    const env = { ENVIRONMENT: 'local', CDP_LOCAL: 'true' }

    expect(resolveServiceUrl(env, 'trade-imports-animals-backend')).toBe(
      'http://localhost:8085'
    )
  })

  test.each(['prod', 'PROD'])('refuses %s whatever CDP_LOCAL says', (name) => {
    expect(() =>
      resolveServiceUrl(
        { ...CDP_LOCAL_DEV, ENVIRONMENT: name },
        'trade-imports-animals-backend'
      )
    ).toThrow('Refusing to run against prod')
    expect(() =>
      resolveServiceUrl(
        { ENVIRONMENT: name, CDP_LOCAL: 'true' },
        'trade-imports-animals-backend'
      )
    ).toThrow('Refusing to run against prod')
  })

  test('lets an override win without a key', () => {
    const env = {
      ENVIRONMENT: 'dev',
      CDP_LOCAL: 'true',
      TRADE_IMPORTS_ANIMALS_BACKEND_URL: 'http://target:8080'
    }

    expect(resolveServiceUrl(env, 'trade-imports-animals-backend')).toBe(
      'http://target:8080'
    )
  })
})

describe('gatewayHeaders', () => {
  test('gives the key for a URL under the gateway', () => {
    expect(
      gatewayHeaders(CDP_LOCAL_DEV, `${GATEWAY}/trade-imports-stub/health`)
    ).toEqual({ 'x-api-key': FAKE_KEY })
  })

  test.each([
    [
      'a frontend URL',
      CDP_LOCAL_DEV,
      'https://trade-imports-ins-frontend.dev.cdp-int.defra.cloud/'
    ],
    ['an override URL', CDP_LOCAL_DEV, 'http://target:8080/notifications'],
    [
      'another environment’s gateway URL',
      CDP_LOCAL_DEV,
      'https://ephemeral-protected.api.test.cdp-int.defra.cloud/trade-imports-stub'
    ],
    [
      'a gateway URL when CDP_LOCAL is off',
      { ...CDP_LOCAL_DEV, CDP_LOCAL: 'false' },
      `${GATEWAY}/trade-imports-stub`
    ],
    [
      'a gateway URL on a local run',
      { ...CDP_LOCAL_DEV, ENVIRONMENT: 'local' },
      `${GATEWAY}/trade-imports-stub`
    ]
  ])('gives nothing for %s', (_label, env, url) => {
    expect(gatewayHeaders(env, url)).toEqual({})
  })

  test('throws for a gateway URL when the key is missing', () => {
    const env = { ENVIRONMENT: 'dev', CDP_LOCAL: 'true' }

    expect(() => gatewayHeaders(env, `${GATEWAY}/trade-imports-stub`)).toThrow(
      'DEVELOPER_API_KEY is not set'
    )
  })
})

describe('backendRouteLine', () => {
  test('names the gateway and the key’s presence, never the key', () => {
    const line = backendRouteLine(CDP_LOCAL_DEV)

    expect(line).toBe(
      `Backend calls: through CDP's protected gateway ${GATEWAY}/<service> with the developer API key (CDP_LOCAL=true)`
    )
    expect(line).not.toContain(FAKE_KEY)
  })

  test('names the direct addresses without CDP_LOCAL', () => {
    expect(backendRouteLine({ ENVIRONMENT: 'dev' })).toBe(
      'Backend calls: direct to https://<service>.dev.cdp-int.defra.cloud'
    )
  })

  test('names the workspace stack on a local run', () => {
    expect(backendRouteLine({ ENVIRONMENT: 'local', CDP_LOCAL: 'true' })).toBe(
      "Backend calls: the workspace Docker stack's ports"
    )
  })
})
