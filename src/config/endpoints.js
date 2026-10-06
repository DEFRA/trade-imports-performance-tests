export const ENDPOINT_KINDS = Object.freeze({
  PAGE: 'page',
  API: 'api',
  UPLOAD: 'upload',
  STUB: 'stub'
})

const { PAGE, API, UPLOAD, STUB } = ENDPOINT_KINDS

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
  'animals-documents',
  'animals-documents-status',
  'animals-documents-save',
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

const ANIMALS_UPLOADS = ['animals-documents-upload']

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

export const REFERENCE_DATA_APIS = Object.freeze([
  'reference-data-countries-sps',
  'reference-data-countries',
  'reference-data-ports-of-entry',
  'reference-data-countries-uncached'
])

const STUB_CALLS = [
  'stub-trade-token',
  'stub-mdm-countries',
  'stub-mdm-ports',
  'stub-defra-id-well-known',
  'stub-defra-id-authorize',
  'stub-defra-id-sign-in-page',
  'stub-defra-id-sign-in',
  'stub-defra-id-organisations',
  'stub-defra-id-organisation-choice',
  'stub-defra-id-token',
  'stub-defra-id-keys',
  'stub-defra-id-sign-out'
]

export const ENDPOINTS = Object.freeze(
  Object.fromEntries([
    ...ofKind(STUB, STUB_CALLS),
    ...ofKind(PAGE, INS_PAGES),
    ...ofKind(PAGE, ANIMALS_PAGES),
    ...ofKind(UPLOAD, ANIMALS_UPLOADS),
    ...ofKind(PAGE, PLANTS_PAGES),
    ...ofKind(API, BACKEND_APIS),
    ...ofKind(API, REFERENCE_DATA_APIS)
  ])
)

// The INS dashboard reads the dashboard read model (ins-backend GET /notifications) once a view; the journeys' dashboards read their own backends.
export const READ_MODEL_ENDPOINTS = Object.freeze(['ins-dashboard'])

/**
 * Looks up the kind of an endpoint: one of the `ENDPOINT_KINDS` values.
 *
 * Throws for a name outside the catalogue, so a typo cannot leave a request
 * without a threshold.
 *
 * @param {string} endpoint - An endpoint name from `ENDPOINTS`.
 * @returns {string} The endpoint's `ENDPOINT_KINDS` value: `page`, `api`, `upload` or `stub`.
 */
export const kindOf = (endpoint) => {
  const kind = ENDPOINTS[endpoint]

  if (!kind) {
    throw new Error(`Unknown endpoint "${endpoint}"`)
  }

  return kind
}
