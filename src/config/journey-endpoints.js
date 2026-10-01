const page = (prefix, slug) => ({
  open: `${prefix}-${slug}`,
  save: `${prefix}-${slug}-save`
})

const picker = (prefix, slug) => ({
  ...page(prefix, slug),
  search: `${prefix}-${slug}-search`
})

const ANIMALS = 'animals'
const PLANTS = 'plants'

/**
 * The endpoint names every step of each journey tags its requests with.
 *
 * The k6 step modules read their names from here, never as string literals,
 * so a step cannot send a request the catalogue and the thresholds do not know.
 */
export const STEP_ENDPOINTS = Object.freeze({
  'live-animals': Object.freeze({
    origin: page(ANIMALS, 'origin'),
    commodities: picker(ANIMALS, 'commodities'),
    'consignment-details': page(ANIMALS, 'consignment-details'),
    identification: page(ANIMALS, 'identification'),
    'import-reason': page(ANIMALS, 'import-reason'),
    'additional-details': page(ANIMALS, 'additional-details'),
    addresses: {
      ...page(ANIMALS, 'addresses'),
      picker: picker(ANIMALS, 'party-picker')
    },
    'cph-number': page(ANIMALS, 'cph-number'),
    'port-of-entry': page(ANIMALS, 'port-of-entry'),
    'transit-countries': {
      ...page(ANIMALS, 'transit-countries'),
      add: `${ANIMALS}-transit-countries-add`
    },
    transporters: page(ANIMALS, 'transporters'),
    contact: page(ANIMALS, 'contact')
  }),
  'high-risk-plants': Object.freeze({
    'commodity-type': page(PLANTS, 'commodity-type'),
    'commodity-line': {
      open: `${PLANTS}-commodity-details`,
      categorySave: `${PLANTS}-commodity-category-save`,
      save: `${PLANTS}-commodity-line-save`
    },
    commodities: page(PLANTS, 'commodities'),
    origin: page(PLANTS, 'origin'),
    'arrival-status': page(PLANTS, 'arrival-status'),
    'arrival-details': page(PLANTS, 'arrival-details'),
    destination: picker(PLANTS, 'destination'),
    consignor: picker(PLANTS, 'consignor'),
    'identification-numbers': page(PLANTS, 'identification-numbers'),
    contact: picker(PLANTS, 'contact')
  })
})

/**
 * The endpoint names the pages every journey shares are tagged with.
 *
 * @param {string} prefix - The journey's endpoint prefix, `animals` or `plants`.
 * @returns {Record<string, string>} Endpoint names by role.
 */
export const sharedEndpoints = (prefix) => ({
  dashboard: `${prefix}-dashboard`,
  dashboardSearch: `${prefix}-dashboard-search`,
  create: `${prefix}-create`,
  hub: `${prefix}-hub`,
  notificationView: `${prefix}-notification-view`,
  declaration: `${prefix}-declaration`,
  declarationSave: `${prefix}-declaration-save`,
  amend: `${prefix}-amend`,
  cancelAmend: `${prefix}-cancel-amend`,
  cancelAmendSave: `${prefix}-cancel-amend-save`
})

const namesIn = (value) =>
  typeof value === 'string' ? [value] : Object.values(value).flatMap(namesIn)

/**
 * Lists every endpoint a journey scenario can send a request to.
 *
 * @param {string} journeyKey - A key of `STEP_ENDPOINTS`.
 * @param {string} prefix - The journey's endpoint prefix.
 * @returns {string[]} Endpoint names, without repeats.
 */
export const journeyEndpoints = (journeyKey, prefix) => [
  ...new Set([
    'sign-in',
    'ins-dashboard',
    ...namesIn(sharedEndpoints(prefix)),
    ...namesIn(STEP_ENDPOINTS[journeyKey]),
    `${prefix}-backend-fulfilments`,
    `${prefix}-backend-list`,
    `${prefix}-backend-replace`
  ])
]
