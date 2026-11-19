import { sleep } from 'k6'

import { READINESS } from '../config/smoke.js'
import { traderOrganisationHeaders } from '../config/trader-organisation.js'
import { ADDRESS_BOOK_PATH } from '../lib/address-book.js'
import { createBrowserSession } from './browser-session.js'
import { serviceHttp } from './service-http.js'

const HTTP_OK = 200
const MS_PER_SECOND = 1000

/** The tags that keep a readiness request out of every threshold. */
export const READINESS_TAGS = { phase: 'readiness', name: 'readiness' }

/** A stale-redirect counter that counts nothing, for requests outside the run. */
export const ignoreStaleRedirects = { add: () => {} }

const probeResult = (probe) => {
  try {
    return probe()
  } catch (error) {
    return { ok: false, detail: error.message }
  }
}

const traderNotificationsAnswer = (baseUrl, organisationId) => {
  const response = serviceHttp.get(`${baseUrl}/notifications?page=1`, {
    tags: READINESS_TAGS,
    headers: traderOrganisationHeaders(organisationId)
  })
  const status = response.status

  return { ok: status === HTTP_OK, detail: String(status) }
}

const referenceDataHasCountries = (url) => {
  const response = serviceHttp.get(`${url}/countries`, {
    tags: READINESS_TAGS
  })

  if (response.status !== HTTP_OK) {
    return { ok: false, detail: String(response.status) }
  }

  const countries = response.json()

  if (!Array.isArray(countries) || countries.length === 0) {
    return { ok: false, detail: 'empty countries list' }
  }

  return { ok: true }
}

const insPageAnswers = ({
  insUrl,
  localhostAlias,
  credentials,
  path,
  pageName,
  heading
}) => {
  const session = createBrowserSession({
    baseUrl: insUrl,
    localhostAlias,
    credentials,
    staleRedirects: ignoreStaleRedirects,
    extraTags: READINESS_TAGS
  })
  const page = session.open(path, pageName)
  const ok = page.status === HTTP_OK && page.heading === heading

  return { ok, detail: ok ? undefined : `status ${page.status}` }
}

const failedProbes = ({ urls, localhostAlias, credentials }) => {
  const probes = {
    'reference-data read': () => referenceDataHasCountries(urls.referenceData),
    'animals backend read': () =>
      traderNotificationsAnswer(
        urls.animalsBackend,
        credentials.organisationId
      ),
    'plants backend read': () =>
      traderNotificationsAnswer(urls.plantsBackend, credentials.organisationId),
    'INS backend read': () =>
      traderNotificationsAnswer(urls.insBackend, credentials.organisationId),
    'INS signed-in page': () =>
      insPageAnswers({
        insUrl: urls.ins,
        localhostAlias,
        credentials,
        path: '/',
        pageName: 'ins-dashboard',
        heading: 'Dashboard'
      }),
    'address book read': () =>
      insPageAnswers({
        insUrl: urls.ins,
        localhostAlias,
        credentials,
        path: ADDRESS_BOOK_PATH,
        pageName: 'ins-address-book',
        heading: 'Address book'
      })
  }

  return Object.entries(probes)
    .map(([name, probe]) => ({ name, ...probeResult(probe) }))
    .filter((result) => !result.ok)
    .map((result) =>
      result.detail ? `${result.name} (${result.detail})` : result.name
    )
}

/**
 * Waits until the stack is functionally ready. Throws when the timeout passes.
 *
 * @param {object} options - Readiness settings.
 * @param {Record<string, string>} options.urls - `ins`, `animalsBackend`, `plantsBackend`, `insBackend` and `referenceData` base URLs.
 * @param {string} options.localhostAlias - The host that stands in for `localhost` in redirects.
 * @param {{ crn: string, password: string, organisationId: string }} options.credentials - The stub identity to sign in with.
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
