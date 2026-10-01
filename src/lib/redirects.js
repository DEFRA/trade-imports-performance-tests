const ABSOLUTE_URL = /^https?:\/\//
const ORIGIN = /^https?:\/\/[^/?#]+/
const LOCALHOST_HOST = /^(https?:\/\/)localhost(?=[:/?#]|$)/
const STALE_ACTION = /[?&]staleAction=1(&|#|$)/

const pathOf = (url) => url.replace(ORIGIN, '').split(/[?#]/)[0]

/**
 * Reads the scheme, host and port of an absolute URL.
 *
 * @param {string} url - An absolute `http` or `https` URL.
 * @returns {string} For example `http://localhost:3002`.
 */
export const originOf = (url) => {
  const match = ORIGIN.exec(url)

  if (!match) {
    throw new Error(`Not an absolute URL: ${url}`)
  }

  return match[0]
}

/**
 * Turns a redirect `Location` header into an absolute URL.
 *
 * The frontends send browser-visible `localhost` addresses. A run inside a
 * container reaches the machine's `localhost` through an alias, so the host is
 * swapped for it, as Playwright's host resolver rules do for the E2E suite.
 *
 * @param {string} fromUrl - The URL that answered with the redirect.
 * @param {string} location - The `Location` header value.
 * @param {string} [localhostAlias] - The host to use in place of `localhost`.
 * @returns {string} An absolute URL.
 */
export const absoluteLocation = (
  fromUrl,
  location,
  localhostAlias = 'localhost'
) => {
  if (ABSOLUTE_URL.test(location)) {
    return location.replace(LOCALHOST_HOST, `$1${localhostAlias}`)
  }

  if (location.startsWith('/')) {
    return `${originOf(fromUrl)}${location}`
  }

  throw new Error(`Relative redirect Location is not supported: ${location}`)
}

/**
 * Tells whether a redirect is the journey's stale-concurrency redirect.
 *
 * The journey sends the user back with `staleAction=1` when a save is out of date.
 * The run counts that as a handled outcome.
 *
 * @param {string} location - The `Location` header value.
 * @returns {boolean} True when the redirect carries `staleAction=1`.
 */
export const isStaleActionRedirect = (location) => STALE_ACTION.test(location)

/**
 * Tells whether a URL is the identity provider's sign-in page or the OIDC callback.
 *
 * The `/oauth2/authresp` callback counts because a signed-in run passes through
 * it, so reaching it proves the sign-in went through the identity provider.
 *
 * @param {string} url - The URL to check.
 * @returns {boolean} True when the URL path ends with `/oauth2/authresp`.
 */
export const isIdentitySignInPage = (url) =>
  pathOf(url).endsWith('/oauth2/authresp')

/**
 * Names the endpoint a redirect hop belongs to.
 *
 * Every hop through the frontend's `/auth` routes and the identity provider
 * counts as `sign-in`. Any other hop keeps the endpoint of the request that
 * started the chain.
 *
 * @param {string} url - The hop's URL.
 * @param {string} endpoint - The endpoint of the request that started the chain.
 * @returns {string} An endpoint name.
 */
export const endpointForHop = (url, endpoint) => {
  const path = pathOf(url)
  const isSignIn =
    path.startsWith('/auth/') ||
    path.includes('/oauth2/') ||
    path.includes('/idphub/') ||
    path === '/organisations'

  return isSignIn ? 'sign-in' : endpoint
}

/**
 * Reads the notification id from the URL a create request redirects to.
 *
 * @param {string} url - The URL after the create redirect.
 * @param {string} createPath - The create route, for example `/live-animals/notifications`.
 * @returns {string} The id, or an empty string when the URL is not under the create route.
 */
export const journeyIdFrom = (url, createPath) => {
  const marker = `${createPath}/`
  const path = pathOf(url)
  const start = path.indexOf(marker)

  if (start === -1) {
    return ''
  }

  return path.slice(start + marker.length).split('/')[0]
}
