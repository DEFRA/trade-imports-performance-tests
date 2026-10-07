import { JOURNEYS } from './smoke.js'
import { freezeDeep } from './traffic.js'

export const CALL_COUNTS_PATH = '/call-counts'

const callCountJourney = (journey, urlKey) => ({
  service: JOURNEYS[journey].frontend,
  urlKey
})

/**
 * The journeys whose frontends count their calls, each with the frontend that
 * counts them and the key of its base URL in the suites' `urls`.
 */
export const CALL_COUNT_JOURNEYS = freezeDeep({
  'live-animals': callCountJourney('live-animals', 'animalsFrontend'),
  'high-risk-plants': callCountJourney('high-risk-plants', 'plantsFrontend')
})

export const CALL_COUNT_MEASURES = Object.freeze([
  'page-requests',
  'backend-calls',
  'session-resolutions'
])

export const CALL_RATIOS = Object.freeze([
  'backend-calls-per-page',
  'session-resolutions-per-page'
])

/**
 * The call ratios the volumetrics page derives, as a count a page plus a count
 * a backend call. D2 and D3 are per page and per backend call: a frontend
 * resolves the session once a page and each backend call resolves it again.
 */
export const DERIVED_CALL_RATIOS = freezeDeep({
  d1: {
    perPage: 1,
    perBackendCall: 0,
    label: 'D1, T8',
    source: 'D1, T8: §9.4, §4.2'
  },
  d2: {
    perPage: 1,
    perBackendCall: 1,
    source: "D2: §9.4, the session design's no-caching rule"
  },
  d3: {
    perPage: 1,
    perBackendCall: 1,
    source: 'D3: §9.4'
  }
})

/**
 * What each frontend publishes to CloudWatch for every page request: the
 * dimension that separates the figure from the other metrics in its namespace,
 * and the two counts.
 */
export const PAGE_REQUEST_METRICS = freezeDeep({
  dimension: { Name: 'RequestKind', Value: 'page' },
  backendCalls: 'BackendCalls',
  sessionResolutions: 'SessionResolutions'
})

export const PAGE_REQUEST_SERVICES = freezeDeep(
  Object.entries(CALL_COUNT_JOURNEYS).map(([journey, { service }]) => ({
    journey,
    service
  }))
)
