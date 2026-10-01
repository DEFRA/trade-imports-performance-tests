const AG1_PAGES_PER_NOTIFICATION = 40
const AG2_SESSION_MINUTES = 20
const PP1_PAGES_PER_NOTIFICATION = 50
const PP2_SESSION_MINUTES = 25
const A2_SESSIONS_PER_NOTIFICATION = 1.5
const C1_CORE_PAGES_PER_JOURNEY_SESSION = 6
const C2_DASHBOARD_ONLY_SESSIONS_PER_NOTIFICATION = 1
const C3_DASHBOARD_ONLY_SESSION_MINUTES = 5
const C4_PAGES_PER_DASHBOARD_ONLY_SESSION = 8
const D7_DASHBOARD_READ_SHARE = 0.25
const LIVE_ANIMALS_NOTIFICATIONS_PER_HOUR = 44
const HIGH_RISK_PLANTS_NOTIFICATIONS_PER_HOUR = 36
const INTERIM_ADDRESS_BOOK_SESSIONS_PER_NOTIFICATION = 0.25
const C012_AMENDED_SHARE = 0.2
const C012_CANCELLED_SHARE_OF_AMENDED = 0.05
const INTERIM_WORST_CASE_SEARCH_SHARE = 0.25
const DOCUMENT_CAP_KILOBYTES = 10_000
const DEFAULT_DURATION = '2m'

const ADDRESS_BOOK_SESSION_PAGES = 12
const SECONDS_PER_MINUTE = 60
const SIGN_IN_PAGES_WITHOUT_WAIT = 1
const SECONDS_PER_HOUR = 3600
const GRACEFUL_STOP_FACTOR = 2
const MAX_VUS_FACTOR = 2
const DURATION_FORMAT = /^\d+[smh]$/

const freezeDeep = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep)
    Object.freeze(value)
  }

  return value
}

export const TRAFFIC_DEFAULTS = freezeDeep({
  liveAnimals: {
    notificationsPerHour: LIVE_ANIMALS_NOTIFICATIONS_PER_HOUR,
    pagesPerNotification: AG1_PAGES_PER_NOTIFICATION,
    sessionsPerNotification: A2_SESSIONS_PER_NOTIFICATION,
    sessionMinutes: AG2_SESSION_MINUTES,
    amendShare: C012_AMENDED_SHARE,
    cancelAmendShare: C012_CANCELLED_SHARE_OF_AMENDED,
    documentsPerNotification: [
      { share: 0.3, min: 0, max: 0 },
      { share: 0.45, min: 1, max: 1 },
      { share: 0.2, min: 2, max: 2 },
      { share: 0.05, min: 3, max: 3 }
    ],
    documentKilobytes: { min: 100, max: 5000 },
    documentTypes: [
      { share: 0.5, value: 'pdf' },
      { share: 0.5, value: 'jpeg' }
    ]
  },
  highRiskPlants: {
    notificationsPerHour: HIGH_RISK_PLANTS_NOTIFICATIONS_PER_HOUR,
    pagesPerNotification: PP1_PAGES_PER_NOTIFICATION,
    sessionsPerNotification: A2_SESSIONS_PER_NOTIFICATION,
    sessionMinutes: PP2_SESSION_MINUTES,
    amendShare: C012_AMENDED_SHARE,
    cancelAmendShare: C012_CANCELLED_SHARE_OF_AMENDED,
    commodityLinesPerNotification: [
      { share: 0.5, min: 1, max: 3 },
      { share: 0.3, min: 4, max: 10 },
      { share: 0.15, min: 11, max: 25 },
      { share: 0.05, min: 26, max: 50 }
    ],
    commodityTypes: [
      { share: 0.34, value: 'plants-for-planting' },
      { share: 0.33, value: 'potatoes' },
      { share: 0.33, value: 'wood-and-cut-trees' }
    ]
  },
  addressBook: { worstCaseSearchShare: INTERIM_WORST_CASE_SEARCH_SHARE },
  frontDoor: {
    corePagesPerJourneySession: C1_CORE_PAGES_PER_JOURNEY_SESSION,
    dashboardOnlySessionsPerNotification:
      C2_DASHBOARD_ONLY_SESSIONS_PER_NOTIFICATION,
    dashboardOnlySessionMinutes: C3_DASHBOARD_ONLY_SESSION_MINUTES,
    pagesPerDashboardOnlySession: C4_PAGES_PER_DASHBOARD_ONLY_SESSION,
    addressBookSessionsPerNotification:
      INTERIM_ADDRESS_BOOK_SESSIONS_PER_NOTIFICATION
  },
  mix: { dashboardReadShareTarget: D7_DASHBOARD_READ_SHARE },
  duration: DEFAULT_DURATION
})

