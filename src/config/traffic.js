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
const GBN_AG_ANNUAL_NOTIFICATIONS = 42_000
const GBN_PP_ANNUAL_NOTIFICATIONS = 34_000
const INTERIM_ADDRESS_BOOK_ENTRIES = 500
const BACKGROUND_VIRTUAL_USERS = 10
const BACKGROUND_MAX_DURATION = '24h'

// Peak hour 114.3 notifications (volumetrics section 8.2) times A3's factor of 2, rounded up.
const IUU_NOTIFICATIONS_PER_HOUR = 229
const IUU2_SESSION_MINUTES = 30
const IUU3_SESSIONS_PER_NOTIFICATION = A2_SESSIONS_PER_NOTIFICATION
// DR-EUDP-005 'Scenario shapes' row 1: ramp over 3 hours, hold over the 7-hour 09:00 to 16:00 window.
const T1_RAMP_DURATION = '3h'
const T1_HOLD_DURATION = '7h'
// DR-EUDP-005 'Scenario shapes' row 2 and volumetrics section 4.2 T5: 30 minutes at peak, then 60 seconds at 1.5 times.
const BURST_PEAK_DURATION = '30m'
const BURST_DURATION = '60s'
const T5_BURST_FACTOR = 1.5
// Volumetrics section 4.4 A1 and A3: the seasonal peak-day factor and the design headroom the average weekday leaves out.
const A1_SEASONAL_PEAK_FACTOR = 2
const A3_DESIGN_HEADROOM = 2
const AVERAGE_LOAD_HOUR_DURATION = '1h'
// Volumetrics section 4.3 daily profile, each row read hour by hour and interpolated linearly: the 09:00 to 16:00 window sums to 54.4% against T2's "about 54%", and the busiest hour, 11:00, is T2's 8%.
const WEEKDAY_HOURLY_SHARES = [
  0.009, 0.009, 0.009, 0.009, 0.009, 0.009, 0.019, 0.036, 0.053, 0.077, 0.078,
  0.08, 0.078, 0.077, 0.077, 0.077, 0.072, 0.058, 0.041, 0.036, 0.031, 0.026,
  0.021, 0.016
]

// DR-EUDP-005 'Scenario shapes' row 3 and volumetrics section 4.2: five minutes at peak, then a ten-second spike.
const SPIKE_BASELINE_DURATION = '5m'
const SPIKE_DURATION = '10s'
// c-004 default: P95 back within 10% of the pre-spike baseline within 60 seconds.
const SPIKE_RECOVERY_DURATION = '60s'
// Interim: the window judged once the minute c-004 allows has passed.
const SPIKE_RECOVERED_DURATION = '2m'
// Volumetrics section 4.2 Spike capacities rows 1 and 2: proposals pending open item 2.
const FRONTEND_SPIKE_CAPACITY_RPS = 5
const IUU_SPIKE_CAPACITY_RPS = 15
// DR-EUDP-005 'Scenario shapes' row 4: eight hours at the design-target peak.
const ENDURANCE_HOLD_DURATION = '8h'
// c-004 default: the final hour's P95 against the first hour's.
const ENDURANCE_COMPARISON_WINDOW = '1h'
// The frontends' session.cache.ttl default (four hours), set at sign-in and not sliding.
const FRONTEND_SESSION_LIFETIME = '4h'
// Interim: how often a returning user visits its frontend, and how many there are for each.
const RETURNING_VISIT_INTERVAL = '10m'
const RETURNING_USERS_PER_FRONTEND = 1
const SESSION_EXPIRIES = ['frontend', 'client']

export const ADDRESS_BOOK_SESSION_PAGES = 12
const SECONDS_PER_MINUTE = 60
const SIGN_IN_PAGES_WITHOUT_WAIT = 1
export const SECONDS_PER_HOUR = 3600
const GRACEFUL_STOP_FACTOR = 2
const MAX_VUS_FACTOR = 2
const DURATION_FORMAT = /^\d+[smh]$/
// The burst stage list spends one second ramping to the burst rate, then holds it.
const MIN_BURST_SECONDS = 2
// Each hour after the first spends one second stepping to its rate, then holds it.
const MIN_HOUR_SECONDS = 2
const HALF_DENOMINATOR = 2

export const HOURS_PER_DAY = 24

/**
 * Freezes a value and everything inside it.
 *
 * @param {unknown} value - Any value; only objects and arrays are frozen.
 * @returns {unknown} The same value.
 */
