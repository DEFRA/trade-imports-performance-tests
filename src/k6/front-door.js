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
  ADDRESS_BOOK_PATH,
  ADDRESS_BOOK_SESSION_ENDPOINTS,
  ADDRESS_TYPE_START_PATH,
  DECLARED_ROLES_BY_ADDRESS_TYPE,
  SESSION_ADDRESS_TYPE,
  addAddressAnswers,
  addressBookListPath,
  addressIdFrom,
  worstCaseSearchTerm
} from '../lib/address-book.js'
import { checkboxValues } from '../lib/form-fill.js'
import { createBrowserSession } from './browser-session.js'
import { createWalker, recordSession } from './pages.js'
import { READINESS_TAGS, ignoreStaleRedirects } from './readiness.js'

const HTTP_OK = 200
const MS_PER_SECOND = 1000

const hrefsOf = (page) =>
  page.html
    ?.find(`a[href^="${ADDRESS_BOOK_PATH}/"]`)
    .toArray()
    .map((link) => link.attr('href')) ?? []

const textOf = (page) => page.html?.find('body').text() ?? ''

const sessionAddressTypeSearchPath = (searchTerm) =>
  addressBookListPath(SESSION_ADDRESS_TYPE, { searchTerm })

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
 * Adds an address through the INS address type page and add-address form.
 *
 * @param {{ open: Function, submit: Function }} requests - `open` and `submit` from a walker.
 * @param {Record<string, string>} address - The address's field answers.
 * @param {string} name - The name to save the address under.
 * @param {string} addressType - One of the {@link ADDRESS_TYPES} to add under; ticks the roles {@link DECLARED_ROLES_BY_ADDRESS_TYPE} pairs with it.
 * @returns {object} The page the add-address save lands on.
 * @throws {Error} Naming the address type, the roles the add form does not offer and the roles it does, when it does not offer every role {@link DECLARED_ROLES_BY_ADDRESS_TYPE} pairs with it.
 */
export const addAddressThrough = (
  { open, submit },
  address,
  name,
  addressType
) => {
  const typePage = open(
    ADDRESS_TYPE_START_PATH,
    ADDRESS_BOOK_SESSION_ENDPOINTS.typePage
  )
  const form = submit(
    typePage,
    { addressType },
    ADDRESS_BOOK_SESSION_ENDPOINTS.typeSave
  )

  const offeredRoles = checkboxValues(form.formInputs, 'roles')
  const notOffered = DECLARED_ROLES_BY_ADDRESS_TYPE[addressType].filter(
    (role) => !offeredRoles.includes(role)
  )
  if (notOffered.length > 0) {
    throw new Error(
      `The add form for "${addressType}" does not offer ${notOffered.join(', ')} — it offers ${offeredRoles.join(', ')}`
    )
  }

  return submit(
    form,
    addAddressAnswers(address, name, addressType),
    ADDRESS_BOOK_SESSION_ENDPOINTS.addSave
  )
}

/**
 * Adds an address on a browser session through the INS address type page and
 * add-address form.
 *
 * @param {{ open: Function, submitForm: Function }} session - A browser session.
 * @param {Record<string, string>} address - The address's field answers.
 * @param {string} name - The name to save the address under.
 * @param {string} addressType - One of the {@link ADDRESS_TYPES} to add under; ticks the roles {@link DECLARED_ROLES_BY_ADDRESS_TYPE} pairs with it.
 * @returns {object} The page the add-address save lands on.
 * @throws {Error} Naming the address type, the roles the add form does not offer and the roles it does, when it does not offer every role {@link DECLARED_ROLES_BY_ADDRESS_TYPE} pairs with it.
 */
export const addAddressInSession = (session, address, name, addressType) =>
  addAddressThrough(
    { open: session.open, submit: session.submitForm },
    address,
    name,
    addressType
  )

/**
 * Checks that an add-address save landed on the given address type's tab.
 *
 * @param {{ status: number, url: string }} page - The page the save landed on.
 * @param {string} addressType - The address type whose tab the save should have landed on.
 * @returns {boolean} True when the page answered 200 on that tab.
 */
export const landedOnAddressTypeTab = (page, addressType) =>
  page.status === HTTP_OK && page.url.endsWith(addressBookListPath(addressType))

const editAddress = (walker, addressId) => {
  const editedTown = 'Dundee'
  const form = walker.open(
    `${ADDRESS_BOOK_PATH}/${addressId}/edit`,
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
    `${ADDRESS_BOOK_PATH}/${addressId}/delete`,
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
    sessionAddressTypeSearchPath(worstCaseSearchTerm(WORST_CASE_SEARCH_LENGTH)),
    ADDRESS_BOOK_SESSION_ENDPOINTS.worstCaseSearch
  )

  check(searched, {
    'worst-case address search answered': (page) => page.status === HTTP_OK
  })
}

