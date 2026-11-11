import { describe, expect, test } from 'vitest'

import { traderOrganisationHeaders } from './trader-organisation.js'

describe('traderOrganisationHeaders', () => {
  test('returns the Trade-Imports-Organisation-Id header carrying the E2E stub user organisation 5900001', () => {
    expect(traderOrganisationHeaders('5900001')).toEqual({
      'Trade-Imports-Organisation-Id': '5900001'
    })
  })
})