export const freezeDeep = (value) => {
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
  iuu: {
    notificationsPerHour: IUU_NOTIFICATIONS_PER_HOUR,
    sessionsPerNotification: IUU3_SESSIONS_PER_NOTIFICATION,
    sessionMinutes: IUU2_SESSION_MINUTES
  },
  sustainedPeak: {
    rampDuration: T1_RAMP_DURATION,
    holdDuration: T1_HOLD_DURATION
  },
  p99Burst: {
    peakDuration: BURST_PEAK_DURATION,
    burstDuration: BURST_DURATION,
    burstFactor: T5_BURST_FACTOR
  },
  averageLoad: {
    hourDuration: AVERAGE_LOAD_HOUR_DURATION,
    hourlyShares: WEEKDAY_HOURLY_SHARES,
    seasonalPeakFactor: A1_SEASONAL_PEAK_FACTOR,
    designHeadroom: A3_DESIGN_HEADROOM
  },
  spikeRecovery: {
    baselineDuration: SPIKE_BASELINE_DURATION,
    spikeDuration: SPIKE_DURATION,
    recoveryDuration: SPIKE_RECOVERY_DURATION,
    recoveredDuration: SPIKE_RECOVERED_DURATION,
    capacityRps: {
      ins: FRONTEND_SPIKE_CAPACITY_RPS,
      animals: FRONTEND_SPIKE_CAPACITY_RPS,
      plants: FRONTEND_SPIKE_CAPACITY_RPS,
      iuu: IUU_SPIKE_CAPACITY_RPS
    }
  },
  endurance: {
    holdDuration: ENDURANCE_HOLD_DURATION,
    comparisonWindow: ENDURANCE_COMPARISON_WINDOW,
    sessionExpiry: 'frontend',
    sessionLifetime: FRONTEND_SESSION_LIFETIME,
    visitInterval: RETURNING_VISIT_INTERVAL,
    returningUsersPerFrontend: RETURNING_USERS_PER_FRONTEND
  },
  mix: { dashboardReadShareTarget: D7_DASHBOARD_READ_SHARE },
  backgroundVolume: {
    liveAnimalsNotifications: GBN_AG_ANNUAL_NOTIFICATIONS,
    highRiskPlantsNotifications: GBN_PP_ANNUAL_NOTIFICATIONS,
    addressBookEntries: INTERIM_ADDRESS_BOOK_ENTRIES,
    maxCreatedPerRun: GBN_AG_ANNUAL_NOTIFICATIONS,
    virtualUsers: BACKGROUND_VIRTUAL_USERS,
    maxDuration: BACKGROUND_MAX_DURATION
  },
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

const BACKGROUND_MINIMAL_PAGES = 1
const BACKGROUND_CORE_PAGES = 2
const BACKGROUND_SESSIONS_PER_NOTIFICATION = 1
const BACKGROUND_WORST_CASE_SEARCH_SHARE = 0

/**
 * What the background-volume suite lays over the defaults: each notification
 * is one page and one session with no documents, and no address-book search
 * or extra INS status check, because the run is set-up and measures nothing.
 */
export const BACKGROUND_VOLUME_PROFILE = freezeDeep({
  liveAnimals: {
    pagesPerNotification: BACKGROUND_MINIMAL_PAGES,
    sessionsPerNotification: BACKGROUND_SESSIONS_PER_NOTIFICATION,
    documentsPerNotification: [{ share: 1, min: 0, max: 0 }]
  },
  highRiskPlants: {
    pagesPerNotification: BACKGROUND_MINIMAL_PAGES,
    sessionsPerNotification: BACKGROUND_SESSIONS_PER_NOTIFICATION
  },
  addressBook: { worstCaseSearchShare: BACKGROUND_WORST_CASE_SEARCH_SHARE },
  frontDoor: { corePagesPerJourneySession: BACKGROUND_CORE_PAGES }
})

const WHOLE_NUMBER_KEYS = new Set([
  'notificationsPerHour',
  'liveAnimalsNotifications',
  'highRiskPlantsNotifications',
  'addressBookEntries',
  'maxCreatedPerRun',
  'virtualUsers',
  'returningUsersPerFrontend'
])
const DURATION_KEYS = new Set([
  'duration',
  'maxDuration',
  'rampDuration',
  'holdDuration',
  'peakDuration',
  'burstDuration',
  'hourDuration',
  'baselineDuration',
  'spikeDuration',
  'recoveryDuration',
  'recoveredDuration',
  'comparisonWindow',
  'sessionLifetime',
  'visitInterval'
])
const CHOICE_KEYS = { sessionExpiry: SESSION_EXPIRIES }
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
  if (key in CHOICE_KEYS) {
    return CHOICE_KEYS[key].includes(value)
      ? undefined
      : `one of ${CHOICE_KEYS[key].join(', ')}`
  }

  if (DURATION_KEYS.has(key)) {
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

const isShare = (value) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1

const hourlySharesFailure = (shares) =>
  Array.isArray(shares) &&
  shares.length === HOURS_PER_DAY &&
  shares.every(isShare) &&
  shares.some((share) => share > 0)
    ? undefined
    : `${HOURS_PER_DAY} shares from 0 to 1, at least one above 0`

const validate = (model, parent = '') => {
  for (const [key, value] of Object.entries(model)) {
    const path = joinPath(parent, key)

    if (key === 'hourlyShares') {
      failIfAny(path, hourlySharesFailure(value))
      continue
    }

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

const failIfBurstTooShort = (burstDuration) => {
  if (durationSeconds(burstDuration) < MIN_BURST_SECONDS) {
    throw new Error(
      `TRAFFIC_MODEL p99Burst.burstDuration must be at least ${MIN_BURST_SECONDS}s, got '${burstDuration}'`
    )
  }
}

const failIfHourTooShort = (hourDuration) => {
  if (durationSeconds(hourDuration) < MIN_HOUR_SECONDS) {
    throw new Error(
      `TRAFFIC_MODEL averageLoad.hourDuration must be at least ${MIN_HOUR_SECONDS}s, got '${hourDuration}'`
    )
  }
}

const failIfSpikeTooShort = (spikeDuration) => {
  if (durationSeconds(spikeDuration) < MIN_BURST_SECONDS) {
    throw new Error(
      `TRAFFIC_MODEL spikeRecovery.spikeDuration must be at least ${MIN_BURST_SECONDS}s, got '${spikeDuration}'`
    )
  }
}

const failIfWindowsOverlap = ({ holdDuration, comparisonWindow }) => {
  if (
    durationSeconds(comparisonWindow) * HALF_DENOMINATOR >
    durationSeconds(holdDuration)
  ) {
    throw new Error(
      `TRAFFIC_MODEL endurance.comparisonWindow must be at most half of endurance.holdDuration, got '${comparisonWindow}' and '${holdDuration}'`
    )
  }
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
  failIfBurstTooShort(model.p99Burst.burstDuration)
  failIfHourTooShort(model.averageLoad.hourDuration)
  failIfSpikeTooShort(model.spikeRecovery.spikeDuration)
  failIfWindowsOverlap({
    holdDuration: model.endurance.holdDuration,
    comparisonWindow: model.endurance.comparisonWindow
  })

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
 * The mean wait between two front-door pages of a synthetic IUU journey
 * session, which holds its sign-in and status checks across the IUU session
 * length. The sign-in has no wait.
 *
 * @param {{ iuu: { sessionMinutes: number }, frontDoor: { corePagesPerJourneySession: number } }} model - A resolved traffic model.
 * @returns {number} Seconds.
 */
export const iuuThinkSecondsMean = (model) =>
  (model.iuu.sessionMinutes * SECONDS_PER_MINUTE) /
  (model.frontDoor.corePagesPerJourneySession - SIGN_IN_PAGES_WITHOUT_WAIT)

const DURATION_UNIT_SECONDS = {
  s: 1,
  m: SECONDS_PER_MINUTE,
  h: SECONDS_PER_HOUR
}

/**
 * Converts a duration such as `90s`, `2m` or `3h` to seconds.
 *
 * @param {string} duration - A whole number followed by s, m or h.
 * @returns {number} Seconds.
 * @throws {Error} When the value is not such a duration.
 */
export const durationSeconds = (duration) => {
  if (typeof duration !== 'string' || !DURATION_FORMAT.test(duration)) {
    throw new Error(`"${duration}" is not a duration such as 2m`)
  }

  return (
    Number(duration.slice(0, -1)) * DURATION_UNIT_SECONDS[duration.slice(-1)]
  )
}

/**
 * Writes seconds as the largest whole unit that holds them exactly.
 *
 * @param {number} seconds - A length of time.
 * @returns {string} For example `2h`, `30m` or `90s`.
 */
export const durationText = (seconds) => {
  if (seconds % SECONDS_PER_HOUR === 0) {
    return `${seconds / SECONDS_PER_HOUR}h`
  }

  if (seconds % SECONDS_PER_MINUTE === 0) {
    return `${seconds / SECONDS_PER_MINUTE}m`
  }

  return `${seconds}s`
}

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

const rateFromIuu = (perNotification, { iuu }) =>
  Math.max(1, Math.round(perNotification * iuu.notificationsPerHour))

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
  ),
  'iuu-journey-sessions': rateFromIuu(model.iuu.sessionsPerNotification, model),
  'iuu-front-door': rateFromIuu(
    model.frontDoor.dashboardOnlySessionsPerNotification,
    model
  ),
  'iuu-address-book': rateFromIuu(
    model.frontDoor.addressBookSessionsPerNotification,
    model
  )
})

const journeyPagesPerHour = ({ rate, journeyModel, frontend, model }) => ({
  [frontend]: rate * journeyModel.pagesPerNotification,
  ins:
    rate *
    journeyModel.sessionsPerNotification *
    model.frontDoor.corePagesPerJourneySession
})

/**
 * The page requests an hour each scenario puts on each frontend at its steady
 * rate. The IUU scenarios' pages are counted as `iuu`, though they land on the
 * INS host, because they count against IUU's own capacity (c-007).
 *
 * @param {object} model - A resolved traffic model.
 * @returns {Record<string, Record<string, number>>} Pages an hour by scenario name, then by frontend.
 */
export const scenarioPagesPerHour = (model) => {
  const rates = scenarioRates(model)
  const { frontDoor } = model
  const iuuSessionPages = frontDoor.corePagesPerJourneySession

  return {
    'live-animals': journeyPagesPerHour({
      rate: rates['live-animals'],
      journeyModel: model.liveAnimals,
      frontend: 'animals',
      model
    }),
    'high-risk-plants': journeyPagesPerHour({
      rate: rates['high-risk-plants'],
      journeyModel: model.highRiskPlants,
      frontend: 'plants',
      model
    }),
    'ins-front-door': {
      ins: rates['ins-front-door'] * frontDoor.pagesPerDashboardOnlySession
    },
    'ins-address-book': {
      ins: rates['ins-address-book'] * ADDRESS_BOOK_SESSION_PAGES
    },
    'iuu-journey-sessions': {
      iuu: rates['iuu-journey-sessions'] * iuuSessionPages
    },
    'iuu-front-door': {
      iuu: rates['iuu-front-door'] * frontDoor.pagesPerDashboardOnlySession
    },
    'iuu-address-book': {
      iuu: rates['iuu-address-book'] * ADDRESS_BOOK_SESSION_PAGES
    }
  }
}

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
    ADDRESS_BOOK_SESSION_PAGES * frontDoorThinkSecondsMean(model.frontDoor),
  'iuu-journey-sessions': model.iuu.sessionMinutes * SECONDS_PER_MINUTE,
  'iuu-front-door':
    model.frontDoor.dashboardOnlySessionMinutes * SECONDS_PER_MINUTE,
  'iuu-address-book':
    ADDRESS_BOOK_SESSION_PAGES * frontDoorThinkSecondsMean(model.frontDoor)
})

