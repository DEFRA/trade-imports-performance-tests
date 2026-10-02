import { journeyEndpoints } from './journey-endpoints.js'
import { arrivalScenarios } from './traffic.js'

const DEFAULT_STUB_PASSWORD = 'Password123'

export const IDENTITY = Object.freeze({ crn: '2100010101' })

export const MAX_REDIRECT_HOPS = 10

export const READINESS = Object.freeze({ timeoutSeconds: 300, pollSeconds: 5 })
export const SETUP_TIMEOUT = '360s'

export const PERF_ADDRESS = Object.freeze({
  name: 'Perf Test Holding',
  addressLine1: '4 Nursery Lane',
  addressLine2: '',
  townOrCity: 'Perth',
  county: '',
  postcode: 'PH1 5EX',
  countryCode: 'GB',
  phone: '01738 555 0143',
  email: 'perf@example.co.uk'
})

export const ADDRESS_BOOK_LOAD_NAME_PREFIX = 'Address Book Load'

/**
 * Reads the stub sign-in password.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @returns {string} `AUTH_PASSWORD` when set, otherwise the stub's default.
 */
export const resolvePassword = (env) =>
  env.AUTH_PASSWORD?.trim() || DEFAULT_STUB_PASSWORD

export const JOURNEYS = Object.freeze({
  'live-animals': Object.freeze({
    frontend: 'trade-imports-animals-frontend',
    backend: 'trade-imports-animals-backend',
    setBase: '/live-animals',
    firstSavePage: 'origin',
    endpointPrefix: 'animals',
    trafficKey: 'liveAnimals'
  }),
  'high-risk-plants': Object.freeze({
    frontend: 'trade-imports-plants-frontend',
    backend: 'trade-imports-plants-backend',
    setBase: '/high-risk-plants',
    firstSavePage: 'commodity-type',
    endpointPrefix: 'plants',
    trafficKey: 'highRiskPlants'
  })
})

const ADDRESS_BOOK_ENDPOINTS = [
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

const journeyScenario = (journeyKey, exec) => ({
  exec,
  endpoints: journeyEndpoints(journeyKey, JOURNEYS[journeyKey].endpointPrefix)
})

export const SCENARIOS = Object.freeze({
  'ins-front-door': Object.freeze({
    exec: 'insFrontDoor',
    endpoints: ['sign-in', 'ins-dashboard']
  }),
  'ins-address-book': Object.freeze({
    exec: 'insAddressBook',
    endpoints: ADDRESS_BOOK_ENDPOINTS
  }),
  'live-animals': Object.freeze(journeyScenario('live-animals', 'liveAnimals')),
  'high-risk-plants': Object.freeze(
    journeyScenario('high-risk-plants', 'highRiskPlants')
  )
})

/**
 * Builds the k6 `scenarios` option for the smoke run.
 *
 * @param {object} model - A resolved traffic model.
 * @returns {Record<string, object>} One constant-arrival-rate scenario per entry of `SCENARIOS`.
 */
export const smokeScenarios = (model) => arrivalScenarios(model, SCENARIOS)

/**
 * Lists every notification type the run splits its load by.
 *
 * Live animals has one type. High-risk plants has one per commodity type in
 * the traffic model.
 *
 * @param {object} model - A resolved traffic model.
 * @returns {Array<[string, string]>} Pairs of scenario name and notification type.
 */
export const notificationSplits = (model) => [
  ['live-animals', 'live-animals'],
  ...model.highRiskPlants.commodityTypes.map(({ value }) => [
    'high-risk-plants',
    value
  ])
]
