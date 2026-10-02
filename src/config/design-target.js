import { SCENARIOS } from './smoke.js'
import {
  SLA_PROFILE,
  ZERO_DELAY_PROFILE,
  resolveRequiredStubProfile
} from './stub-profiles.js'
import {
  HOURS_PER_DAY,
  TRAFFIC_DEFAULTS,
  durationSeconds,
  durationText,
  freezeDeep,
  gracefulStopFor,
  iterationSeconds,
  scenarioRates,
  virtualUsersFor
} from './traffic.js'

const ENVIRONMENT_LOCAL = 'local'

export const SHAPES = Object.freeze({
  SUSTAINED_PEAK: 'sustained-peak',
  P99_BURST: 'p99-burst',
  AVERAGE_LOAD: 'average-load'
})

// k6 rates are whole numbers: counted per day, a quiet hour's rate stays within a few per cent of its target, where per hour it would round to 1.
const AVERAGE_LOAD_TIME_UNIT = '24h'
const PERCENT = 100
const PERCENT_DECIMALS = 1

// Volumetrics section 4.3 daily profile, Phase column: the rows of a normal weekday.
const WEEKDAY_SEGMENTS = Object.freeze(
  [
    { name: 'overnight baseline', fromHour: 0, toHour: 6 },
    { name: 'ramp-up', fromHour: 6, toHour: 9 },
    { name: 'sustained window', fromHour: 9, toHour: 16 },
    { name: 'early ramp-down', fromHour: 16, toHour: 18 },
    { name: 'evening ramp-down', fromHour: 18, toHour: 24 }
  ].map(Object.freeze)
)

const twoDigitHour = (hour) => String(hour).padStart(2, '0')

/**
 * The phase name of one hour of the average weekday.
 *
 * @param {number} hour - The hour, 0 to 23.
 * @returns {string} For example `hour-09`.
 */
export const hourPhase = (hour) => `hour-${twoDigitHour(hour)}`

/**
 * The label of one hour of the average weekday.
 *
 * @param {number} hour - The hour, 0 to 23.
 * @returns {string} For example `09:00`.
 */
export const hourLabel = (hour) => `${twoDigitHour(hour)}:00`

export const HOUR_PHASES = Object.freeze(
  Array.from({ length: HOURS_PER_DAY }, (_, hour) => hourPhase(hour))
)

/**
 * The row of the weekday profile an hour belongs to.
 *
 * @param {number} hour - The hour, 0 to 23.
 * @returns {string} For example `sustained window`.
 */
export const segmentOf = (hour) =>
  WEEKDAY_SEGMENTS.find(
    ({ fromHour, toHour }) => fromHour <= hour && hour < toHour
  ).name

/**
 * Works out each hour's volume as a share of the sustained peak run's rate.
 *
 * An hour's factor is its share of the weekday over the busiest hour's share,
 * with the seasonal peak-day factor (A1) and the design headroom (A3) taken
 * out. The busiest hour is therefore 1 over A1 times A3, a quarter by default.
 *
 * @param {object} model - A resolved traffic model.
 * @returns {number[]} One factor per hour, hour 00 first.
 */
export const averageLoadFactors = (model) => {
  const { hourlyShares, seasonalPeakFactor, designHeadroom } = model.averageLoad
  const busiest = Math.max(...hourlyShares)

  return hourlyShares.map(
    (share) => share / busiest / (seasonalPeakFactor * designHeadroom)
  )
}

/**
 * Writes a share as a percentage to one decimal place.
 *
 * @param {number} share - The share, where 1 is all of it.
 * @returns {string} For example `25%` for 0.25.
 */
export const percentText = (share) =>
  `${Number((share * PERCENT).toFixed(PERCENT_DECIMALS))}%`

/**
 * The log line that states the volume an average-load run applies.
 *
 * @param {object} model - A resolved traffic model.
 * @returns {string} The line.
 */
export const averageLoadProfileLine = (model) => {
  const factors = averageLoadFactors(model)
  const mean = factors.reduce((sum, factor) => sum + factor, 0) / factors.length
  const { seasonalPeakFactor, designHeadroom } = model.averageLoad

  return `Average weekday: seasonal peak factor (A1) ${seasonalPeakFactor} and design headroom (A3) ${designHeadroom} taken out, so the busiest hour runs at ${percentText(Math.max(...factors))} of the sustained peak run's rate and the day averages ${percentText(mean)} of it`
}