/**
 * Sizes an open-model scenario's virtual users with Little's law.
 *
 * @param {number} ratePerHour - Iterations an hour.
 * @param {number} seconds - The longest one iteration can run.
 * @returns {{ preAllocatedVUs: number, maxVUs: number }} Users held ready, and twice as many as the ceiling.
 */
export const virtualUsersFor = (ratePerHour, seconds) => {
  const preAllocatedVUs = Math.max(
    1,
    Math.ceil((ratePerHour / SECONDS_PER_HOUR) * seconds)
  )

  return { preAllocatedVUs, maxVUs: MAX_VUS_FACTOR * preAllocatedVUs }
}

/**
 * How long k6 lets running iterations finish when a scenario ends.
 *
 * @param {number} seconds - The longest one iteration can run.
 * @returns {string} Twice that, as a k6 duration in seconds.
 */
export const gracefulStopFor = (seconds) =>
  `${Math.ceil(GRACEFUL_STOP_FACTOR * seconds)}s`

const arrivalScenario = ({ rate, seconds, duration, exec }) => ({
  executor: 'constant-arrival-rate',
  rate,
  timeUnit: '1h',
  duration,
  ...virtualUsersFor(rate, seconds),
  gracefulStop: gracefulStopFor(seconds),
  exec
})

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