const SMOKE_NOTIFICATIONS_PER_HOUR = 20
const SMOKE_SESSION_MINUTES = 1
const SMOKE_DASHBOARD_ONLY_SESSION_MINUTES = 0.25

export const SMOKE_PROFILE = freezeDeep({
  duration: '2m',
  liveAnimals: {
    notificationsPerHour: SMOKE_NOTIFICATIONS_PER_HOUR,
    sessionMinutes: SMOKE_SESSION_MINUTES,
    amendShare: 1,
    cancelAmendShare: 1
  },
  highRiskPlants: {
    notificationsPerHour: SMOKE_NOTIFICATIONS_PER_HOUR,
    sessionMinutes: SMOKE_SESSION_MINUTES,
    amendShare: 1,
    cancelAmendShare: 0
  },
  addressBook: { worstCaseSearchShare: 1 },
  frontDoor: {
    dashboardOnlySessionMinutes: SMOKE_DASHBOARD_ONLY_SESSION_MINUTES
  }
})

const WHOLE_NUMBER_KEYS = new Set(['notificationsPerHour'])
const SHARE_KEYS = new Set([
  'amendShare',
  'cancelAmendShare',
  'dashboardReadShareTarget',
  'worstCaseSearchShare'
])
const COUNT_DISTRIBUTION_MINIMUMS = {
  documentsPerNotification: 0,
  commodityLinesPerNotification: 1
}
const VALUE_DISTRIBUTION_KEYS = {
  documentTypes: ['pdf', 'jpeg'],
  commodityTypes: ['plants-for-planting', 'potatoes', 'wood-and-cut-trees']
}
const SHARE_TOTAL_TOLERANCE = 1e-9

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const joinPath = (parent, key) => (parent ? `${parent}.${key}` : key)

const mergeKey = (base, override, key, parent) => {
  if (!(key in override)) {
    return base[key]
  }

  if (!isPlainObject(base[key])) {
    return override[key]
  }

  if (!isPlainObject(override[key])) {
    throw new Error(
      `Traffic model value "${joinPath(parent, key)}" must be an object`
    )
  }

  return deepMerge(base[key], override[key], joinPath(parent, key))
}

const deepMerge = (base, override, parent = '') => {
  const unknown = Object.keys(override).find((key) => !(key in base))

  if (unknown !== undefined) {
    throw new Error(`Unknown traffic model key "${joinPath(parent, unknown)}"`)
  }

  return Object.fromEntries(
    Object.keys(base).map((key) => [key, mergeKey(base, override, key, parent)])
  )
}

const failureFor = (key, value) => {
  if (key === 'duration') {
    return typeof value === 'string' && DURATION_FORMAT.test(value)
      ? undefined
      : 'a duration such as 2m'
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'a positive number'
  }

  if (SHARE_KEYS.has(key)) {
    return value >= 0 && value <= 1 ? undefined : 'between 0 and 1'
  }

  if (value <= 0) {
    return 'a positive number'
  }

  return WHOLE_NUMBER_KEYS.has(key) && !Number.isInteger(value)
    ? 'a whole number'
    : undefined
}

const failIfAny = (path, failure) => {
  if (failure) {
    throw new Error(`Traffic model value "${path}" must be ${failure}`)
  }
}

const isWholeNumber = (value) => Number.isInteger(value)

const sharesFailure = (buckets) => {
  const total = buckets.reduce((sum, { share }) => sum + share, 0)
  const sharesAreValid = buckets.every(
    ({ share }) => typeof share === 'number' && share >= 0 && share <= 1
  )

  return sharesAreValid && Math.abs(total - 1) <= SHARE_TOTAL_TOLERANCE
    ? undefined
    : 'buckets whose shares add up to 1'
}

const countBucketFailure =
  (minimum) =>
  ({ min, max }) =>
    isWholeNumber(min) && isWholeNumber(max) && min >= minimum && min <= max
      ? undefined
      : `buckets of whole numbers from min to max, with min at least ${minimum}`

const valueBucketFailure = (allowed) => (bucket) =>
  allowed.includes(bucket.value)
    ? undefined
    : `buckets of ${allowed.join(', ')}`

