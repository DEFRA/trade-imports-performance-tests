import { describe, expect, test } from 'vitest'

import {
  SERVICE_BUS_ENTRY,
  STUBBED_INTEGRATIONS,
  resolveRequiredStubProfile
} from './stub-profiles.js'

describe('resolveRequiredStubProfile', () => {
  test('requires nothing when STUB_PROFILE is unset or blank', () => {
    expect(resolveRequiredStubProfile({})).toBeUndefined()
    expect(resolveRequiredStubProfile({ STUB_PROFILE: '  ' })).toBeUndefined()
  })

  test('accepts zero-delay and sla, trimmed', () => {
    expect(resolveRequiredStubProfile({ STUB_PROFILE: ' sla ' })).toBe('sla')
    expect(resolveRequiredStubProfile({ STUB_PROFILE: 'zero-delay' })).toBe(
      'zero-delay'
    )
  })

  test('rejects any other profile', () => {
    expect(() => resolveRequiredStubProfile({ STUB_PROFILE: 'fast' })).toThrow(
      'STUB_PROFILE must be zero-delay or sla, or unset.'
    )
  })
})

describe('STUBBED_INTEGRATIONS', () => {
  test('names exactly Defra ID, the Trade token, MDM and Azure Service Bus', () => {
    expect(STUBBED_INTEGRATIONS.map(({ integration }) => integration)).toEqual([
      'defra-id',
      'trade-token',
      'mdm',
      'azure-service-bus'
    ])
  })

  test('lists no SNS, SQS or cdp-uploader entry, which stay real', () => {
    const names = STUBBED_INTEGRATIONS.map(({ integration }) => integration)

    expect(names.filter((name) => /sns|sqs|uploader/.test(name))).toEqual([])
  })

  test('hosts Azure Service Bus in no stub service', () => {
    expect(
      STUBBED_INTEGRATIONS.find(
        ({ integration }) => integration === 'azure-service-bus'
      ).stub
    ).toBeNull()
  })
})

describe('SERVICE_BUS_ENTRY', () => {
  test('is zero-delay, unagreed and never conformed', () => {
    expect(SERVICE_BUS_ENTRY).toMatchObject({
      integration: 'azure-service-bus',
      profile: 'zero-delay',
      agreed: false,
      lastConformed: null,
      stub: null
    })
  })
})
