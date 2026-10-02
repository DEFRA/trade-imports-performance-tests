// A stub carries at most half its ceiling: the factor the volumetrics page
// applies to its design targets (confluence:6608160092).
export const HEADROOM_FACTOR = 2

// The interim API p95 target, c-004 default, DR-EUDP-005 section 4.7.
export const LATENCY_ALLOWANCE_MS = 200

export const HEADROOM_MEASURES = Object.freeze([
  'peak-per-second',
  'mean-per-second'
])

// One sign-in reaches the Defra ID stub's profiled paths three times: the
// INS frontend fetches the discovery document, the token and the keys on every
// use and caches none of them.
export const DEFRA_ID_PROFILED_CALLS_PER_SIGN_IN = 3

const SECONDS_PER_HOUR = 3600

// confluence:6604328622 NFR-VOL-CORE-01. `steadyStateSessions` is one hour of
// sessions at twice the design target: the stub keeps a session for an hour.
export const DESIGN_TARGET_FACTOR = 2
export const SIGN_IN_TARGETS = Object.freeze({
  twoJourneys: Object.freeze({
    designPerHour: 200,
    steadyStateSessions: 400
  }),
  withIuu: Object.freeze({ designPerHour: 770, steadyStateSessions: 1540 })
})

// confluence:6604328622 section 4.2 and NFR-VOL-CORE-05.
export const FRONT_DOOR_SPIKE_PER_SECOND = 5
export const SPIKE_SECONDS = 10
export const HOLD_SECONDS = 60
export const RECOVERY_SECONDS = 60
const SPIKE_RAMP_SECONDS = 1

/**
 * The sign-ins a second the Defra ID stub must carry for a sign-in target:
 * twice the design target an hour, plus the front-door spike reaching sign-in.
 *
 * @param {{ designPerHour: number }} target - A sign-in target.
 * @returns {number} Sign-ins a second.
 */
export const requiredSignInsPerSecond = (target) =>
  (target.designPerHour * DESIGN_TARGET_FACTOR) / SECONDS_PER_HOUR +
  FRONT_DOOR_SPIKE_PER_SECOND

export const CEILING_GROUPS = Object.freeze([
  'trade-token',
  'mdm',
  'defra-id-target',
  'defra-id'
])

const freezeDeep = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep)
    Object.freeze(value)
  }

  return value
}

const JAVA_STUB_LADDER = [
  10, 25, 50, 100, 200, 300, 400, 600, 800, 1200, 1600, 2400
]

// The Java ladders are in requests a second, the Defra ID ladder in sign-ins a second.
export const STUB_CEILING_DEFAULTS = freezeDeep({
  stepSeconds: 20,
  gapSeconds: 5,
  requestTimeout: '10s',
  warmUpSignInsPerSecond: 8,
  ladders: {
    'trade-token': JAVA_STUB_LADDER,
    mdm: JAVA_STUB_LADDER,
    'defra-id': [1, 2, 3, 5, 8, 12, 16, 24, 32]
  }
})

// How long one iteration may be in flight, in seconds, which sizes the virtual users.
export const IN_FLIGHT_SECONDS = Object.freeze({
  'trade-token': 1,
  mdm: 1,
  'defra-id': 4
})

const PRE_ALLOCATED_SHARE = 4
const DURATION_FORMAT = /^\d+[smh]$/
const WHOLE_NUMBER_KEYS = new Set([
  'stepSeconds',
  'gapSeconds',
  'warmUpSignInsPerSecond'
])

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
      `Stub ceiling model value "${joinPath(parent, key)}" must be an object`
    )
  }

  return deepMerge(base[key], override[key], joinPath(parent, key))
}

const deepMerge = (base, override, parent = '') => {
  const unknown = Object.keys(override).find((key) => !(key in base))

  if (unknown !== undefined) {
    throw new Error(
      `Unknown stub ceiling model key "${joinPath(parent, unknown)}"`
    )
  }

  return Object.fromEntries(
    Object.keys(base).map((key) => [key, mergeKey(base, override, key, parent)])
  )
}

const isPositiveNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const isStrictlyIncreasing = (values) =>
  values.every((value, index) => index === 0 || value > values[index - 1])

