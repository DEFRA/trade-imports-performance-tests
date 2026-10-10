import { check } from 'k6'

import { TRAFFIC_CLASSES } from '../config/request-mix.js'
import { ADDRESS_BOOK_LOAD_NAME_PREFIX, PERF_ADDRESS } from '../config/smoke.js'
import { WORST_CASE_SEARCH_LENGTH } from '../config/test-data.js'
import { frontDoorThinkSecondsMean, isChosen } from '../config/traffic.js'
import { addressIdFrom, worstCaseSearchTerm } from '../lib/address-book.js'
import { describeMissedPage } from '../lib/missed-page.js'
import { createBrowserSession } from './browser-session.js'
import { createWalker, recordSession } from './pages.js'
import { READINESS_TAGS, ignoreStaleRedirects } from './readiness.js'

const HTTP_OK = 200
const MS_PER_SECOND = 1000

const ADDRESS_BOOK = '/address-book'
const EDITED_TOWN = 'Dundee'

/** The page requests an INS session makes on opening: the sign-in plus the dashboard. */
export const SIGN_IN_AND_DASHBOARD_PAGES = 2

const hrefsOf = (page) =>
  page.html
    ?.find('a[href^="/address-book/"]')
    .toArray()
    .map((link) => link.attr('href')) ?? []

const textOf = (page) => page.html?.find('body').text() ?? ''

const searchPath = (name) => `${ADDRESS_BOOK}?q=${encodeURIComponent(name)}`

const valuesOf = (page) =>
  Object.fromEntries(
    page.formInputs
      .filter(
        ({ name, type }) => name && type !== 'radio' && type !== 'checkbox'
      )
      .map(({ name, value }) => [name, value])
  )

const isSignedInDashboard = (page) =>
  page.status === HTTP_OK && page.heading === 'Dashboard'

/**
 * Opens the INS dashboard, which signs the session in on the way.
 *
 * Records the sign-in as a page of its own, then the dashboard read, and checks
 * that the sign-in went through Defra ID.
 *
 * @param {object} walker - A walker on an INS session, recording dashboard reads.
 * @returns {object} The dashboard page.
 */
export const openInsDashboard = (walker) => {
  const page = walker.open('/', 'ins-dashboard')

  if (walker.session.signedInThroughIdentityProvider()) {
    walker.record(TRAFFIC_CLASSES.SIGN_IN)
  }

  const opened = check(page, {
    'INS dashboard opens signed in': isSignedInDashboard
  })
  if (!opened) {
    console.warn(describeMissedPage('INS dashboard', page))
  }
  check(walker.session, {
    'sign-in went through Defra ID': (session) =>
      session.signedInThroughIdentityProvider()
  })

  return page
}

const startInsSession = ({
  urls,
  credentials,
  localhostAlias,
  staleRedirects,
  model,
  trafficClass,
  thinkMean = frontDoorThinkSecondsMean(model.frontDoor)
}) =>
  createWalker({
    session: createBrowserSession({
      baseUrl: urls.ins,
      localhostAlias,
      credentials,
      staleRedirects
    }),
    thinkMean,
    trafficClass,
    frontend: 'ins'
  })

/**
 * The wall-clock seconds since a timestamp.
 *
 * @param {number} startedAt - A `Date.now()` timestamp.
 * @returns {number} Seconds.
 */
export const secondsSince = (startedAt) =>
  (Date.now() - startedAt) / MS_PER_SECOND

/**
 * Runs a dashboard-only session: sign in, then keep checking the dashboard.
 *
 * Makes `pagesPerDashboardOnlySession` page requests in all, counting the
 * sign-in as one, paced across the session's length.
 *
 * @param {object} options - Session settings.
 * @param {Record<string, string>} options.urls - Service base URLs, with `ins`.
 * @param {object} options.model - A resolved traffic model.
 * @param {{ crn: string, password: string }} options.credentials - The stub identity to sign in with.
 * @param {string} options.localhostAlias - The host that stands in for `localhost` in redirects.
 * @param {{ add: (value: number) => void }} options.staleRedirects - Counts handled stale-concurrency redirects.
 */
export const dashboardOnlySession = (options) => {
  const startedAt = Date.now()
  const walker = startInsSession({
    ...options,
    trafficClass: TRAFFIC_CLASSES.DASHBOARD_READ
  })

  openInsDashboard(walker)

  const further =
    options.model.frontDoor.pagesPerDashboardOnlySession -
    SIGN_IN_AND_DASHBOARD_PAGES

  for (let view = 0; view < further; view += 1) {
    walker.open('/', 'ins-dashboard')
  }

  recordSession(secondsSince(startedAt))
}

const addAnswers = (address, name) => ({ ...address, name })

const addAddress = (walker, name) => {
  const form = walker.open(`${ADDRESS_BOOK}/add`, 'ins-address-add')

  return walker.submit(
    form,
    addAnswers(PERF_ADDRESS, name),
    'ins-address-add-save'
  )
}

