import { sleep } from 'k6'
import http from 'k6/http'

import { READINESS } from '../config/smoke.js'
import { createBrowserSession } from './browser-session.js'

const HTTP_OK = 200
const MS_PER_SECOND = 1000

/** The tags that keep a readiness request out of every threshold. */
export const READINESS_TAGS = { phase: 'readiness', name: 'readiness' }

/** A stale-redirect counter that counts nothing, for requests outside the run. */
export const ignoreStaleRedirects = { add: () => {} }

const readBackend = (url) =>
  http.get(url, { tags: READINESS_TAGS }).status === HTTP_OK

const referenceDataHasCountries = (url) => {
  const response = http.get(`${url}/countries`, { tags: READINESS_TAGS })

  return (
    response.status === HTTP_OK &&
    Array.isArray(response.json()) &&
    response.json().length > 0
  )
}

const insSignsIn = ({ insUrl, localhostAlias, credentials }) => {
  const session = createBrowserSession({
    baseUrl: insUrl,
    localhostAlias,
    credentials,
    staleRedirects: ignoreStaleRedirects,
    extraTags: READINESS_TAGS
  })
  const page = session.open('/', 'ins-dashboard')

  return page.status === HTTP_OK && page.heading === 'Dashboard'
}

const insAddressBookAnswers = ({ insUrl, localhostAlias, credentials }) => {
  const session = createBrowserSession({
    baseUrl: insUrl,
    localhostAlias,
    credentials,
    staleRedirects: ignoreStaleRedirects,
    extraTags: READINESS_TAGS
  })
  const page = session.open('/address-book', 'ins-address-book')

  return page.status === HTTP_OK && page.heading === 'Address book'
}

const attempt = (probe) => {
  try {
    return probe()
  } catch {
    return false
  }
}

const failedProbes = ({ urls, localhostAlias, credentials }) => {
  const probes = {
    'reference-data read': () => referenceDataHasCountries(urls.referenceData),
    'animals backend read': () =>
      readBackend(`${urls.animalsBackend}/notifications?page=1`),
    'plants backend read': () =>
      readBackend(`${urls.plantsBackend}/notifications?page=1`),
    'INS backend read': () =>
      readBackend(`${urls.insBackend}/notifications?page=1`),
    'INS signed-in page': () =>
      insSignsIn({ insUrl: urls.ins, localhostAlias, credentials }),
    'address book read': () =>
      insAddressBookAnswers({ insUrl: urls.ins, localhostAlias, credentials })
  }

  return Object.entries(probes)
    .filter(([, probe]) => !attempt(probe))
    .map(([name]) => name)
}

/**
 * Waits until the stack is functionally ready, rather than trusting health endpoints.
 *
 * Ready means a signed-in page, a backend read for each journey, a
 * reference-data read, a read of the dashboard read model and a read of the
 * address book all succeed in one pass. Each service that owns a datastore
 * builds its indexes before it answers, so a pass also means the indexes are
 * built. Throws when the timeout passes.
 *
 * @param {object} options - Readiness settings.
 * @param {Record<string, string>} options.urls - `ins`, `animalsBackend`, `plantsBackend`, `insBackend` and `referenceData` base URLs.
 * @param {string} options.localhostAlias - The host that stands in for `localhost` in redirects.
 * @param {{ crn: string, password: string }} options.credentials - The stub identity to sign in with.
 */
export const waitForReadiness = ({ urls, localhostAlias, credentials }) => {
  const deadline = Date.now() + READINESS.timeoutSeconds * MS_PER_SECOND
  let failed = failedProbes({ urls, localhostAlias, credentials })

  while (failed.length > 0 && Date.now() < deadline) {
    sleep(READINESS.pollSeconds)
    failed = failedProbes({ urls, localhostAlias, credentials })
  }

  if (failed.length > 0) {
    throw new Error(
      `The stack was not functionally ready within ${READINESS.timeoutSeconds}s: ${failed.join(', ')}`
    )
  }
}
