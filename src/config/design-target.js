import { DRAIN_WATCH_SECONDS } from './eventing.js'
import { sharedEndpoints } from './journey-endpoints.js'
import { JOURNEYS, SCENARIOS } from './smoke.js'
import {
  SLA_PROFILE,
  ZERO_DELAY_PROFILE,
  resolveRequiredStubProfile
} from './stub-profiles.js'
import {
  HOURS_PER_DAY,
  SECONDS_PER_HOUR,
  TRAFFIC_DEFAULTS,
  durationSeconds,
  durationText,
  freezeDeep,
  gracefulStopFor,
  iterationSeconds,
  scenarioPagesPerHour,
  scenarioRates,
  virtualUsersFor
} from './traffic.js'

const ENVIRONMENT_LOCAL = 'local'

export const SHAPES = Object.freeze({
  SUSTAINED_PEAK: 'sustained-peak',
  P99_BURST: 'p99-burst',
  AVERAGE_LOAD: 'average-load',
  SPIKE_RECOVERY: 'spike-recovery',
  ENDURANCE: 'endurance'
})

// k6 rates are whole numbers: counted per day, a quiet hour's rate stays within a few per cent of its target, where per hour it would round to 1.
const AVERAGE_LOAD_TIME_UNIT = '24h'
const PERCENT = 100
const PERCENT_DECIMALS = 1
const FACTOR_DECIMALS = 2
// The endurance hold is the first window, the middle and the final window.
const COMPARISON_WINDOWS = 2

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
  BASELINE: 'baseline',
  SPIKE: 'spike',
  RECOVERY: 'recovery',
  RECOVERED: 'recovered',
  FIRST_HOUR: 'first-hour',
  MIDDLE: 'middle',
  FINAL_HOUR: 'final-hour',
  TAIL: 'tail'
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
 * and 2m at `local`. The spike run's baseline and recovered windows shorten to
 * 2m and 1m at `local`. The endurance run holds 12m at `local`, in 3m
 * windows, and its returning users clear their cookies after 3m, standing in
 * for the frontends' 4-hour session expiry that a compressed run cannot reach;
 * `nightly` leaves both as the DR's figures.
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
    frontDoor: { dashboardOnlySessionMinutes: 0.5 },
    spikeRecovery: { baselineDuration: '2m', recoveredDuration: '1m' },
    endurance: {
      holdDuration: '12m',
      comparisonWindow: '3m',
      sessionExpiry: 'client',
      sessionLifetime: '3m',
      visitInterval: '20s'
    }
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

const returningEntry = ({ exec, frontend, path }) =>
  Object.freeze({
    exec,
    frontend,
    path,
    endpoints: Object.freeze(['sign-in', sharedEndpoints(frontend).dashboard])
  })

/** The endurance run's returning users: one browser each for the whole run, so it outlives the frontends' session. */
export const RETURNING_SCENARIOS = Object.freeze({
  'returning-ins': returningEntry({
    exec: 'returningIns',
    frontend: 'ins',
    path: '/'
  }),
  'returning-animals': returningEntry({
    exec: 'returningAnimals',
    frontend: 'animals',
    path: JOURNEYS['live-animals'].setBase
  }),
  'returning-plants': returningEntry({
    exec: 'returningPlants',
    frontend: 'plants',
    path: JOURNEYS['high-risk-plants'].setBase
  })
})

/**
 * The scenarios a shape runs: the four smoke scenarios, plus the returning
 * users for the endurance run.
 *
 * @param {object} options - The run.
 * @param {string} options.shape - A value of `SHAPES`.
 * @returns {Record<string, { exec: string, endpoints: ReadonlyArray<string> }>} The scenarios.
 */
export const scenarioSetForShape = ({ shape }) => ({
  ...SCENARIOS,
  ...(shape === SHAPES.ENDURANCE ? RETURNING_SCENARIOS : {})
})

