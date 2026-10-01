export const ENDPOINT_KINDS = Object.freeze({ PAGE: 'page', API: 'api' })

const { PAGE, API } = ENDPOINT_KINDS

const ofKind = (kind, names) => names.map((name) => [name, kind])

const INS_PAGES = [
  'sign-in',
  'ins-dashboard',
  'ins-address-book',
  'ins-address-book-search',
  'ins-address-add',
  'ins-address-add-save',
  'ins-address-view',
  'ins-address-edit',
  'ins-address-edit-save',
  'ins-address-delete',
  'ins-address-delete-save'
]

const ANIMALS_PAGES = [
  'animals-dashboard',
  'animals-dashboard-search',
  'animals-create',
  'animals-hub',
  'animals-origin',
  'animals-origin-save',
  'animals-commodities',
  'animals-commodities-search',
  'animals-commodities-save',
  'animals-consignment-details',
  'animals-consignment-details-save',
  'animals-identification',
  'animals-identification-save',
  'animals-import-reason',
  'animals-import-reason-save',
  'animals-additional-details',
  'animals-additional-details-save',
  'animals-addresses',
  'animals-addresses-save',
  'animals-party-picker',
  'animals-party-picker-search',
  'animals-party-picker-save',
  'animals-cph-number',
  'animals-cph-number-save',
  'animals-port-of-entry',
  'animals-port-of-entry-save',
  'animals-transit-countries',
  'animals-transit-countries-add',
  'animals-transit-countries-save',
  'animals-transporters',
  'animals-transporters-save',
  'animals-contact',
  'animals-contact-save',
  'animals-notification-view',
  'animals-declaration',
  'animals-declaration-save',
  'animals-amend',
  'animals-cancel-amend',
  'animals-cancel-amend-save'
]

const PLANTS_PAGES = [
  'plants-dashboard',
  'plants-dashboard-search',
  'plants-create',
  'plants-hub',
  'plants-commodity-type',
  'plants-commodity-type-save',
  'plants-commodity-details',
  'plants-commodity-category-save',
  'plants-commodity-line-save',
  'plants-commodities',
  'plants-commodities-save',
  'plants-origin',
  'plants-origin-save',
  'plants-arrival-status',
  'plants-arrival-status-save',
  'plants-arrival-details',
  'plants-arrival-details-save',
  'plants-destination',
  'plants-destination-search',
  'plants-destination-save',
  'plants-consignor',
  'plants-consignor-search',
  'plants-consignor-save',
  'plants-identification-numbers',
  'plants-identification-numbers-save',
  'plants-contact',
  'plants-contact-search',
  'plants-contact-save',
  'plants-notification-view',
  'plants-declaration',
  'plants-declaration-save',
  'plants-amend',
  'plants-cancel-amend',
  'plants-cancel-amend-save'
]

const BACKEND_APIS = [
  'animals-backend-fulfilments',
  'animals-backend-list',
  'animals-backend-replace',
  'plants-backend-fulfilments',
  'plants-backend-list',
  'plants-backend-replace'
]

export const ENDPOINTS = Object.freeze(
  Object.fromEntries([
    ...ofKind(PAGE, INS_PAGES),
    ...ofKind(PAGE, ANIMALS_PAGES),
    ...ofKind(PAGE, PLANTS_PAGES),
    ...ofKind(API, BACKEND_APIS)
  ])
)

/**
 * Looks up whether an endpoint is a frontend page or a backend API call.
 *
 * Throws for a name outside the catalogue, so a typo cannot leave a request
 * without a threshold.
 *
 * @param {string} endpoint - An endpoint name from `ENDPOINTS`.
 * @returns {string} `page` or `api`.
 */
export const kindOf = (endpoint) => {
  const kind = ENDPOINTS[endpoint]

  if (!kind) {
    throw new Error(`Unknown endpoint "${endpoint}"`)
  }

  return kind
}
