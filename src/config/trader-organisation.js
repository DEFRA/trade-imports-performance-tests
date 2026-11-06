/**
 * Default E2E stub user (CRN 2100010101) organisation — matches
 * trade-imports-ins-tests `E2E_ORGANISATION_ID` and address-book fixtures.
 */
export const TRADER_ORGANISATION_ID = '5900001'

export const TRADER_ORGANISATION_ID_HEADER = 'Trade-Imports-Organisation-Id'

/** Headers for animals/plants trader notification API calls. */
export const traderOrganisationHeaders = () => ({
  [TRADER_ORGANISATION_ID_HEADER]: TRADER_ORGANISATION_ID
})