const editAddress = (walker, id) => {
  const form = walker.open(`${ADDRESS_BOOK}/${id}/edit`, 'ins-address-edit')

  return walker.submit(
    form,
    { ...valuesOf(form), townOrCity: EDITED_TOWN },
    'ins-address-edit-save'
  )
}

const deleteAddress = (walker, id) => {
  const confirmation = walker.open(
    `${ADDRESS_BOOK}/${id}/delete`,
    'ins-address-delete'
  )

  return walker.submit(confirmation, {}, 'ins-address-delete-save')
}

const searchWorstCaseWhenChosen = (walker, { iteration, model }) => {
  if (!isChosen(iteration, model.addressBook.worstCaseSearchShare)) {
    return
  }

  const searched = walker.open(
    searchPath(worstCaseSearchTerm(WORST_CASE_SEARCH_LENGTH)),
    'ins-address-book-search'
  )

  check(searched, {
    'worst-case address search answered': (page) => page.status === HTTP_OK
  })
}

/**
 * Runs an address-book session: add an address, find it, view, edit and delete it.
 *
 * Makes the nine address-book page requests after the sign-in and dashboard,
 * or ten when the session also runs a worst-case search, and leaves nothing
 * behind in the book.
 *
 * @param {object} options - Session settings.
 * @param {Record<string, string>} options.urls - Service base URLs, with `ins`.
 * @param {object} options.model - A resolved traffic model.
 * @param {{ crn: string, password: string }} options.credentials - The stub identity to sign in with.
 * @param {string} options.localhostAlias - The host that stands in for `localhost` in redirects.
 * @param {{ add: (value: number) => void }} options.staleRedirects - Counts handled stale-concurrency redirects.
 * @param {number} options.vu - The virtual user number.
 * @param {number} options.iteration - The iteration number.
 */
export const addressBookSession = (options) => {
  const startedAt = Date.now()
  const name = `${ADDRESS_BOOK_LOAD_NAME_PREFIX} ${options.vu}-${options.iteration}`
  const dashboard = startInsSession({
    ...options,
    trafficClass: TRAFFIC_CLASSES.DASHBOARD_READ
  })
  const walker = dashboard.withClass(TRAFFIC_CLASSES.ADDRESS_BOOK)

  openInsDashboard(dashboard)
  walker.open(ADDRESS_BOOK, 'ins-address-book')
  searchWorstCaseWhenChosen(walker, options)
  addAddress(walker, name)

  const found = walker.open(searchPath(name), 'ins-address-book-search')
  const id = addressIdFrom(hrefsOf(found))

  check(found, { 'address added': () => id !== '' })

  if (id === '') {
    return
  }

  const viewed = walker.open(`${ADDRESS_BOOK}/${id}`, 'ins-address-view')

  check(viewed, {
    'address viewed': (page) =>
      page.status === HTTP_OK && textOf(page).includes(name)
  })

  const edited = editAddress(walker, id)

  check(edited, {
    'address edited': (page) =>
      page.status === HTTP_OK && page.url.endsWith(ADDRESS_BOOK)
  })

  const deleted = deleteAddress(walker, id)

  check(deleted, {
    'address deleted': (page) =>
      page.status === HTTP_OK &&
      !hrefsOf(page).includes(`${ADDRESS_BOOK}/${id}`)
  })

  recordSession(secondsSince(startedAt))
}

/**
 * Makes sure the address every journey picks exists in the address book.
 *
 * Signs in to INS, searches for the performance-test address by name and adds
 * it through the frontend's add form when it is not there. Its requests carry
 * the readiness tags, so no threshold measures them.
 *
 * @param {object} options - Setup settings.
 * @param {string} options.insUrl - The INS frontend's base URL.
 * @param {string} options.localhostAlias - The host that stands in for `localhost` in redirects.
 * @param {{ crn: string, password: string }} options.credentials - The stub identity to sign in with.
 * @param {typeof PERF_ADDRESS} options.address - The address to look for and, when missing, add.
 * @throws {Error} When the address is still missing after it was added.
 */
export const ensurePerfAddress = ({
  insUrl,
  localhostAlias,
  credentials,
  address
}) => {
  const session = createBrowserSession({
    baseUrl: insUrl,
    localhostAlias,
    credentials,
    staleRedirects: ignoreStaleRedirects,
    extraTags: READINESS_TAGS
  })
  const search = () =>
    session.open(searchPath(address.name), 'ins-address-book-search')

  if (addressIdFrom(hrefsOf(search())) !== '') {
    return
  }

  const form = session.open(`${ADDRESS_BOOK}/add`, 'ins-address-add')

  session.submitForm(
    form,
    addAnswers(address, address.name),
    'ins-address-add-save'
  )

  if (addressIdFrom(hrefsOf(search())) === '') {
    throw new Error('Could not make the performance-test address')
  }
}
