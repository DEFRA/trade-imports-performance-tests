import { describe, expect, it } from 'vitest'

import {
  TRADER_ORGANISATION_ID,
  TRADER_ORGANISATION_ID_HEADER,
  traderOrganisationHeaders
} from './trader-organisation.js'

describe('traderOrganisationHeaders', () => {
  it('Should send the default E2E organisation id', () => {
    expect(traderOrganisationHeaders()).toEqual({
      [TRADER_ORGANISATION_ID_HEADER]: TRADER_ORGANISATION_ID
    })
  })
})
