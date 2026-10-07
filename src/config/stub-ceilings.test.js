import { describe, expect, test } from 'vitest'

import {
  CEILING_GROUPS,
  SIGN_IN_TARGET,
  ceilingScenarios,
  requiredSignInsPerSecond,
  resolveCeilingGroups,
  resolveCeilingModel,
  resolveDefraIdClient,
  resolveRecordedCeilings
} from './stub-ceilings.js'

const model = resolveCeilingModel({})

describe('requiredSignInsPerSecond', () => {
  test('is twice the design target an hour plus the 5 a second spike', () => {
    expect(requiredSignInsPerSecond(SIGN_IN_TARGET).toFixed(2)).toBe('5.11')
  })
})

describe('resolveCeilingGroups', () => {
  test('runs every group, in order, when none is named', () => {
    expect(resolveCeilingGroups({})).toEqual([...CEILING_GROUPS])
    expect(resolveCeilingGroups({ STUB_CEILING_GROUPS: ' ' })).toEqual([
      'trade-token',
      'mdm',
      'defra-id-target',
      'defra-id'
    ])
  })

  test('puts the named groups in the suite order', () => {
    expect(
      resolveCeilingGroups({ STUB_CEILING_GROUPS: 'mdm, trade-token' })
    ).toEqual(['trade-token', 'mdm'])
  })

  test('throws for a group that does not exist', () => {
    expect(() => resolveCeilingGroups({ STUB_CEILING_GROUPS: 'fast' })).toThrow(
      'STUB_CEILING_GROUPS names an unknown group "fast". Use trade-token, mdm, defra-id-target or defra-id.'
    )
  })
})

describe('resolveCeilingModel', () => {
  test('uses the defaults when nothing overrides them', () => {
    expect(model.stepSeconds).toBe(20)
    expect(model.gapSeconds).toBe(5)
    expect(model.requestTimeout).toBe('10s')
    expect(model.warmUpSignInsPerSecond).toBe(8)
    expect(model.ladders['defra-id']).toEqual([1, 2, 3, 5, 8, 12, 16, 24, 32])
  })

  test('lays an override over the defaults', () => {
    const resolved = resolveCeilingModel({
      STUB_CEILING_MODEL: '{"stepSeconds":30}'
    })

    expect(resolved.stepSeconds).toBe(30)
    expect(resolved.gapSeconds).toBe(5)
  })

  test('replaces a ladder', () => {
    expect(
      resolveCeilingModel({
        STUB_CEILING_MODEL: '{"ladders":{"mdm":[5,10]}}'
      }).ladders.mdm
    ).toEqual([5, 10])
  })

  test('throws for an unknown key', () => {
    expect(() =>
      resolveCeilingModel({ STUB_CEILING_MODEL: '{"ladders":{"fast":[1]}}' })
    ).toThrow('Unknown stub ceiling model key "ladders.fast"')
  })

  test('throws for a ladder that does not increase', () => {
    expect(() =>
      resolveCeilingModel({
        STUB_CEILING_MODEL: '{"ladders":{"mdm":[10,5]}}'
      })
    ).toThrow(
      'Stub ceiling model value "ladders.mdm" must be a non-empty list of positive numbers, each more than the one before'
    )
  })

  test('throws for a step length that is not a whole number', () => {
    expect(() =>
      resolveCeilingModel({ STUB_CEILING_MODEL: '{"stepSeconds":2.5}' })
    ).toThrow('Stub ceiling model value "stepSeconds" must be a whole number')
  })

  test('throws for text that is not JSON', () => {
    expect(() => resolveCeilingModel({ STUB_CEILING_MODEL: 'fast' })).toThrow(
      'STUB_CEILING_MODEL is not valid JSON'
    )
  })
})

