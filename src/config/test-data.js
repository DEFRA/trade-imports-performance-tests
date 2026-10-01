// The longest searchable address field: ins-frontend features/address-book/fields.js FIELD_RULES.name.maxLength.
export const WORST_CASE_SEARCH_LENGTH = 255

// Cow is the one commodity whose pages match the live-animals step list exactly.
export const ANIMAL_COMMODITY_SEARCH = 'Cow'

// The narrowest origin constraint any category of the type can impose: plants-frontend services/commodities ORIGIN_CONSTRAINTS.
const EU_MEMBER_STATES = Object.freeze([
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK'
])

export const PLANT_ORIGINS_BY_COMMODITY_TYPE = Object.freeze({
  'plants-for-planting': EU_MEMBER_STATES,
  potatoes: Object.freeze(['PL', 'PT', 'RO', 'ES']),
  'wood-and-cut-trees': Object.freeze(['IT', 'FR', 'PT', 'ES'])
})

// Arrival time for potatoes: must match plants-frontend's ^([01]\d|2[0-3]):[0-5]\d$.
export const POTATO_ARRIVAL_TIME = '14:30'

// Date of issue given to every uploaded document.
export const DOCUMENT_ISSUED_DAYS_AGO = 30

// The animals frontend's scan-poll.js POLL_INTERVAL_MS, and how long a scan may stay pending before the run records it as stuck.
export const DOCUMENT_SCAN = Object.freeze({
  pollSeconds: 3,
  timeoutSeconds: 120
})

/**
 * Names the allowance the document scan is judged against.
 *
 * @returns {string} A line for the run's setup log.
 */
export const documentScanAllowanceLine = () =>
  'Document scan allowance: P99 under 60s, as for upload pages (DR-EUDP-005 section 4.7, SYN-28, SYN-29)'

/**
 * Names the stand-ins a local run's results depend on.
 *
 * @param {string} environment - The run's environment.
 * @returns {string | undefined} A line for the run's setup log, or undefined when the environment has none.
 */
export const standInCaveat = (environment) =>
  environment === 'local'
    ? "Stand-ins: SNS and SQS are floci, and document storage and virus scanning are the stack's cdp-uploader container with a mock scan, so results that depend on them are not CDP's"
    : undefined
