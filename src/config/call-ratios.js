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
 * Each derived call ratio as a count a page plus a count a backend call, with
 * the volumetrics source it comes from and, for D1, the label its line shows.
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

export const PAGE_REQUEST_SERVICES = freezeDeep(
  Object.entries(CALL_COUNT_JOURNEYS).map(([journey, { service }]) => ({
    journey,
    service
  }))
)