describe('ceilingScenarios', () => {
  test('gives the mdm ladder one scenario a step, one after another', () => {
    const { scenarios, stepScenarios, ladders } = ceilingScenarios(model, [
      'mdm'
    ])
    const names = Object.keys(scenarios)

    expect(names).toHaveLength(12)
    expect(names[0]).toBe('ceiling-mdm-0010')
    expect(names.at(-1)).toBe('ceiling-mdm-2400')
    expect(stepScenarios).toEqual(names)
    expect(scenarios['ceiling-mdm-0010']).toMatchObject({
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '20s',
      startTime: '0s',
      maxVUs: 10,
      exec: 'mdmCall',
      tags: { integration: 'mdm' }
    })
    expect(scenarios['ceiling-mdm-0025'].startTime).toBe('25s')
    expect(scenarios['ceiling-mdm-0800']).toMatchObject({
      startTime: '200s',
      rate: 800,
      maxVUs: 800
    })
    expect(ladders.mdm[0]).toEqual({ scenario: 'ceiling-mdm-0010', rate: 10 })
  })

  test('gives the Defra ID target two scenarios in order', () => {
    const { scenarios, stepScenarios } = ceilingScenarios(model, [
      'defra-id-target'
    ])

    expect(Object.keys(scenarios)).toEqual([
      'defra-id-warm-up-target',
      'defra-id-target'
    ])
    expect(stepScenarios).toEqual([])
    expect(scenarios['defra-id-warm-up-target'].duration).toBe('50s')
  })

  test('holds 400 sign-ins an hour, spikes by 5 a second and recovers', () => {
    const { scenarios } = ceilingScenarios(model, ['defra-id-target'])
    const target = scenarios['defra-id-target']

    expect(target).toMatchObject({
      executor: 'ramping-arrival-rate',
      timeUnit: '1h',
      startRate: 400,
      exec: 'defraIdSignIn'
    })
    expect(target.stages).toEqual([
      { duration: '60s', target: 400 },
      { duration: '1s', target: 18400 },
      { duration: '10s', target: 18400 },
      { duration: '1s', target: 400 },
      { duration: '60s', target: 400 }
    ])
  })

  test('starts each Defra ID target scenario after the one before has finished', () => {
    const { scenarios } = ceilingScenarios(model, ['defra-id-target'])

    expect(Object.values(scenarios).map(({ startTime }) => startTime)).toEqual([
      '0s',
      '55s'
    ])
  })

  test('warms the Defra ID ladder with 400 sign-ins kept, then steps by rate x 4 virtual users', () => {
    const { scenarios, ladders } = ceilingScenarios(model, ['defra-id'])
    const names = Object.keys(scenarios)

    expect(names).toHaveLength(10)
    expect(names[0]).toBe('defra-id-warm-up-ladder')
    expect(scenarios['defra-id-warm-up-ladder'].duration).toBe('50s')
    expect(scenarios['defra-id-warm-up-ladder'].exec).toBe('defraIdSignIn')
    expect(scenarios['ceiling-defra-id-0032']).toMatchObject({
      rate: 32,
      maxVUs: 128,
      exec: 'defraIdSignInAndOut'
    })
    expect(ladders['defra-id']).toHaveLength(9)
  })

  test('runs the groups in the order given, one after another', () => {
    const { scenarios } = ceilingScenarios(model, ['trade-token', 'mdm'])

    expect(scenarios['ceiling-mdm-0010'].startTime).toBe('300s')
  })
})

