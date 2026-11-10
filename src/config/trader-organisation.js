export const ORGANISATION_ID_HEADER = 'Trade-Imports-Organisation-Id'

/**
 * Returns the organisation header for the signed-in stub identity.
 *
 * @param {string} organisationId - The organisation the run signed in as.
 * @returns {Record<string, string>}
 */
export const traderOrganisationHeaders = (organisationId) => ({
  [ORGANISATION_ID_HEADER]: organisationId
})
