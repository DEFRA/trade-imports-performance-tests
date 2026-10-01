export const STUB_PROFILE = 'zero-delay'

const DEFAULT_STUB_PASSWORD = 'Password123'

export const IDENTITY = Object.freeze({ crn: '2100010101' })

export const THINK_TIME_MIN_S = 1
export const THINK_TIME_MAX_S = 3
export const MAX_REDIRECT_HOPS = 10

export const READINESS = Object.freeze({ timeoutSeconds: 300, pollSeconds: 5 })
export const SETUP_TIMEOUT = '360s'

const SCENARIO_DURATION = '2m'
const GRACEFUL_STOP = '30s'

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
    savePage: 'origin',
    endpointPrefix: 'animals',
    savePageEndpoint: 'animals-origin'
  }),
  'high-risk-plants': Object.freeze({
    frontend: 'trade-imports-plants-frontend',
    backend: 'trade-imports-plants-backend',
    setBase: '/high-risk-plants',
    savePage: 'commodity-type',
    endpointPrefix: 'plants',
    savePageEndpoint: 'plants-commodity-type'
  })
})

const journeyEndpoints = ({ endpointPrefix, savePageEndpoint }) => [
  'sign-in',
  `${endpointPrefix}-dashboard`,
  `${endpointPrefix}-create`,
  savePageEndpoint,
  `${savePageEndpoint}-save`,
  `${endpointPrefix}-backend-fulfilments`,
  `${endpointPrefix}-backend-list`,
  `${endpointPrefix}-backend-replace`
]

export const SCENARIOS = Object.freeze({
  'ins-front-door': Object.freeze({
    vus: 1,
    exec: 'insFrontDoor',
    endpoints: ['sign-in', 'ins-dashboard']
  }),
  'live-animals': Object.freeze({
    vus: 2,
    exec: 'liveAnimals',
    endpoints: journeyEndpoints(JOURNEYS['live-animals'])
  }),
  'high-risk-plants': Object.freeze({
    vus: 2,
    exec: 'highRiskPlants',
    endpoints: journeyEndpoints(JOURNEYS['high-risk-plants'])
  })
})

/**
 * Builds the k6 `scenarios` option for the smoke run.
 *
 * @returns {Record<string, object>} One constant-VU scenario per entry of `SCENARIOS`.
 */
export const smokeScenarios = () =>
  Object.fromEntries(
    Object.entries(SCENARIOS).map(([name, { vus, exec }]) => [
      name,
      {
        executor: 'constant-vus',
        vus,
        duration: SCENARIO_DURATION,
        gracefulStop: GRACEFUL_STOP,
        exec
      }
    ])
  )
