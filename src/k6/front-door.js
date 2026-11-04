import { check } from 'k6'

import { TRAFFIC_CLASSES } from '../config/request-mix.js'
import { ADDRESS_BOOK_LOAD_NAME_PREFIX, PERF_ADDRESS } from '../config/smoke.js'
import { WORST_CASE_SEARCH_LENGTH } from '../config/test-data.js'
import {
  SIGN_IN_AND_DASHBOARD_PAGES,
  frontDoorThinkSecondsMean,
  isChosen
} from '../config/traffic.js'
import {
  ADDED_ADDRESS,
  ADDRESS_BOOK,
  ADDRESS_BOOK_SESSION_ENDPOINTS,
  ADDRESS_TYPE_START_PATH,
  addAddressAnswers,
  addressBookListPath,
  addressIdFrom,
  worstCaseSearchTerm
} from '../lib/address-book.js'
import { createBrowserSession } from './browser-session.js'
import { createWalker, recordSession } from './pages.js'
import { READINESS_TAGS, ignoreStaleRedirects } from './readiness.js'

const HTTP_OK = 200
const MS_PER_SECOND = 1000

const hrefsOf = (page) =>
  page.html
    ?.find(`a[href^="${ADDRESS_BOOK}/"]`)
    .toArray()
    .map((link) => link.attr('href')) ?? []

const textOf = (page) => page.html?.find('body').text() ?? ''

const addedAddressSearchPath = (searchTerm) =>
  addressBookListPath(ADDED_ADDRESS.addressType, { searchTerm })

const valuesOf = (page) =>
  Object.fromEntries(
    page.formInputs
      .filter(
        ({ name, type }) => name && type !== 'radio' && type !== 'checkbox'
      )
      .map(({ name, value }) => [name, value])
  )

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

  check(page, {
    'INS dashboard opens signed in': (dashboardPage) =>
      dashboardPage.status === HTTP_OK && dashboardPage.heading === 'Dashboard'
  })
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

  const extraDashboardReads =
    options.model.frontDoor.pagesPerDashboardOnlySession -
    SIGN_IN_AND_DASHBOARD_PAGES

  for (let view = 0; view < extraDashboardReads; view += 1) {
    walker.open('/', 'ins-dashboard')
  }

  recordSession(secondsSince(startedAt))
}

/**
 * Opens the add-address form through the INS address type page, choosing the
 * type the suite adds addresses as.
 *
 * Posts the address type page and returns the form it leads to.
 *
 * @param {{ open: Function, submit: Function }} walker - A walker, or the same two calls on a session.
 * @returns {object} The add-address form page.
 */
export const chooseTypeAndOpenAddForm = ({ open, submit }) => {
  const typePage = open(
    ADDRESS_TYPE_START_PATH,
    ADDRESS_BOOK_SESSION_ENDPOINTS.typePage
  )

  return submit(
    typePage,
    { addressType: ADDED_ADDRESS.addressType },
    ADDRESS_BOOK_SESSION_ENDPOINTS.typeSave
  )
}

/**
 * Posts the address type page on a browser session and returns the add-address
 * form, choosing the type the suite adds addresses as.
 *
 * @param {{ open: Function, submitForm: Function }} session - A browser session.
 * @returns {object} The add-address form page.
 */
export const chooseTypeAndOpenAddFormInSession = (session) =>
  chooseTypeAndOpenAddForm({ open: session.open, submit: session.submitForm })

const addAddress = (walker, name) => {
  const form = chooseTypeAndOpenAddForm(walker)

  return walker.submit(
    form,
    addAddressAnswers(PERF_ADDRESS, name),
    ADDRESS_BOOK_SESSION_ENDPOINTS.addSave
  )
}

const editAddress = (walker, addressId) => {
  const editedTown = 'Dundee'
  const form = walker.open(
    `${ADDRESS_BOOK}/${addressId}/edit`,
    ADDRESS_BOOK_SESSION_ENDPOINTS.edit
  )

  return walker.submit(
    form,
    { ...valuesOf(form), townOrCity: editedTown },
    ADDRESS_BOOK_SESSION_ENDPOINTS.editSave
  )
}

const deleteAddress = (walker, addressId) => {
  const confirmation = walker.open(
    `${ADDRESS_BOOK}/${addressId}/delete`,
    ADDRESS_BOOK_SESSION_ENDPOINTS.delete
  )

  return walker.submit(
    confirmation,
    {},
    ADDRESS_BOOK_SESSION_ENDPOINTS.deleteSave
  )
}

const searchWorstCaseWhenChosen = (walker, { iteration, model }) => {
  if (!isChosen(iteration, model.addressBook.worstCaseSearchShare)) {
    return
  }

  const searched = walker.open(
    addedAddressSearchPath(worstCaseSearchTerm(WORST_CASE_SEARCH_LENGTH)),
    ADDRESS_BOOK_SESSION_ENDPOINTS.worstCaseSearch
  )

  check(searched, {
    'worst-case address search answered': (page) => page.status === HTTP_OK
  })
}

/**
 * Runs an address-book session: add an address, find it by searching the
 * added address type's tab, view, edit and delete it. A worst-case search
 * searches the same tab.
 *
 * Leaves nothing behind in the book.
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
  walker.open(ADDRESS_BOOK, ADDRESS_BOOK_SESSION_ENDPOINTS.list)
  searchWorstCaseWhenChosen(walker, options)
  const saved = addAddress(walker, name)

  check(saved, {
    'address added': (page) =>
      page.status === HTTP_OK &&
      page.url.endsWith(addressBookListPath(ADDED_ADDRESS.addressType)) &&
      textOf(page).includes(name)
  })

  const found = walker.open(
    addedAddressSearchPath(name),
    ADDRESS_BOOK_SESSION_ENDPOINTS.search
  )
  const addressId = addressIdFrom(hrefsOf(found))

  check(found, { 'address found by name': () => addressId !== '' })

  if (addressId === '') {
    return
  }

  const viewed = walker.open(
    `${ADDRESS_BOOK}/${addressId}`,
    ADDRESS_BOOK_SESSION_ENDPOINTS.view
  )

  check(viewed, {
    'address viewed': (page) =>
      page.status === HTTP_OK && textOf(page).includes(name)
  })

  const edited = editAddress(walker, addressId)

  check(edited, {
    'address edited': (page) =>
      page.status === HTTP_OK && page.url.endsWith(ADDRESS_BOOK)
  })

  const deleted = deleteAddress(walker, addressId)

  check(deleted, {
    'address deleted': (page) =>
      page.status === HTTP_OK &&
      !hrefsOf(page).includes(`${ADDRESS_BOOK}/${addressId}`)
  })

  recordSession(secondsSince(startedAt))
}

/**
 * Makes sure the performance-test address exists in the address book.
 *
 * Signs in to INS, searches the added address type's tab for the performance-test
 * address by name and adds it through the frontend's add form when it is not
 * there. Its requests carry the readiness tags.
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
    session.open(
      addedAddressSearchPath(address.name),
      ADDRESS_BOOK_SESSION_ENDPOINTS.search
    )

  if (addressIdFrom(hrefsOf(search())) !== '') {
    return
  }

  const form = chooseTypeAndOpenAddFormInSession(session)

  session.submitForm(
    form,
    addAddressAnswers(address, address.name),
    ADDRESS_BOOK_SESSION_ENDPOINTS.addSave
  )

  if (addressIdFrom(hrefsOf(search())) === '') {
    throw new Error('Could not make the performance-test address')
  }
}
