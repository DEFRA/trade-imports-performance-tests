export const ADDRESS_BOOK = '/address-book'

export const ADDRESS_TYPES = Object.freeze({
  ORIGIN_OR_CONSIGNOR: 'ORIGIN_OR_CONSIGNOR',
  DESTINATION_CONSIGNEE_OR_IMPORTER: 'DESTINATION_CONSIGNEE_OR_IMPORTER',
  BRANCH: 'BRANCH'
})

/**
 * Finds the id of the first address a list page links to.
 *
 * The add page's link has the same shape as an address's, so it is skipped.
 *
 * @param {string[]} hrefs - Link targets read off the address book list.
 * @returns {string} The id, or an empty string when the page lists no address.
 */
export const addressIdFrom = (hrefs) =>
  hrefs
    .map((href) => /^\/address-book\/([^/?#]+)$/.exec(href)?.[1])
    .find((id) => Boolean(id) && id !== 'add') ?? ''

/**
 * Builds the worst-case free-text address search term.
 *
 * @param {number} length - The term's length in characters.
 * @returns {string} The term.
 */
export const worstCaseSearchTerm = (length) =>
  'Worst case search '.padEnd(length, 'x')

/**
 * Builds the path of the address book list on one address type's tab.
 *
 * @param {string} addressType - One of the {@link ADDRESS_TYPES}.
 * @param {object} [options] - List settings.
 * @param {string} [options.searchTerm] - A free-text search to apply on that tab.
 * @returns {string} The path, with the tab first and then the encoded search term when one is given.
 */
export const addressBookListPath = (addressType, { searchTerm } = {}) => {
  const tabPath = `${ADDRESS_BOOK}?addressType=${addressType}`

  return searchTerm === undefined
    ? tabPath
    : `${tabPath}&q=${encodeURIComponent(searchTerm)}`
}
