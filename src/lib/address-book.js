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
