const ADDRESS_LINK = /^\/address-book\/([^/?#]+)$/
const ADD_PAGE = 'add'

const isAddressId = (id) => Boolean(id) && id !== ADD_PAGE

/**
 * Finds the id of the first address a list page links to.
 *
 * The add page's link has the same shape as an address's, so it is skipped.
 *
 * @param {string[]} hrefs - Link targets read off the address book list.
 * @returns {string} The id, or an empty string when the page lists no address.
 */
export const addressIdFrom = (hrefs) =>
  hrefs.map((href) => ADDRESS_LINK.exec(href)?.[1]).find(isAddressId) ?? ''

const WORST_CASE_PREFIX = 'Worst case search '
const WORST_CASE_FILLER = 'x'

/**
 * Builds the worst-case free-text address search term.
 *
 * The address book matches a term against name, town and postcode as an
 * unanchored regular expression, so the worst case is the longest term that
 * matches no stored address: it forces the match over every active address of
 * the organisation. The length is the longest searchable field.
 *
 * @param {number} length - The term's length in characters.
 * @returns {string} The term.
 */
export const worstCaseSearchTerm = (length) =>
  WORST_CASE_PREFIX.padEnd(length, WORST_CASE_FILLER)