export const PHASES = Object.freeze({
  WARM_UP: 'warm-up',
  RAMP: 'ramp',
  HOLD: 'hold',
  PEAK: 'peak',
  BURST: 'burst',
  TAIL: 'tail'
})

export const LOAD_PROFILES = Object.freeze({
  TWO_JOURNEYS: 'two-journeys',
  WITH_IUU: 'with-iuu'
})

export const SCENARIO_LENGTHS = Object.freeze({
  FULL: 'full',
  NIGHTLY: 'nightly',
  LOCAL: 'local'
})

/**
 * What each run length lays over the traffic model's defaults.
 *
 * `full` is the DR's own figures. `nightly` compresses the sustained peak to 2
 * hours, from c-003's default for CDP test. `local` is c-003's "compressed
 * durations for script development": minutes, with sessions shortened so the
 * run ends. The page and arrival rates stay at the design figures. The
 * average-load run's 24 weekday hours are 1h each at `full`, 10m at `nightly`
 * and 2m at `local`.
 */
export const SCENARIO_LENGTH_PROFILES = freezeDeep({
  full: {},
  nightly: {
    sustainedPeak: { rampDuration: '1h', holdDuration: '2h' },
    averageLoad: { hourDuration: '10m' }
  },
  local: {
    averageLoad: { hourDuration: '2m' },
    sustainedPeak: { rampDuration: '2m', holdDuration: '6m' },
    p99Burst: { peakDuration: '4m' },
    liveAnimals: { sessionMinutes: 2 },
    highRiskPlants: { sessionMinutes: 2 },
    iuu: { sessionMinutes: 2 },
    frontDoor: { dashboardOnlySessionMinutes: 0.5 }
  }
})

export const DEFAULT_LENGTH_BY_ENVIRONMENT = Object.freeze({
  local: SCENARIO_LENGTHS.LOCAL,
  test: SCENARIO_LENGTHS.NIGHTLY
})

/**
 * Reads the run length.
 *
 * Unset, it follows the environment: `local` gives `local`, `test` gives
 * `nightly`, anything else `full`.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @param {string} environment - The environment the run is in.
 * @returns {string} `full`, `nightly` or `local`.
 * @throws {Error} For an unknown value, or `local` outside the `local` environment.
 */
export const resolveScenarioLength = (env, environment) => {
  const value = env.SCENARIO_LENGTH?.trim()

  if (!value) {
    return DEFAULT_LENGTH_BY_ENVIRONMENT[environment] ?? SCENARIO_LENGTHS.FULL
  }

  if (!Object.values(SCENARIO_LENGTHS).includes(value)) {
    throw new Error('SCENARIO_LENGTH must be full, nightly or local, or unset.')
  }

  if (value === SCENARIO_LENGTHS.LOCAL && environment !== ENVIRONMENT_LOCAL) {
    throw new Error(
      'SCENARIO_LENGTH=local runs only when ENVIRONMENT is local: a CDP run measures at full or nightly length.'
    )
  }

  return value
}

/**
 * Reads which figures the run drives: the two journeys, or those plus IUU.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @returns {string} `two-journeys` or `with-iuu`.
 * @throws {Error} For any other value.
 */
export const resolveLoadProfile = (env) => {
  const value = env.LOAD_PROFILE?.trim()

  if (!value) {
    return LOAD_PROFILES.TWO_JOURNEYS
  }

  if (!Object.values(LOAD_PROFILES).includes(value)) {
    throw new Error('LOAD_PROFILE must be two-journeys or with-iuu, or unset.')
  }

  return value
}

/**
 * Tells whether a run is only a script check: a run in `local`.
 *
 * @param {string} environment - The environment the run is in.
 * @returns {boolean} True for `local`.
 */
export const isScriptCheck = (environment) => environment === ENVIRONMENT_LOCAL

/**
 * Works out the stub profile a design-target run requires.
 *
 * Outside `local` it is `sla` in code, and `STUB_PROFILE=zero-delay` is
 * refused. In `local` it is what `STUB_PROFILE` says.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @param {string} environment - The environment the run is in.
 * @returns {string | undefined} The profile to require.
 * @throws {Error} For `zero-delay` outside `local`.
 */
export const requiredStubProfileFor = (env, environment) => {
  const requested = resolveRequiredStubProfile(env)

  if (isScriptCheck(environment)) {
    return requested
  }

  if (requested === ZERO_DELAY_PROFILE) {
    throw new Error(
      'A design-target run outside local requires the sla stub profile; zero-delay is for script checks in local only'
    )
  }

  return SLA_PROFILE
}

