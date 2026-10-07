import { describe, expect, test } from 'vitest'

import {
  ADDRESS_LOOKUP_DERIVED,
  INTERIM_REQUIRED_LATENCY,
  PUBLISHED_SLAS,
  REQUIRED_SLA_DEPENDENCIES
} from './required-slas.js'
import { STUBBED_INTEGRATIONS } from './stub-profiles.js'

describe('required SLA configuration', () => {
  test('lists address lookup first', () => {
    expect(REQUIRED_SLA_DEPENDENCIES[0].dependency).toBe('address-lookup')
    expect(REQUIRED_SLA_DEPENDENCIES[0].basis).toBe('no-caller')
  })

  test('names every owner as the volumetrics page does', () => {
    expect(
      Object.fromEntries(
        REQUIRED_SLA_DEPENDENCIES.map(({ dependency, owner }) => [
          dependency,
          owner
        ])
      )
    ).toEqual({
      'address-lookup': 'APIM / address service owner',
      'defra-id': 'Customer Identity',
      'trade-token': 'Trade Platform (TBC: no §9.5 row)',
      mdm: 'MDM / data platform team',
      'azure-service-bus': 'TBC: no §9.5 row'
    })
  })

  test('covers every stubbed integration', () => {
    const listed = REQUIRED_SLA_DEPENDENCIES.map(({ dependency }) => dependency)

    for (const { integration } of STUBBED_INTEGRATIONS) {
      expect(listed).toContain(integration)
    }
  })

  test('has a published SLA slot for each dependency, all empty today', () => {
    expect(Object.keys(PUBLISHED_SLAS).sort()).toEqual(
      REQUIRED_SLA_DEPENDENCIES.map(({ dependency }) => dependency).sort()
    )
    expect(Object.values(PUBLISHED_SLAS).every((sla) => sla === null)).toBe(
      true
    )
  })

  test('uses the interim latency the sla stub profiles are fitted to', () => {
    expect(INTERIM_REQUIRED_LATENCY).toMatchObject({
      p50Ms: 100,
      p95Ms: 400,
      p99Ms: 1000
    })
  })

  test('gives address lookup six calls a notification from D4 and D5', () => {
    expect(
      ADDRESS_LOOKUP_DERIVED.addressesPerNotification *
        ADDRESS_LOOKUP_DERIVED.callsPerAddress
    ).toBe(6)
  })
})