export const JOURNEY_OF = Object.freeze({
  'live-animals': 'live-animals',
  'high-risk-plants': 'high-risk-plants',
  'ins-front-door': 'ins-front-door',
  'ins-address-book': 'ins-front-door',
  'returning-ins': 'ins-front-door',
  'returning-animals': 'live-animals',
  'returning-plants': 'high-risk-plants'
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

/** The phases each shape reports. For every shape but average load the first is the steady one the rates are worked out over; the average-load run reports every hour. */
export const REPORTED_PHASES = Object.freeze({
  [SHAPES.SUSTAINED_PEAK]: Object.freeze([PHASES.HOLD]),
  [SHAPES.P99_BURST]: Object.freeze([PHASES.PEAK, PHASES.BURST]),
  [SHAPES.AVERAGE_LOAD]: HOUR_PHASES,
  [SHAPES.SPIKE_RECOVERY]: Object.freeze([
    PHASES.BASELINE,
    PHASES.SPIKE,
    PHASES.RECOVERY,
    PHASES.RECOVERED
  ]),
  [SHAPES.ENDURANCE]: Object.freeze([PHASES.FIRST_HOUR, PHASES.FINAL_HOUR])
})

const longestIterationSeconds = (model, scenarioNames) => {
  const seconds = iterationSeconds(model)

  return Math.max(
    ...scenarioNames
      .filter((name) => name in seconds)
      .map((name) => seconds[name])
  )
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

const withPhaseEntry = (entries, [phase, seconds], start) => {
  const startSeconds = entries.length === 0 ? start : entries.at(-1).endSeconds

  return [
    ...entries,
    { phase, startSeconds, endSeconds: startSeconds + seconds, paceFactor: 1 }
  ]
}

const timedPhases = (start, lengths) =>
  lengths.reduce(
    (entries, length) => withPhaseEntry(entries, length, start),
    []
  )

const withTail = (phases) => [
  ...phases,
  {
    phase: PHASES.TAIL,
    startSeconds: phases.at(-1).endSeconds,
    endSeconds: null,
    paceFactor: 1
  }
]

const spikeRecoverySchedule = (model, scenarioNames) => {
  const {
    baselineDuration,
    spikeDuration,
    recoveryDuration,
    recoveredDuration
  } = model.spikeRecovery
  const warmUp = longestIterationSeconds(model, scenarioNames)

  return withTail(
    timedPhases(0, [
      [PHASES.WARM_UP, warmUp],
      [PHASES.BASELINE, durationSeconds(baselineDuration)],
      [PHASES.SPIKE, durationSeconds(spikeDuration)],
      [PHASES.RECOVERY, durationSeconds(recoveryDuration)],
      [PHASES.RECOVERED, durationSeconds(recoveredDuration)]
    ])
  )
}

const enduranceSchedule = (model, scenarioNames) => {
  const { holdDuration, comparisonWindow } = model.endurance
  const warmUp = longestIterationSeconds(model, scenarioNames)
  const window = durationSeconds(comparisonWindow)
  const middle = durationSeconds(holdDuration) - COMPARISON_WINDOWS * window

  return withTail(
    timedPhases(0, [
      [PHASES.WARM_UP, warmUp],
      [PHASES.FIRST_HOUR, window],
      [PHASES.MIDDLE, middle],
      [PHASES.FINAL_HOUR, window]
    ])
  )
}

const SCHEDULES = {
  [SHAPES.SUSTAINED_PEAK]: sustainedPeakSchedule,
  [SHAPES.AVERAGE_LOAD]: averageLoadSchedule,
  [SHAPES.SPIKE_RECOVERY]: spikeRecoverySchedule,
  [SHAPES.ENDURANCE]: enduranceSchedule
}

const scheduleFor = ({ shape, model, scenarioNames }) =>
  (SCHEDULES[shape] ?? burstSchedule)(model, scenarioNames)

/**
 * Lays out the phases of a run on its clock, from the start of the scenarios.
 *
 * The burst, spike and endurance runs warm up for as long as their longest
 * iteration, so what is judged is at steady state. In the burst phase every
 * user moves `burstFactor` times faster through their think time; the spike
 * phase's pace is set per scenario by `scenarioSchedules`. The average-load run
 * has one phase for each of its 24 weekday hours, then the tail. The spike run
 * is warm-up, baseline, spike, recovery and recovered; the endurance run is
 * warm-up, first hour, middle and final hour.
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

  const users = virtualUsersFor(rate * Math.max(...factors), seconds)

  return {
    ...base,
    timeUnit: AVERAGE_LOAD_TIME_UNIT,
    ...users,
    preAllocatedVUs: users.maxVUs,
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

const JOURNEY_FRONTENDS = Object.freeze({
  'live-animals': 'animals',
  'high-risk-plants': 'plants'
})
const FRONT_DOOR_SCENARIOS = Object.freeze([
  'ins-front-door',
  'ins-address-book'
])

const sumOf = (values) => values.reduce((total, value) => total + value, 0)

const journeyFactor = ({ pages, capacityRps, scenario }) => {
  const frontend = JOURNEY_FRONTENDS[scenario]

  return (capacityRps[frontend] * SECONDS_PER_HOUR) / pages[scenario][frontend]
}

const frontDoorFactor = ({ pages, capacityRps, journeyFactors }) => {
  const journeyPages = sumOf(
    Object.keys(JOURNEY_FRONTENDS).map(
      (scenario) => pages[scenario].ins * journeyFactors[scenario]
    )
  )
  const frontDoorPages = sumOf(
    FRONT_DOOR_SCENARIOS.map((scenario) => pages[scenario].ins)
  )

  return Math.max(
    1,
    (capacityRps.ins * SECONDS_PER_HOUR - journeyPages) / frontDoorPages
  )
}

/**
 * Works out how much faster each scenario's users move during the spike so
 * each component takes its stated capacity.
 *
 * Journey sessions put pages on both their journey frontend and INS, so one
 * pace factor cannot hit 5 RPS on animals, plants and INS at once. Each
 * journey's factor takes its own frontend to capacity; the two front-door
 * scenarios share the factor that takes INS to capacity once the journeys' own
 * INS pages are counted, never below 1.
 *
 * @param {object} options - The run.
 * @param {object} options.model - A resolved traffic model.
 * @param {Record<string, unknown>} options.scenarioSet - The scenarios that run.
 * @returns {Record<string, number>} The pace factor for each scenario in the set that has one.
 */
export const spikeFactors = ({ model, scenarioSet }) => {
  const pages = scenarioPagesPerHour(model)
  const { capacityRps } = model.spikeRecovery
  const journeyFactors = Object.fromEntries(
    Object.keys(JOURNEY_FRONTENDS).map((scenario) => [
      scenario,
      journeyFactor({ pages, capacityRps, scenario })
    ])
  )
  const front = frontDoorFactor({ pages, capacityRps, journeyFactors })
  const all = {
    ...journeyFactors,
    ...Object.fromEntries(FRONT_DOOR_SCENARIOS.map((name) => [name, front]))
  }

  return Object.fromEntries(
    Object.keys(scenarioSet)
      .filter((name) => name in all)
      .map((name) => [name, all[name]])
  )
}

/**
 * Gives each scenario its own phase schedule.
 *
 * In the spike run each scenario's `spike` phase carries its own pace factor
 * from `spikeFactors`; in every other run all scenarios share the schedule.
 *
 * @param {object} options - The run.
 * @param {string} options.shape - A value of `SHAPES`.
 * @param {ReadonlyArray<object>} options.schedule - The run's phase schedule.
 * @param {object} options.model - A resolved traffic model.
 * @param {Record<string, unknown>} options.scenarioSet - The scenarios that run.
 * @returns {Record<string, ReadonlyArray<object>>} A schedule by scenario name.
 */
export const scenarioSchedules = ({ shape, schedule, model, scenarioSet }) => {
  const names = Object.keys(scenarioSet)

  if (shape !== SHAPES.SPIKE_RECOVERY) {
    return Object.fromEntries(names.map((name) => [name, schedule]))
  }

  const factors = spikeFactors({ model, scenarioSet })

  return Object.fromEntries(
    names.map((name) => [
      name,
      freezeDeep(
        schedule.map((entry) =>
          entry.phase === PHASES.SPIKE
            ? { ...entry, paceFactor: factors[name] }
            : { ...entry }
        )
      )
    ])
  )
}

const spikeScenario = ({ base, schedule, rate, factor, seconds }) => {
  const [, , spike, recovery, recovered] = schedule
  const spikeSeconds = spike.endSeconds - spike.startSeconds
  const spikeRate = Math.round(rate * factor)
  const afterSeconds = recovered.endSeconds - recovery.startSeconds - 1

  return {
    ...base,
    ...virtualUsersFor(spikeRate, seconds),
    startRate: rate,
    stages: [
      { duration: `${spike.startSeconds}s`, target: rate },
      { duration: '1s', target: spikeRate },
      { duration: `${spikeSeconds - 1}s`, target: spikeRate },
      { duration: '1s', target: rate },
      { duration: `${afterSeconds}s`, target: rate }
    ]
  }
}

const enduranceScenario = ({ base, schedule, rate }) => ({
  ...base,
  preAllocatedVUs: base.maxVUs,
  startRate: rate,
  stages: [{ duration: `${finalHourOf(schedule).endSeconds}s`, target: rate }]
})

const RETURNING_GRACEFUL_STOP = '30s'

const finalHourOf = (schedule) =>
  schedule.find(({ phase }) => phase === PHASES.FINAL_HOUR)

const returningScenario = ({ model, schedule, exec, name }) => ({
  executor: 'constant-vus',
  vus: model.endurance.returningUsersPerFrontend,
  duration: `${finalHourOf(schedule).endSeconds}s`,
  gracefulStop: RETURNING_GRACEFUL_STOP,
  exec,
  tags: { journey: JOURNEY_OF[name] }
})

const scenarioFor = ({
  shape,
  model,
  schedule,
  rate,
  seconds,
  exec,
  name,
  factor
}) => {
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

  if (shape === SHAPES.SPIKE_RECOVERY) {
    return spikeScenario({ base, schedule, rate, factor, seconds })
  }

  if (shape === SHAPES.ENDURANCE) {
    return enduranceScenario({ base, schedule, rate })
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
 * rate stays close to its target. The endurance run's returning users are
 * `constant-vus` scenarios instead: a fixed few users who each keep one browser
 * for the whole run.
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
  const factors =
    shape === SHAPES.SPIKE_RECOVERY ? spikeFactors({ model, scenarioSet }) : {}

  return Object.fromEntries(
    Object.entries(scenarioSet).map(([name, { exec }]) => [
      name,
      name in RETURNING_SCENARIOS
        ? returningScenario({ model, schedule, exec, name })
        : scenarioFor({
            shape,
            model,
            schedule,
            rate: rates[name],
            seconds: seconds[name],
            exec,
            name,
            factor: factors[name]
          })
    ])
  )
}

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
    signInsPerHour: 200,
    coreRps: 0.4,
    concurrentUsers: 51,
    burstRps: 0.6,
    source: 'NFR-VOL-CORE-01 to CORE-04'
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

const frontendExpiryText = ({ sessionExpiry, sessionLifetime }) =>
  sessionExpiry === 'client'
    ? `the browser forgets each session after ${sessionLifetime}`
    : `sessions expire at the frontends after ${sessionLifetime}`

/**
 * Words what ends a returning user's session in the endurance run.
 *
 * @param {{ sessionExpiry: string, sessionLifetime: string }} endurance - The model's endurance part.
 * @returns {string} The frontends' expiry, or the browser forgetting the session in its stead.
 */
export const sessionExpiryText = (endurance) =>
  `${frontendExpiryText(endurance)}${endurance.sessionExpiry === 'client' ? ", standing in for the frontends' expiry" : ''}`

const lengthText = ({ shape, model }) => {
  if (shape === SHAPES.SUSTAINED_PEAK) {
    return `ramp ${model.sustainedPeak.rampDuration}, hold ${model.sustainedPeak.holdDuration}`
  }

  if (shape === SHAPES.AVERAGE_LOAD) {
    const { hourDuration } = model.averageLoad

    return `${HOURS_PER_DAY} weekday hours of ${hourDuration} each, ${durationText(HOURS_PER_DAY * durationSeconds(hourDuration))} in all`
  }

  const warmUp = longestIterationSeconds(model, Object.keys(SCENARIOS))

  if (shape === SHAPES.SPIKE_RECOVERY) {
    const {
      baselineDuration,
      spikeDuration,
      recoveryDuration,
      recoveredDuration
    } = model.spikeRecovery

    return `warm-up ${durationText(warmUp)}, baseline ${baselineDuration}, spike ${spikeDuration}, recovery ${recoveryDuration}, recovered ${recoveredDuration}`
  }

  if (shape === SHAPES.ENDURANCE) {
    const { holdDuration, comparisonWindow } = model.endurance

    return `warm-up ${durationText(warmUp)}, hold ${holdDuration}, first and final hour ${comparisonWindow} each, ${frontendExpiryText(model.endurance)}`
  }

  return `warm-up ${durationText(warmUp)}, peak ${model.p99Burst.peakDuration}, burst ${model.p99Burst.burstDuration} at ${model.p99Burst.burstFactor}x`
}

/**
 * The log line that names a design-target run's settings.
 *
 * @param {object} options - The run.
 * @param {string} options.shape - A value of `SHAPES`.
 * @param {string} options.scenarioLength - A value of `SCENARIO_LENGTHS`.
 * @param {string} options.environment - The environment the run is in.
 * @param {string | undefined} options.stubProfile - The stub profile the run requires, if any.
 * @param {object} options.model - A resolved traffic model.
 * @returns {string} The line.
 */
export const runLine = ({
  shape,
  scenarioLength,
  environment,
  stubProfile,
  model
}) =>
  `Design-target run: ${shape}, ${scenarioLength} length (${lengthText({ shape, model })}), in ${environment}, requiring stub profile ${stubProfile ?? 'none'}`

/**
 * Tells whether a shape reads the gateway's dead-letter queue, the Service Bus
 * stand-in's sign of a cascade, before and after the run.
 *
 * @param {string} shape - A value of `SHAPES`.
 * @returns {boolean} True for the spike and endurance shapes.
 */
export const watchesDeadLetters = (shape) =>
  shape === SHAPES.SPIKE_RECOVERY || shape === SHAPES.ENDURANCE

const EVENTING_WATCH_PHASES = Object.freeze({
  [SHAPES.P99_BURST]: PHASES.BURST,
  [SHAPES.SPIKE_RECOVERY]: PHASES.SPIKE
})

/**
 * Tells whether a shape watches the eventing path, the gateway's forwarded count
 * and the SQS backlog, through its burst or spike.
 *
 * @param {string} shape - A value of `SHAPES`.
 * @returns {boolean} True for the burst and spike shapes.
 */
export const watchesEventing = (shape) => shape in EVENTING_WATCH_PHASES

/**
 * Finds the window the eventing watch judges: the burst or spike phase.
 *
 * @param {object} options - The run.
 * @param {string} options.shape - A value of `SHAPES`.
 * @param {ReadonlyArray<{ phase: string, startSeconds: number, endSeconds: number | null }>} options.schedule - The run's phase schedule.
 * @returns {{ phase: string, startSeconds: number, endSeconds: number }} The window on the run's clock. Throws for a shape that does not watch.
 */
export const eventingWindow = ({ shape, schedule }) => {
  const phase = EVENTING_WATCH_PHASES[shape]
  const { startSeconds, endSeconds } = schedule.find(
    (entry) => entry.phase === phase
  )

  return { phase, startSeconds, endSeconds }
}

/**
 * Finds how long the eventing watch runs: until the drain watch after the
 * schedule's tail begins has passed.
 *
 * @param {object} options - The run.
 * @param {ReadonlyArray<{ phase: string, startSeconds: number }>} options.schedule - The run's phase schedule.
 * @returns {number} The watch's end, in seconds from the start of the run.
 */
export const eventingWatchSeconds = ({ schedule }) => {
  const tail = schedule.find(({ phase }) => phase === PHASES.TAIL)

  return tail.startSeconds + DRAIN_WATCH_SECONDS
}

/**
 * Builds the scenario that reads the eventing path once a second: one virtual
 * user, so one owner of the watch state, and an overrun drops a sample instead
 * of splitting that state. It runs until the drain watch after the schedule's
 * tail begins has passed.
 *
 * @param {object} options - The run.
 * @param {ReadonlyArray<{ phase: string, startSeconds: number }>} options.schedule - The run's phase schedule.
 * @returns {object} A k6 scenario.
 */
export const eventingWatchScenario = ({ schedule }) => ({
  executor: 'constant-arrival-rate',
  rate: 1,
  timeUnit: '1s',
  duration: `${eventingWatchSeconds({ schedule })}s`,
  preAllocatedVUs: 1,
  maxVUs: 1,
  exec: 'eventingWatch',
  tags: { watch: 'eventing' }
})

/**
 * Works out the stated capacity of each component the spike hits, in RPS.
 *
 * The session path has no service of its own here, so its figure is derived the
 * way the backends are: every frontend's page capacity plus one backend call a
 * journey page.
 *
 * @param {object} options - The run.
 * @param {object} options.model - A resolved traffic model.
 * @returns {{ ins: number, animals: number, plants: number, sessionPath: number }} Capacities in RPS.
 */
export const spikeCapacities = ({ model }) => {
  const { ins, animals, plants } = model.spikeRecovery.capacityRps
  const frontends = ins + animals + plants
  const backends = (animals + plants) * DESIGN_TARGETS.backendCallsPerPage

  return { ins, animals, plants, sessionPath: frontends + backends }
}

/**
 * Counts how many times each returning user should sign in again.
 *
 * A user signs in on their first visit, then again on the first visit after
 * each session lifetime passes, and visits only once an interval.
 *
 * @param {object} options - The run.
 * @param {object} options.model - A resolved traffic model.
 * @param {number} options.runSeconds - How long the returning users run.
 * @returns {number} Whole re-authentications for each user.
 */
export const expectedReauthentications = ({ model, runSeconds }) => {
  const visit = durationSeconds(model.endurance.visitInterval)
  const lifetime = durationSeconds(model.endurance.sessionLifetime)

  return Math.max(0, Math.floor((runSeconds - visit) / (lifetime + visit)))
}

/**
 * The seconds the endurance run's returning users run: to the end of the final hour.
 *
 * @param {ReadonlyArray<{ phase: string, endSeconds: number | null }>} schedule - An endurance phase schedule.
 * @returns {number} Seconds.
 */
export const enduranceRunSeconds = (schedule) =>
  finalHourOf(schedule).endSeconds

const paceText = (factor) => `pace x${Number(factor.toFixed(FACTOR_DECIMALS))}`

/**
 * The log line that states what the spike applies.
 *
 * @param {object} options - The run.
 * @param {object} options.model - A resolved traffic model.
 * @param {Record<string, unknown>} options.scenarioSet - The scenarios that run.
 * @returns {string} The line.
 */
export const spikeProfileLine = ({ model, scenarioSet }) => {
  const factors = spikeFactors({ model, scenarioSet })
  const capacities = spikeCapacities({ model })
  const { spikeDuration, recoveryDuration, recoveredDuration } =
    model.spikeRecovery

  return `Spike: ${spikeDuration} at the stated capacities: animals ${capacities.animals} RPS (${paceText(factors['live-animals'])}), plants ${capacities.plants} RPS (${paceText(factors['high-risk-plants'])}), INS front door ${capacities.ins} RPS including sign-in (${paceText(factors['ins-front-door'])}), session path ${capacities.sessionPath} RPS (derived); recovery judged over the ${recoveredDuration} after the ${recoveryDuration} allowed`
}

const usersText = (count) =>
  count === 1 ? 'one returning user each' : `${count} returning users each`

/**
 * The log line that states what the endurance run applies to re-authentication.
 *
 * @param {object} options - The run.
 * @param {object} options.model - A resolved traffic model.
 * @param {number} options.runSeconds - How long the returning users run.
 * @returns {string} The line.
 */
export const enduranceProfileLine = ({ model, runSeconds }) =>
  `Endurance: ${usersText(model.endurance.returningUsersPerFrontend)} on ins, animals and plants keeps one browser for the whole run; ${sessionExpiryText(model.endurance)}, so each should sign in again about ${expectedReauthentications({ model, runSeconds })} times`