const ladderFailure = (value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(isPositiveNumber) &&
  isStrictlyIncreasing(value)
    ? undefined
    : 'a non-empty list of positive numbers, each more than the one before'

const scalarFailure = (key, value) => {
  if (key === 'requestTimeout') {
    return typeof value === 'string' && DURATION_FORMAT.test(value)
      ? undefined
      : 'a duration such as 10s'
  }

  if (!isPositiveNumber(value)) {
    return 'a positive number'
  }

  return WHOLE_NUMBER_KEYS.has(key) && !Number.isInteger(value)
    ? 'a whole number'
    : undefined
}

const failIfAny = (path, failure) => {
  if (failure) {
    throw new Error(`Stub ceiling model value "${path}" must be ${failure}`)
  }
}

const validateModel = (model) => {
  for (const [key, value] of Object.entries(model)) {
    if (key === 'ladders') {
      Object.entries(value).forEach(([integration, ladder]) =>
        failIfAny(`ladders.${integration}`, ladderFailure(ladder))
      )
      continue
    }

    failIfAny(key, scalarFailure(key, value))
  }
}

const parseJson = (text, name) => {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${name} is not valid JSON`)
  }
}

const jsonObjectFrom = (env, name) => {
  const text = env[name]?.trim()

  if (!text) {
    return {}
  }

  const parsed = parseJson(text, name)

  if (!isPlainObject(parsed)) {
    throw new Error(`${name} is not valid JSON`)
  }

  return parsed
}

/**
 * Works out the ladder and step settings of a stub-ceiling run.
 *
 * Lays a JSON object in `STUB_CEILING_MODEL` over the defaults, so a revised
 * ladder changes a value and never a script. Throws, naming the key, for an
 * unknown key or a value that is not allowed.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @returns {object} The deep-frozen model.
 */
export const resolveCeilingModel = (env) => {
  const model = deepMerge(
    STUB_CEILING_DEFAULTS,
    jsonObjectFrom(env, 'STUB_CEILING_MODEL')
  )

  validateModel(model)

  return freezeDeep(model)
}

/**
 * Works out which groups of the stub-ceiling suite a run executes.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @returns {string[]} The groups of `STUB_CEILING_GROUPS`, in `CEILING_GROUPS` order, or all of them when it is blank or unset.
 * @throws {Error} Naming a group that does not exist.
 */
export const resolveCeilingGroups = (env) => {
  const names = (env.STUB_CEILING_GROUPS ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)

  const unknown = names.find((name) => !CEILING_GROUPS.includes(name))

  if (unknown !== undefined) {
    throw new Error(
      `STUB_CEILING_GROUPS names an unknown group "${unknown}". Use ${CEILING_GROUPS.slice(0, -1).join(', ')} or ${CEILING_GROUPS.at(-1)}.`
    )
  }

  return names.length === 0
    ? [...CEILING_GROUPS]
    : CEILING_GROUPS.filter((group) => names.includes(group))
}

/**
 * Names the scenario of one ladder step.
 *
 * @param {string} integration - The integration the ladder measures.
 * @param {number} rate - The step's rate.
 * @returns {string} For example `ceiling-mdm-0200`.
 */
export const stepScenarioName = (integration, rate) =>
  `ceiling-${integration}-${String(rate).padStart(4, '0')}`

const EXEC_BY_INTEGRATION = Object.freeze({
  'trade-token': 'tradeTokenCall',
  mdm: 'mdmCall',
  'defra-id': 'defraIdSignInAndOut'
})

const stepScenario = ({ integration, rate, model, startSeconds }) => ({
  executor: 'constant-arrival-rate',
  rate,
  timeUnit: '1s',
  duration: `${model.stepSeconds}s`,
  preAllocatedVUs: Math.max(
    1,
    Math.ceil((rate * IN_FLIGHT_SECONDS[integration]) / PRE_ALLOCATED_SHARE)
  ),
  maxVUs: Math.max(1, Math.ceil(rate * IN_FLIGHT_SECONDS[integration])),
  gracefulStop: `${model.gapSeconds}s`,
  startTime: `${startSeconds}s`,
  exec: EXEC_BY_INTEGRATION[integration],
  tags: { integration }
})

const warmUpScenario = ({ sessions, model, startSeconds }) => {
  const rate = model.warmUpSignInsPerSecond
  const seconds = Math.ceil(sessions / rate)

  return {
    seconds,
    scenario: {
      executor: 'constant-arrival-rate',
      rate,
      timeUnit: '1s',
      duration: `${seconds}s`,
      preAllocatedVUs: rate,
      maxVUs: rate * IN_FLIGHT_SECONDS['defra-id'],
      gracefulStop: `${model.gapSeconds}s`,
      startTime: `${startSeconds}s`,
      exec: 'defraIdSignIn',
      tags: { integration: 'defra-id' }
    }
  }
}

const TARGET_PRE_ALLOCATED_VUS = 4
const TARGET_MAX_VUS = 40

const targetScenario = ({ target, model, startSeconds }) => {
  const perHour = target.designPerHour * DESIGN_TARGET_FACTOR
  const spikePerHour = perHour + FRONT_DOOR_SPIKE_PER_SECOND * SECONDS_PER_HOUR
  const seconds =
    HOLD_SECONDS +
    SPIKE_RAMP_SECONDS +
    SPIKE_SECONDS +
    SPIKE_RAMP_SECONDS +
    RECOVERY_SECONDS

  return {
    seconds,
    scenario: {
      executor: 'ramping-arrival-rate',
      timeUnit: '1h',
      startRate: perHour,
      stages: [
        { duration: `${HOLD_SECONDS}s`, target: perHour },
        { duration: `${SPIKE_RAMP_SECONDS}s`, target: spikePerHour },
        { duration: `${SPIKE_SECONDS}s`, target: spikePerHour },
        { duration: `${SPIKE_RAMP_SECONDS}s`, target: perHour },
        { duration: `${RECOVERY_SECONDS}s`, target: perHour }
      ],
      preAllocatedVUs: TARGET_PRE_ALLOCATED_VUS,
      maxVUs: TARGET_MAX_VUS,
      gracefulStop: `${model.gapSeconds}s`,
      startTime: `${startSeconds}s`,
      exec: 'defraIdSignIn',
      tags: { integration: 'defra-id' }
    }
  }
}

const { twoJourneys, withIuu } = SIGN_IN_TARGETS

const sequence = (entries, model) =>
  entries.reduce(
    (state, build) => {
      const { seconds, scenarios } = build(state.startSeconds)

      return {
        scenarios: { ...state.scenarios, ...scenarios },
        startSeconds: state.startSeconds + seconds + model.gapSeconds
      }
    },
    { scenarios: {}, startSeconds: 0 }
  )

const singleScenario = (name, built) => (startSeconds) => {
  const { seconds, scenario } = built(startSeconds)

  return { seconds, scenarios: { [name]: scenario } }
}

const ladderEntries = ({ integration, model }) =>
  model.ladders[integration].map((rate) => (startSeconds) => ({
    seconds: model.stepSeconds,
    scenarios: {
      [stepScenarioName(integration, rate)]: stepScenario({
        integration,
        rate,
        model,
        startSeconds
      })
    }
  }))

const targetEntries = (model) => [
  singleScenario('defra-id-warm-up-two-journeys', (startSeconds) =>
    warmUpScenario({
      sessions: twoJourneys.steadyStateSessions,
      model,
      startSeconds
    })
  ),
  singleScenario('defra-id-target-two-journeys', (startSeconds) =>
    targetScenario({ target: twoJourneys, model, startSeconds })
  ),
  singleScenario('defra-id-warm-up-with-iuu', (startSeconds) =>
    warmUpScenario({
      sessions: withIuu.steadyStateSessions - twoJourneys.steadyStateSessions,
      model,
      startSeconds
    })
  ),
  singleScenario('defra-id-target-with-iuu', (startSeconds) =>
    targetScenario({ target: withIuu, model, startSeconds })
  )
]

const defraIdLadderEntries = (model) => [
  singleScenario('defra-id-warm-up-ladder', (startSeconds) =>
    warmUpScenario({
      sessions: withIuu.steadyStateSessions,
      model,
      startSeconds
    })
  ),
  ...ladderEntries({ integration: 'defra-id', model })
]

const entriesFor = (group, model) => {
  if (group === 'defra-id-target') {
    return targetEntries(model)
  }

  return group === 'defra-id'
    ? defraIdLadderEntries(model)
    : ladderEntries({ integration: group, model })
}

const LADDER_GROUPS = Object.freeze(['trade-token', 'mdm', 'defra-id'])

/**
 * Builds the k6 `scenarios` option of the stub-ceiling suite.
 *
 * Groups run one after another in the order given, each scenario after the one
 * before it plus a gap. Every ladder step is its own scenario, so k6 measures
 * each step separately.
 *
 * @param {object} model - A resolved ceiling model.
 * @param {string[]} groups - The groups to run, in order.
 * @returns {{ scenarios: Record<string, object>, stepScenarios: string[], ladders: Record<string, Array<{ scenario: string, rate: number }>> }} The scenarios, the names of the ladder steps, and each ladder's steps in order.
 */
export const ceilingScenarios = (model, groups) => {
  const { scenarios } = sequence(
    groups.flatMap((group) => entriesFor(group, model)),
    model
  )
  const ladderGroups = groups.filter((group) => LADDER_GROUPS.includes(group))
  const ladders = Object.fromEntries(
    ladderGroups.map((integration) => [
      integration,
      model.ladders[integration].map((rate) => ({
        scenario: stepScenarioName(integration, rate),
        rate
      }))
    ])
  )

  return {
    scenarios,
    stepScenarios: Object.values(ladders).flatMap((steps) =>
      steps.map(({ scenario }) => scenario)
    ),
    ladders
  }
}

export const DEFRA_ID_PATHS = Object.freeze({
  wellKnown:
    '/idphub/b2c/b2c_1a_cui_cpdev_signupsigninsfi/.well-known/openid-configuration',
  authorize:
    '/dcidmtest.onmicrosoft.com/b2c_1a_cui_cpdev_signupsigninsfi/oauth2/v2.0/authorize',
  token:
    '/dcidmtest.onmicrosoft.com/b2c_1a_cui_cpdev_signupsigninsfi/oauth2/v2.0/token',
  keys: '/dcidmtest.onmicrosoft.com/b2c_1a_cui_cpdev_signupsigninsfi/discovery/v2.0/keys',
  signOut: '/idphub/b2c/b2c_1a_cui_cpdev_signupsigninsfi/signout'
})

const DEFAULT_DEFRA_ID_CLIENT_ID = 'test-client-id'

/**
 * Works out the client the stub-ceiling suite signs in as.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @returns {{ clientId: string, serviceId: string, redirectUri: string }} The client, from `DEFRA_ID_CLIENT_ID` or a default.
 */
export const resolveDefraIdClient = (env) => ({
  clientId: env.DEFRA_ID_CLIENT_ID?.trim() || DEFAULT_DEFRA_ID_CLIENT_ID,
  serviceId: 'trade-imports-ins-frontend',
  redirectUri: 'http://stub-ceiling.invalid/auth/sign-in-oidc'
})

export const RECORDED_CEILINGS = freezeDeep({
  local: {
    'trade-token': {
      'zero-delay': {
        rps: 2400,
        atLeast: true,
        measured: '2026-10-02',
        source:
          'breakpoint-stubs run, workspace Docker stack (--dev), trade-token'
      }
    },
    mdm: {
      'zero-delay': {
        rps: 2400,
        atLeast: true,
        measured: '2026-10-02',
        source: 'breakpoint-stubs run, workspace Docker stack (--dev), mdm'
      }
    },
    'defra-id': {
      'zero-delay': {
        rps: 96,
        atLeast: true,
        measured: '2026-10-02',
        source:
          'breakpoint-stubs run, own defra-id-stub-ceiling container, image defradigital/trade-imports-defra-id-stub:latest'
      }
    }
  }
})

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/

const ceilingFailure = (value) => {
  if (!isPlainObject(value)) {
    return 'an object'
  }

  const { rps, atLeast, measured, source } = value
  const rpsIsValid = typeof rps === 'number' && Number.isFinite(rps) && rps >= 0

  if (!rpsIsValid) {
    return 'an rps that is a number of at least 0'
  }

  if (typeof atLeast !== 'boolean') {
    return 'an atLeast that is true or false'
  }

  if (typeof measured !== 'string' || !DATE_FORMAT.test(measured)) {
    return 'a measured date such as 2026-10-02'
  }

  return typeof source === 'string' && source.length > 0
    ? undefined
    : 'a source that says where it was measured'
}

const validateCeilings = (override) => {
  for (const [integration, profiles] of Object.entries(override)) {
    if (!isPlainObject(profiles)) {
      throw new Error(`STUB_CEILINGS value "${integration}" must be an object`)
    }

    for (const [profile, value] of Object.entries(profiles)) {
      const failure = ceilingFailure(value)

      if (failure) {
        throw new Error(
          `STUB_CEILINGS value "${integration}.${profile}" must be ${failure}`
        )
      }
    }
  }
}

const mergeCeilings = (recorded, override) =>
  Object.fromEntries(
    [...new Set([...Object.keys(recorded), ...Object.keys(override)])].map(
      (integration) => [
        integration,
        { ...recorded[integration], ...override[integration] }
      ]
    )
  )

/**
 * Works out the stub ceilings a run judges its stubs against.
 *
 * Takes the ceilings recorded for the environment and lays a JSON object in
 * `STUB_CEILINGS` over them per integration and profile.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @param {string} environment - The environment the run is in.
 * @returns {Record<string, Record<string, { rps: number, atLeast: boolean, measured: string, source: string }>>} Ceilings by integration, then profile.
 * @throws {Error} Naming the integration and profile whose value is not allowed.
 */
export const resolveRecordedCeilings = (env, environment) => {
  const override = jsonObjectFrom(env, 'STUB_CEILINGS')

  validateCeilings(override)

  return mergeCeilings(RECORDED_CEILINGS[environment] ?? {}, override)
}