// c-007's default: generated as INS front-door traffic, since no IUU journey exists here.
export const IUU_SCENARIOS = Object.freeze({
  'iuu-journey-sessions': Object.freeze({
    exec: 'iuuJourneySession',
    endpoints: Object.freeze(['sign-in', 'ins-dashboard'])
  }),
  'iuu-front-door': Object.freeze({
    exec: 'iuuFrontDoor',
    endpoints: Object.freeze(['sign-in', 'ins-dashboard'])
  }),
  'iuu-address-book': Object.freeze({
    exec: 'iuuAddressBook',
    endpoints: SCENARIOS['ins-address-book'].endpoints
  })
})

/**
 * The scenarios a load profile runs.
 *
 * @param {string} loadProfile - A value of `LOAD_PROFILES`.
 * @returns {Record<string, { exec: string, endpoints: string[] }>} The four smoke scenarios, plus the three IUU ones with IUU.
 */
export const scenarioSetFor = (loadProfile) =>
  loadProfile === LOAD_PROFILES.WITH_IUU
    ? { ...SCENARIOS, ...IUU_SCENARIOS }
    : { ...SCENARIOS }

export const JOURNEY_OF = Object.freeze({
  'live-animals': 'live-animals',
  'high-risk-plants': 'high-risk-plants',
  'ins-front-door': 'ins-front-door',
  'ins-address-book': 'ins-front-door',
  'iuu-journey-sessions': 'iuu-synthetic',
  'iuu-front-door': 'iuu-synthetic',
  'iuu-address-book': 'iuu-synthetic'
})

export const FRONTEND_OF_SCENARIO = Object.freeze({
  'live-animals': 'animals',
  'high-risk-plants': 'plants'
})

/** The journey scenarios, in the order reports list them. */
export const JOURNEY_SCENARIOS = Object.freeze(
  Object.keys(FRONTEND_OF_SCENARIO)
)

/**
 * The journey scenarios a scenario set runs.
 *
 * @param {Record<string, unknown>} scenarioSet - Scenarios shaped like `SCENARIOS`.
 * @returns {string[]} The journey scenarios in the set, in order.
 */
export const journeyScenariosIn = (scenarioSet) =>
  JOURNEY_SCENARIOS.filter((scenario) => scenario in scenarioSet)

/** The phases each shape reports. For the two peak shapes the first is the steady one the rates are worked out over; the average-load run reports every hour. */
export const REPORTED_PHASES = Object.freeze({
  [SHAPES.SUSTAINED_PEAK]: Object.freeze([PHASES.HOLD]),
  [SHAPES.P99_BURST]: Object.freeze([PHASES.PEAK, PHASES.BURST]),
  [SHAPES.AVERAGE_LOAD]: HOUR_PHASES
})

const longestIterationSeconds = (model, scenarioNames) => {
  const seconds = iterationSeconds(model)

  return Math.max(...scenarioNames.map((name) => seconds[name]))
}

const sustainedPeakSchedule = (model) => {
  const ramp = durationSeconds(model.sustainedPeak.rampDuration)
  const hold = durationSeconds(model.sustainedPeak.holdDuration)

  return [
    { phase: PHASES.RAMP, startSeconds: 0, endSeconds: ramp, paceFactor: 1 },
    {
      phase: PHASES.HOLD,
      startSeconds: ramp,
      endSeconds: ramp + hold,
      paceFactor: 1
    },
    {
      phase: PHASES.TAIL,
      startSeconds: ramp + hold,
      endSeconds: null,
      paceFactor: 1
    }
  ]
}

const burstSchedule = (model, scenarioNames) => {
  const warmUp = longestIterationSeconds(model, scenarioNames)
  const peakEnd = warmUp + durationSeconds(model.p99Burst.peakDuration)
  const burstEnd = peakEnd + durationSeconds(model.p99Burst.burstDuration)

  return [
    {
      phase: PHASES.WARM_UP,
      startSeconds: 0,
      endSeconds: warmUp,
      paceFactor: 1
    },
    {
      phase: PHASES.PEAK,
      startSeconds: warmUp,
      endSeconds: peakEnd,
      paceFactor: 1
    },
    {
      phase: PHASES.BURST,
      startSeconds: peakEnd,
      endSeconds: burstEnd,
      paceFactor: model.p99Burst.burstFactor
    },
    {
      phase: PHASES.TAIL,
      startSeconds: burstEnd,
      endSeconds: null,
      paceFactor: 1
    }
  ]
}