/**
 * Runs an address-book session: adds its address under the address type
 * sessions use, then finds, views, edits and deletes it from that type's
 * tab, which the worst-case search also searches.
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
  walker.open(ADDRESS_BOOK_PATH, ADDRESS_BOOK_SESSION_ENDPOINTS.list)
  searchWorstCaseWhenChosen(walker, options)
  const saved = addAddressThrough(
    walker,
    PERF_ADDRESS,
    name,
    SESSION_ADDRESS_TYPE
  )

  check(saved, {
    'address added': (page) =>
      landedOnAddressTypeTab(page, SESSION_ADDRESS_TYPE) &&
      textOf(page).includes(name)
  })

  const found = walker.open(
    sessionAddressTypeSearchPath(name),
    ADDRESS_BOOK_SESSION_ENDPOINTS.search
  )
  const addressId = addressIdFrom(hrefsOf(found))

  check(found, { 'address found by name': () => addressId !== '' })

  if (addressId === '') {
    return
  }

  const viewed = walker.open(
    `${ADDRESS_BOOK_PATH}/${addressId}`,
    ADDRESS_BOOK_SESSION_ENDPOINTS.view
  )

  check(viewed, {
    'address viewed': (page) =>
      page.status === HTTP_OK && textOf(page).includes(name)
  })

  const edited = editAddress(walker, addressId)

  check(edited, {
    'address edited': (page) =>
      page.status === HTTP_OK && page.url.endsWith(ADDRESS_BOOK_PATH)
  })

  const deleted = deleteAddress(walker, addressId)

  check(deleted, {
    'address deleted': (page) =>
      page.status === HTTP_OK &&
      !hrefsOf(page).includes(`${ADDRESS_BOOK_PATH}/${addressId}`)
  })

  recordSession(secondsSince(startedAt))
}

const roleFindsAddress = ({ open, addressType, role, name }) =>
  addressIdFrom(
    hrefsOf(
      open(
        addressBookListPath(addressType, { role, searchTerm: name }),
        ADDRESS_BOOK_SESSION_ENDPOINTS.search
      )
    )
  ) !== ''

const missingRolesOf = ({ open, addressType, name }) =>
  DECLARED_ROLES_BY_ADDRESS_TYPE[addressType].filter(
    (role) => !roleFindsAddress({ open, addressType, role, name })
  )

const missingRoleMessage = (addressType, roles) =>
  `${addressType}: ${roles.join(', ')}`

const addressTypeRefusalMessage = ({ addressType, status, heading }) =>
  `${addressType}: save answered ${status} "${heading}"`

/**
 * Makes an address findable under every role the suite declares.
 *
 * Searches each declared address type's tab, narrowed to each role
 * {@link DECLARED_ROLES_BY_ADDRESS_TYPE} pairs with it, and adds a record
 * under any type with a role not yet found, ticking that type's declared
 * roles.
 *
 * @param {{ open: Function, submit: Function }} requests - `open` and `submit` from a walker.
 * @param {Record<string, string>} address - The address's field answers.
 * @param {string} name - The name to search for and, where added, save the address under.
 * @throws {Error} Naming, for each address type still missing a role after the add, either the roles still missing or the status and heading of the page the save landed on, when it did not land on that type's tab.
 */
export const makeEveryDeclaredRoleFindable = (
  { open, submit },
  address,
  name
) => {
  const addressTypes = Object.keys(DECLARED_ROLES_BY_ADDRESS_TYPE)
  const typesNeedingAnAdd = addressTypes.filter(
    (addressType) => missingRolesOf({ open, addressType, name }).length > 0
  )

  const refusals = []
  for (const addressType of typesNeedingAnAdd) {
    const saved = addAddressThrough(
      { open, submit },
      address,
      name,
      addressType
    )
    if (!landedOnAddressTypeTab(saved, addressType)) {
      refusals.push({
        addressType,
        status: saved.status,
        heading: saved.heading
      })
    }
  }

  console.log(
    typesNeedingAnAdd.length > 0
      ? `Performance-test address added under: ${typesNeedingAnAdd.join(', ')}`
      : 'Performance-test address already found under every declared role'
  )

  const stillMissing = typesNeedingAnAdd
    .map((addressType) => ({
      addressType,
      roles: missingRolesOf({ open, addressType, name })
    }))
    .filter(({ roles }) => roles.length > 0)

  if (stillMissing.length > 0 || refusals.length > 0) {
    const messages = [
      ...stillMissing.map(({ addressType, roles }) =>
        missingRoleMessage(addressType, roles)
      ),
      ...refusals.map(addressTypeRefusalMessage)
    ]
    throw new Error(
      `Could not make the performance-test address found by every declared role: ${messages.join('; ')}`
    )
  }
}

/**
 * Makes sure the performance-test address exists in the address book, under
 * every role the suite declares. Its requests carry the readiness tags.
 *
 * @param {object} options - Setup settings.
 * @param {string} options.insUrl - The INS frontend's base URL.
 * @param {string} options.localhostAlias - The host that stands in for `localhost` in redirects.
 * @param {{ crn: string, password: string }} options.credentials - The stub identity to sign in with.
 * @param {typeof PERF_ADDRESS} options.address - The address to make findable.
 * @throws {Error} Naming, for each address type still missing a role after the add, either the roles still missing or the status and heading of the page the save landed on, when it did not land on that type's tab.
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

  makeEveryDeclaredRoleFindable(
    { open: session.open, submit: session.submitForm },
    address,
    address.name
  )
}