describe('resolveRecordedCeilings', () => {
  const ceiling = {
    rps: 400,
    atLeast: false,
    measured: '2026-10-02',
    source: 'a run'
  }

  test('has nothing for an environment with no recorded ceiling', () => {
    expect(resolveRecordedCeilings({}, 'perf-test')).toEqual({})
  })

  test('lays a run override over the recorded ceilings', () => {
    expect(
      resolveRecordedCeilings(
        { STUB_CEILINGS: JSON.stringify({ mdm: { sla: ceiling } }) },
        'perf-test'
      )
    ).toEqual({ mdm: { sla: ceiling } })
  })

  test('throws, naming the value, for one that is not allowed', () => {
    expect(() =>
      resolveRecordedCeilings(
        { STUB_CEILINGS: JSON.stringify({ mdm: { sla: { rps: 'high' } } }) },
        'local'
      )
    ).toThrow(
      'STUB_CEILINGS value "mdm.sla" must be an rps that is a number of at least 0'
    )
  })

  test('throws for text that is not JSON', () => {
    expect(() =>
      resolveRecordedCeilings({ STUB_CEILINGS: 'high' }, 'local')
    ).toThrow('STUB_CEILINGS is not valid JSON')
  })

  test('returns the recorded local ceilings when nothing overrides them', () => {
    const recorded = resolveRecordedCeilings({ STUB_CEILINGS: '{}' }, 'local')

    expect(recorded['trade-token']['zero-delay']).toMatchObject({
      rps: 2400,
      atLeast: true
    })
    expect(recorded.mdm['zero-delay']).toMatchObject({
      rps: 2400,
      atLeast: true
    })
    expect(recorded['defra-id']['zero-delay']).toMatchObject({
      rps: 96,
      atLeast: true
    })
  })

  test('replaces only the integration an override names, over the recorded local ceilings', () => {
    const override = {
      rps: 999,
      atLeast: false,
      measured: '2026-10-01',
      source: 'test'
    }
    const recorded = resolveRecordedCeilings(
      { STUB_CEILINGS: JSON.stringify({ mdm: { 'zero-delay': override } }) },
      'local'
    )

    expect(recorded.mdm['zero-delay']).toEqual(override)
    expect(recorded['trade-token']['zero-delay']).toMatchObject({
      rps: 2400,
      atLeast: true
    })
    expect(recorded['defra-id']['zero-delay']).toMatchObject({
      rps: 96,
      atLeast: true
    })
  })

  test.each([
    [
      'an atLeast that is not true or false',
      { ...ceiling, atLeast: 'yes' },
      'STUB_CEILINGS value "mdm.sla" must be an atLeast that is true or false'
    ],
    [
      'a measured value that is not a date',
      { ...ceiling, measured: '2 October' },
      'STUB_CEILINGS value "mdm.sla" must be a measured date such as 2026-10-02'
    ],
    [
      'an empty source',
      { ...ceiling, source: '' },
      'STUB_CEILINGS value "mdm.sla" must be a source that says where it was measured'
    ]
  ])('throws for %s', (_name, value, message) => {
    expect(() =>
      resolveRecordedCeilings(
        { STUB_CEILINGS: JSON.stringify({ mdm: { sla: value } }) },
        'local'
      )
    ).toThrow(message)
  })

  test('throws for an integration value that is not an object', () => {
    expect(() =>
      resolveRecordedCeilings(
        { STUB_CEILINGS: JSON.stringify({ mdm: 400 }) },
        'local'
      )
    ).toThrow('STUB_CEILINGS value "mdm" must be an object')
  })

  test('throws for a profile value that is not an object', () => {
    expect(() =>
      resolveRecordedCeilings(
        { STUB_CEILINGS: JSON.stringify({ mdm: { sla: 400 } }) },
        'local'
      )
    ).toThrow('STUB_CEILINGS value "mdm.sla" must be an object')
  })
})

describe('resolveDefraIdClient', () => {
  test('uses a default client', () => {
    expect(resolveDefraIdClient({})).toEqual({
      clientId: 'test-client-id',
      serviceId: 'trade-imports-ins-frontend',
      redirectUri: 'http://stub-ceiling.invalid/auth/sign-in-oidc'
    })
  })

  test('takes the client id from DEFRA_ID_CLIENT_ID', () => {
    expect(
      resolveDefraIdClient({ DEFRA_ID_CLIENT_ID: 'client-7' }).clientId
    ).toBe('client-7')
  })
})