const bucketFailureFor = (key) => {
  if (key in COUNT_DISTRIBUTION_MINIMUMS) {
    return countBucketFailure(COUNT_DISTRIBUTION_MINIMUMS[key])
  }

  return valueBucketFailure(VALUE_DISTRIBUTION_KEYS[key])
}

const distributionFailure = (key, buckets) => {
  if (
    !Array.isArray(buckets) ||
    buckets.length === 0 ||
    !buckets.every(isPlainObject)
  ) {
    return 'a list of buckets'
  }

  return (
    sharesFailure(buckets) ?? buckets.map(bucketFailureFor(key)).find(Boolean)
  )
}

const isDistributionKey = (key) =>
  key in COUNT_DISTRIBUTION_MINIMUMS || key in VALUE_DISTRIBUTION_KEYS

const kilobyteRangeFailure = ({ min, max }) =>
  min <= max && max <= DOCUMENT_CAP_KILOBYTES
    ? undefined
    : `a range from min to max of at most ${DOCUMENT_CAP_KILOBYTES}`

const validate = (model, parent = '') => {
  for (const [key, value] of Object.entries(model)) {
    const path = joinPath(parent, key)

    if (isDistributionKey(key)) {
      failIfAny(path, distributionFailure(key, value))
      continue
    }

    if (isPlainObject(value)) {
      validate(value, path)

      if (key === 'documentKilobytes') {
        failIfAny(path, kilobyteRangeFailure(value))
      }

      continue
    }

    failIfAny(path, failureFor(key, value))
  }
}

const parseOverride = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('TRAFFIC_MODEL is not valid JSON')
  }
}

const overrideFrom = (env) => {
  const text = env.TRAFFIC_MODEL?.trim()

  if (!text) {
    return {}
  }

  const parsed = parseOverride(text)

  if (!isPlainObject(parsed)) {
    throw new Error('TRAFFIC_MODEL is not valid JSON')
  }

  return parsed
}

/**
 * Works out the traffic model a run applies.
 *
 * Layers the defaults, then the suite's profile, then a JSON object in the
 * `TRAFFIC_MODEL` environment variable, so a revised figure changes a value and
 * never a script. Throws, naming the key, for an unknown key or a value that is
 * not allowed.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @param {object} [profile] - Values a suite lays over the defaults.
 * @returns {object} The deep-frozen model.
 */
export const resolveTrafficModel = (env, profile = {}) => {
  const withProfile = deepMerge(TRAFFIC_DEFAULTS, profile)
  const model = deepMerge(withProfile, overrideFrom(env))

  validate(model)

  return freezeDeep(model)
}

const pagesPerSession = ({ pagesPerNotification, sessionsPerNotification }) =>
  pagesPerNotification / sessionsPerNotification

/**
 * The mean wait between any two pages of a journey session, including the INS
 * core pages (the dashboard and status checks) that share the session.
 *
 * @param {{ pagesPerNotification: number, sessionsPerNotification: number, sessionMinutes: number }} journeyModel - A journey's part of the model.
 * @param {{ corePagesPerJourneySession: number }} frontDoor - The front door's part of the model.
 * @returns {number} Seconds.
 */
export const thinkSecondsMean = (journeyModel, frontDoor) =>
  (journeyModel.sessionMinutes * SECONDS_PER_MINUTE) /
  (pagesPerSession(journeyModel) +
    frontDoor.corePagesPerJourneySession -
    SIGN_IN_PAGES_WITHOUT_WAIT)

/**
 * The mean wait between two pages of a dashboard-only session.
 *
 * @param {{ dashboardOnlySessionMinutes: number, pagesPerDashboardOnlySession: number }} frontDoor - The front door's part of the model.
 * @returns {number} Seconds.
 */
export const frontDoorThinkSecondsMean = (frontDoor) =>
  (frontDoor.dashboardOnlySessionMinutes * SECONDS_PER_MINUTE) /
  frontDoor.pagesPerDashboardOnlySession

/**
 * Spreads sessions over notifications so the average is exactly the figure.
 *
 * @param {number} iteration - The notification's number across the whole test, from 0.
 * @param {number} sessionsPerNotification - The average number of sessions.
 * @returns {number} Whole sessions for this notification.
 */
export const sessionsFor = (iteration, sessionsPerNotification) =>
  Math.ceil((iteration + 1) * sessionsPerNotification) -
  Math.ceil(iteration * sessionsPerNotification)