const averageLoadSchedule = (model) => {
  const hourSeconds = durationSeconds(model.averageLoad.hourDuration)

  return [
    ...HOUR_PHASES.map((phase, hour) => ({
      phase,
      startSeconds: hour * hourSeconds,
      endSeconds: (hour + 1) * hourSeconds,
      paceFactor: 1
    })),
    {
      phase: PHASES.TAIL,
      startSeconds: HOURS_PER_DAY * hourSeconds,
      endSeconds: null,
      paceFactor: 1
    }
  ]
}

const scheduleFor = ({ shape, model, scenarioNames }) => {
  if (shape === SHAPES.SUSTAINED_PEAK) {
    return sustainedPeakSchedule(model)
  }

  if (shape === SHAPES.AVERAGE_LOAD) {
    return averageLoadSchedule(model)
  }

  return burstSchedule(model, scenarioNames)
}

/**
 * Lays out the phases of a run on its clock, from the start of the scenarios.
 *
 * The burst run warms up for as long as its longest iteration, so the 30
 * minutes judged as peak are at steady state. In the burst phase every user
 * moves `burstFactor` times faster through their think time. The average-load
 * run has one phase for each of its 24 weekday hours, then the tail.
 *
 * @param {object} options - The run.
 * @param {string} options.shape - A value of `SHAPES`.
 * @param {object} options.model - A resolved traffic model.
 * @param {string[]} options.scenarioNames - The scenarios that run.
 * @returns {ReadonlyArray<{ phase: string, startSeconds: number, endSeconds: number | null, paceFactor: number }>} The ordered phases. The last has no end.
 */
export const phaseSchedule = ({ shape, model, scenarioNames }) =>
  freezeDeep(scheduleFor({ shape, model, scenarioNames }))

const averageLoadScenario = ({ base, model, rate, seconds }) => {
  const factors = averageLoadFactors(model)
  const hourSeconds = durationSeconds(model.averageLoad.hourDuration)
  const pace = (factor) => Math.round(rate * factor * HOURS_PER_DAY)
  const [firstFactor, ...laterFactors] = factors

  return {
    ...base,
    timeUnit: AVERAGE_LOAD_TIME_UNIT,
    ...virtualUsersFor(rate * Math.max(...factors), seconds),
    startRate: pace(firstFactor),
    stages: [
      { duration: `${hourSeconds}s`, target: pace(firstFactor) },
      ...laterFactors.flatMap((factor) => [
        { duration: '1s', target: pace(factor) },
        { duration: `${hourSeconds - 1}s`, target: pace(factor) }
      ])
    ]
  }
}

const scenarioFor = ({ shape, model, schedule, rate, seconds, exec, name }) => {
  const base = {
    executor: 'ramping-arrival-rate',
    timeUnit: '1h',
    ...virtualUsersFor(rate, seconds),
    gracefulStop: gracefulStopFor(seconds),
    exec,
    tags: { journey: JOURNEY_OF[name] }
  }

  if (shape === SHAPES.SUSTAINED_PEAK) {
    return {
      ...base,
      startRate: 0,
      stages: [
        { duration: model.sustainedPeak.rampDuration, target: rate },
        { duration: model.sustainedPeak.holdDuration, target: rate }
      ]
    }
  }

  if (shape === SHAPES.AVERAGE_LOAD) {
    return averageLoadScenario({ base, model, rate, seconds })
  }

  const [, peak, burst] = schedule
  const burstSeconds = burst.endSeconds - burst.startSeconds
  const burstRate = Math.ceil(rate * model.p99Burst.burstFactor)

  return {
    ...base,
    startRate: rate,
    stages: [
      { duration: `${peak.endSeconds}s`, target: rate },
      { duration: '1s', target: burstRate },
      { duration: `${burstSeconds - 1}s`, target: burstRate }
    ]
  }
}

/**
 * Builds the k6 `scenarios` option of a design-target run: one
 * `ramping-arrival-rate` scenario per traffic scenario, tagged by journey. The
 * average-load run counts its rates per day, so a quiet hour's whole-number
 * rate stays close to its target.
 *
 * @param {object} options - The run.
 * @param {string} options.shape - A value of `SHAPES`.
 * @param {object} options.model - A resolved traffic model.
 * @param {Record<string, { exec: string }>} options.scenarioSet - Scenarios shaped like `SCENARIOS`.
 * @param {ReadonlyArray<object>} options.schedule - The run's phase schedule.
 * @returns {Record<string, object>} k6 scenarios.
 */
