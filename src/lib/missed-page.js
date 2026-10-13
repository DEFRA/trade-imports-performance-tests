/**
 * Names what a page showed instead of the one a check expected, so a failed
 * check says whether it was a sign-in error page, an error status or a
 * redirect loop rather than leaving only a pass rate.
 *
 * @param {string} expected - The page the check wanted, such as "INS dashboard".
 * @param {{ status: number, url: string, heading: string, tooManyRedirects?: boolean }} page - The page that answered.
 * @returns {string} One line for the run's log.
 */
export const describeMissedPage = (
  expected,
  { status, url, heading, tooManyRedirects = false }
) =>
  `${expected} did not open: status ${status} at ${url}, heading ${JSON.stringify(heading)}${tooManyRedirects ? ', after too many redirects' : ''}`