/**
 * Spreads a share over notifications, so each share of them is chosen.
 *
 * @param {number} iteration - The notification's number across the whole test, from 0.
 * @param {number} share - A share from 0 to 1.
 * @returns {boolean} True when this notification is one of the share.
 */
export const isChosen = (iteration, share) =>
  Math.floor((iteration + 1) * share) > Math.floor(iteration * share)

/**
 * Works out whether a notification is amended and whether that amendment is
 * cancelled, choosing the cancelled share from the amended notifications only.
 *
 * @param {number} iteration - The notification's number across the whole test, from 0.
 * @param {{ amendShare: number, cancelAmendShare: number }} journeyModel - A journey's part of the model.
 * @returns {{ amends: boolean, cancelsAmendment: boolean }} The amendment plan.
 */
export const amendmentPlan = (iteration, { amendShare, cancelAmendShare }) => {
  const amends = isChosen(iteration, amendShare)
  const amendmentIndex = Math.floor(iteration * amendShare)

  return {
    amends,
    cancelsAmendment: amends && isChosen(amendmentIndex, cancelAmendShare)
  }
}

const rateFromJourneys = (perNotification, { liveAnimals, highRiskPlants }) =>
  perNotification *
  (liveAnimals.notificationsPerHour + highRiskPlants.notificationsPerHour)

/**
 * The arrival rate of each scenario, in iterations an hour.
 *
 * @param {object} model - A resolved traffic model.
 * @returns {Record<string, number>} Whole iterations an hour by scenario name.
 */
export const scenarioRates = (model) => ({
  'live-animals': model.liveAnimals.notificationsPerHour,
  'high-risk-plants': model.highRiskPlants.notificationsPerHour,
  'ins-front-door': Math.max(
    1,
    Math.round(
      rateFromJourneys(
        model.frontDoor.dashboardOnlySessionsPerNotification,
        model
      )
    )
  ),
  'ins-address-book': Math.max(
    1,
    Math.round(
      rateFromJourneys(
        model.frontDoor.addressBookSessionsPerNotification,
        model
      )
    )
  )
})

/**
 * The longest one iteration of each scenario can run, in seconds.
 *
 * @param {object} model - A resolved traffic model.
 * @returns {Record<string, number>} Seconds by scenario name.
 */
export const iterationSeconds = (model) => ({
  'live-animals':
    Math.ceil(model.liveAnimals.sessionsPerNotification) *
    model.liveAnimals.sessionMinutes *
    SECONDS_PER_MINUTE,
  'high-risk-plants':
    Math.ceil(model.highRiskPlants.sessionsPerNotification) *
    model.highRiskPlants.sessionMinutes *
    SECONDS_PER_MINUTE,
  'ins-front-door':
    model.frontDoor.dashboardOnlySessionMinutes * SECONDS_PER_MINUTE,
  'ins-address-book':
    ADDRESS_BOOK_SESSION_PAGES * frontDoorThinkSecondsMean(model.frontDoor)
})

const arrivalScenario = ({ rate, seconds, duration, exec }) => {
  const preAllocatedVUs = Math.max(
    1,
    Math.ceil((rate / SECONDS_PER_HOUR) * seconds)
  )

  return {
    executor: 'constant-arrival-rate',
    rate,
    timeUnit: '1h',
    duration,
    preAllocatedVUs,
    maxVUs: MAX_VUS_FACTOR * preAllocatedVUs,
    gracefulStop: `${Math.ceil(GRACEFUL_STOP_FACTOR * seconds)}s`,
    exec
  }
}

/**
 * Builds the k6 `scenarios` option: one open-model scenario per entry.
 *
 * Each scenario starts iterations at a stated rate however long they take, so
 * a slowing service keeps receiving the load it would in production. The
 * virtual users come from Little's law, with headroom for a slow service.
 *
 * @param {object} model - A resolved traffic model.
 * @param {Record<string, { exec: string }>} scenarios - Scenarios shaped like `SCENARIOS`.
 * @returns {Record<string, object>} k6 scenarios.
 */
export const arrivalScenarios = (model, scenarios) => {
  const rates = scenarioRates(model)
  const seconds = iterationSeconds(model)

  return Object.fromEntries(
    Object.entries(scenarios).map(([name, { exec }]) => [
      name,
      arrivalScenario({
        rate: rates[name],
        seconds: seconds[name],
        duration: model.duration,
        exec
      })
    ])
  )
}
