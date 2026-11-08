import { describe, expect, test } from 'vitest'

import {
  TRADER_ORGANISATION_ID,
  TRADER_ORGANISATION_ID_HEADER,
  traderOrganisationHeaders
} from './trader-organisation.js'

describe('traderOrganisationHeaders', () => {
  test('sends the default E2E organisation id in trader headers', () => {
    expect(traderOrganisationHeaders()).toEqual({
      [TRADER_ORGANISATION_ID_HEADER]: TRADER_ORGANISATION_ID
    })
  })
})
