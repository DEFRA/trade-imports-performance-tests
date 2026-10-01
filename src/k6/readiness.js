import { sleep } from 'k6'
import http from 'k6/http'

import { READINESS } from '../config/smoke.js'
import { createBrowserSession } from './browser-session.js'

const HTTP_OK = 200
const READINESS_TAGS = { phase: 'readiness', name: 'readiness' }
const MS_PER_SECOND = 1000

const ignoreStaleRedirects = { add: () => {} }

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
    'INS signed-in page': () =>
      insSignsIn({ insUrl: urls.ins, localhostAlias, credentials })
  }

  return Object.entries(probes)
    .filter(([, probe]) => !attempt(probe))
    .map(([name]) => name)
}

/**
 * Waits until the stack is functionally ready, rather than trusting health endpoints.
 *
 * Ready means a signed-in page, a backend read for each journey and a
 * reference-data read all succeed in one pass. Throws when the timeout passes.
 *
 * @param {object} options - Readiness settings.
 * @param {Record<string, string>} options.urls - `ins`, `animalsBackend`, `plantsBackend` and `referenceData` base URLs.
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