export const designTargetScenarios = ({
  shape,
  model,
  scenarioSet,
  schedule
}) => {
  const rates = scenarioRates(model)
  const seconds = iterationSeconds(model)

  return Object.fromEntries(
    Object.entries(scenarioSet).map(([name, { exec }]) => [
      name,
      scenarioFor({
        shape,
        model,
        schedule,
        rate: rates[name],
        seconds: seconds[name],
        exec,
        name
      })
    ])
  )
}

const WITH_IUU_SOURCE = 'NFR-VOL-CORE-01 to CORE-04 with IUU'

/** The volumetrics figures each run states its achieved rates against. */
export const DESIGN_TARGETS = freezeDeep({
  'live-animals': {
    notificationsPerHour: TRAFFIC_DEFAULTS.liveAnimals.notificationsPerHour,
    frontendRps: 0.5,
    backendRps: 0.5,
    concurrentUsers: 22,
    burstRps: 0.7,
    source: 'NFR-VOL-AG-01 to AG-04'
  },
  'high-risk-plants': {
    notificationsPerHour: TRAFFIC_DEFAULTS.highRiskPlants.notificationsPerHour,
    frontendRps: 0.5,
    backendRps: 0.5,
    concurrentUsers: 22,
    burstRps: 0.7,
    source: 'NFR-VOL-PP-01 to PP-04'
  },
  frontDoor: {
    [LOAD_PROFILES.TWO_JOURNEYS]: {
      signInsPerHour: 200,
      coreRps: 0.4,
      concurrentUsers: 51,
      burstRps: 0.6,
      source: 'NFR-VOL-CORE-01 to CORE-04'
    },
    [LOAD_PROFILES.WITH_IUU]: {
      signInsPerHour: 770,
      coreRps: 1.5,
      concurrentUsers: 241,
      burstRps: 2.2,
      source: WITH_IUU_SOURCE
    }
  },
  dashboardReadShare: 0.25,
  backendCallsPerPage: 1
})

/**
 * The log line that says a local run is a script check, not a measurement.
 *
 * @param {object} options - The run.
 * @param {string | undefined} options.stubProfile - The stub profile the run requires, if any.
 * @returns {string} The line.
 */
export const localRunLine = ({ stubProfile }) =>
  `Local run: a script check, not a measurement at design conditions: stubs ${stubProfile ?? 'as-reported'}, background volume reported, not required, sessions compressed to the local length`

const lengthText = ({ shape, model, loadProfile }) => {
  if (shape === SHAPES.SUSTAINED_PEAK) {
    return `ramp ${model.sustainedPeak.rampDuration}, hold ${model.sustainedPeak.holdDuration}`
  }

  if (shape === SHAPES.AVERAGE_LOAD) {
    const { hourDuration } = model.averageLoad

    return `${HOURS_PER_DAY} weekday hours of ${hourDuration} each, ${durationText(HOURS_PER_DAY * durationSeconds(hourDuration))} in all`
  }

  const warmUp = longestIterationSeconds(
    model,
    Object.keys(scenarioSetFor(loadProfile))
  )

  return `warm-up ${durationText(warmUp)}, peak ${model.p99Burst.peakDuration}, burst ${model.p99Burst.burstDuration} at ${model.p99Burst.burstFactor}x`
}

/**
 * The log line that names a design-target run's settings.
 *
 * @param {object} options - The run.
 * @param {string} options.shape - A value of `SHAPES`.
 * @param {string} options.loadProfile - A value of `LOAD_PROFILES`.
 * @param {string} options.scenarioLength - A value of `SCENARIO_LENGTHS`.
 * @param {string} options.environment - The environment the run is in.
 * @param {string | undefined} options.stubProfile - The stub profile the run requires, if any.
 * @param {object} options.model - A resolved traffic model.
 * @returns {string} The line.
 */
export const runLine = ({
  shape,
  loadProfile,
  scenarioLength,
  environment,
  stubProfile,
  model
}) =>
  `Design-target run: ${shape}, ${loadProfile} profile, ${scenarioLength} length (${lengthText({ shape, model, loadProfile })}), in ${environment}, requiring stub profile ${stubProfile ?? 'none'}`
