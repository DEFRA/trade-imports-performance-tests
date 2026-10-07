import { REFERENCE_DATA_WATCH_SCENARIO } from './design-target.js'
import { durationSeconds, durationText } from './traffic.js'

/** The five kinds of fault a stub injects, in the order the catalogue runs them. */
export const FAULT_KINDS = Object.freeze([
  'slow',
  'hang',
  'reset',
  'throttle',
  'error'
])

// AMQP has no HTTP status, so a Service Bus fault cannot throttle or answer 5xx: it can be slow, hang or reset.
const SERVICE_BUS_KINDS = Object.freeze(['slow', 'hang', 'reset'])

/** The proxy the workspace stack's toxiproxy holds in front of the Service Bus emulator (docker/stack/toxiproxy/toxiproxy.json). */
export const SERVICE_BUS_PROXY = 'servicebus'

/** The prefix of every toxic a resilience run adds, so a run clears only its own. */
export const TOXIC_PREFIX = 'resilience-'

/** How long past the fault window a stub fault lasts, so a run that dies cannot leave a stub broken for long. */
export const FAULT_EXPIRY_MARGIN_SECONDS = 30

/** Where a fault is injected: the stub that hosts the integration, or toxiproxy for Service Bus. */
export const FAULT_HOSTS = Object.freeze({
  DEFRA_ID_STUB: 'trade-imports-defra-id-stub',
  TRADE_IMPORTS_STUB: 'trade-imports-stub',
  TOXIPROXY: 'toxiproxy'
})

/**
 * Every stubbed integration a resilience run faults, where, and with which
 * kinds. SNS, SQS and cdp-uploader are real services and appear nowhere here.
 * The order is the catalogue's run order.
 */
export const FAULT_TARGETS = Object.freeze(
  [
    {
      integration: 'defra-id',
      host: FAULT_HOSTS.DEFRA_ID_STUB,
      kinds: FAULT_KINDS
    },
    {
      integration: 'trade-token',
      host: FAULT_HOSTS.TRADE_IMPORTS_STUB,
      kinds: FAULT_KINDS
    },
    {
      integration: 'mdm',
      host: FAULT_HOSTS.TRADE_IMPORTS_STUB,
      kinds: FAULT_KINDS
    },
    {
      integration: 'azure-service-bus',
      host: FAULT_HOSTS.TOXIPROXY,
      kinds: SERVICE_BUS_KINDS
    }
  ].map(Object.freeze)
)

/**
 * Names a fault.
 *
 * @param {string} integration - A stubbed integration, such as `mdm`.
 * @param {string} kind - A fault kind, such as `error`.
 * @returns {string} For example `mdm-error`.
 */
export const faultId = (integration, kind) => `${integration}-${kind}`

/** Every fault a resilience run can inject, in run order. */
export const FAULT_CATALOGUE = Object.freeze(
  FAULT_TARGETS.flatMap(({ integration, host, kinds }) =>
    kinds.map((kind) =>
      Object.freeze({ id: faultId(integration, kind), integration, kind, host })
    )
  )
)

/** The integrations a stub hosts, so a stub injects their faults; Service Bus is faulted through toxiproxy instead. */
export const STUB_HOSTED_INTEGRATIONS = Object.freeze([
  ...new Set(
    FAULT_TARGETS.filter(({ host }) => host !== FAULT_HOSTS.TOXIPROXY).map(
      ({ integration }) => integration
    )
  )
])

const knownPairs = () =>
  FAULT_CATALOGUE.map(({ integration, kind }) => `${integration}:${kind}`)

/**
 * Reads which faults a resilience run injects.
 *
 * `RESILIENCE_FAULTS` is a comma list of `<integration>:<kind>`. Blank or unset
 * means every fault in the catalogue. The faults come back in catalogue order,
 * whatever order they were written in.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @returns {ReadonlyArray<{ id: string, integration: string, kind: string, host: string }>} The faults to inject.
 * @throws {Error} Naming the first pair that is not in the catalogue, or saying the list names no fault when it holds only commas and spaces.
 */
export const resolveResilienceFaults = (env) => {
  const text = env.RESILIENCE_FAULTS?.trim()

  if (!text) {
    return FAULT_CATALOGUE
  }

  const known = knownPairs()
  const chosen = text
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)

  if (chosen.length === 0) {
    throw new Error('RESILIENCE_FAULTS names no fault')
  }

  const unknown = chosen.find((pair) => !known.includes(pair))

  if (unknown !== undefined) {
    throw new Error(
      `RESILIENCE_FAULTS has an unknown fault: ${unknown}. Known: ${known.join(', ')}`
    )
  }

  return FAULT_CATALOGUE.filter(({ integration, kind }) =>
    chosen.includes(`${integration}:${kind}`)
  )
}

/**
 * The calling service of each faulted integration and the requests that show
 * how it coped.
 *
 * `durationTags` and `failedTags` select the caller's own requests in a fault
 * window. `demand` counts the calls the caller made that needed the dependency,
 * the denominator of the retry bound. Service Bus is asynchronous to every
 * request k6 makes, so it has no request evidence: its callers' behaviour is
 * read from the gateway's backlog and dead letters.
 */
export const CALLER_EVIDENCE = Object.freeze({
  'defra-id': Object.freeze({
    callers: 'the ins, animals and plants frontends',
    synchronous: true,
    durationTags: Object.freeze({ endpoint: 'sign-in' }),
    failedTags: Object.freeze({ endpoint: 'sign-in' }),
    demand: Object.freeze({
      metric: 'page_requests',
      stat: 'count',
      tags: Object.freeze({ traffic_class: 'sign-in' })
    })
  }),
  'trade-token': Object.freeze({
    callers: 'reference-data',
    synchronous: true,
    durationTags: Object.freeze({
      scenario: REFERENCE_DATA_WATCH_SCENARIO,
      kind: 'api'
    }),
    failedTags: Object.freeze({ scenario: REFERENCE_DATA_WATCH_SCENARIO }),
    demand: Object.freeze({
      metric: 'http_req_duration',
      stat: 'count',
      tags: Object.freeze({ endpoint: 'reference-data-countries-uncached' })
    })
  }),
  mdm: Object.freeze({
    callers: 'reference-data',
    synchronous: true,
    durationTags: Object.freeze({
      scenario: REFERENCE_DATA_WATCH_SCENARIO,
      kind: 'api'
    }),
    failedTags: Object.freeze({ scenario: REFERENCE_DATA_WATCH_SCENARIO }),
    demand: Object.freeze({
      metric: 'http_req_duration',
      stat: 'count',
      tags: Object.freeze({ endpoint: 'reference-data-countries-uncached' })
    })
  }),
  'azure-service-bus': Object.freeze({
    callers: 'the dynamics gateway',
    synchronous: false
  })
})

const JOURNEY_AND_FRONT_DOOR = Object.freeze([
  'live-animals',
  'high-risk-plants',
  'ins-front-door',
  'ins-address-book'
])

/**
 * What must stay within its thresholds while each integration is faulted.
 *
 * `scenarios` are the journey and front-door scenarios judged; `watch` says
 * whether the reference-data watch is judged; `signIn` and `deadLetters` say
 * whether sign-in failures and dead-letter growth are. The journeys and the
 * front door all sign in through Defra ID, so neither journey is "the other
 * journey" for a Defra ID fault: they are reported, not judged.
 */
export const CASCADE_SCOPE = Object.freeze({
  'defra-id': Object.freeze({
    scenarios: Object.freeze([]),
    watch: true,
    signIn: false,
    deadLetters: true
  }),
  'trade-token': Object.freeze({
    scenarios: JOURNEY_AND_FRONT_DOOR,
    watch: false,
    signIn: true,
    deadLetters: true
  }),
  mdm: Object.freeze({
    scenarios: JOURNEY_AND_FRONT_DOOR,
    watch: false,
    signIn: true,
    deadLetters: true
  }),
  'azure-service-bus': Object.freeze({
    scenarios: JOURNEY_AND_FRONT_DOOR,
    watch: true,
    signIn: true,
    deadLetters: false
  })
})

/**
 * What each service declares it does when a dependency fails, by fault id: its
 * declared degradation. No service declares one today, so a caller that
 * absorbs a fault or fails cleanly both pass. Declaring one, for example
 * `{ 'mdm-error': 'absorbed' }` for a reference-data that serves its cache, is a
 * change to this value, after which a caller that does something else is
 * `NOT AS DECLARED`.
 */
export const DECLARED_DEGRADATION = Object.freeze({})

/**
 * How a fault's injection went, as the number the run records in
 * `fault_injection_applied` so the report can say why nothing was judged.
 * Every value is zero or more, so the reporting threshold `value>=0` holds.
 */
export const INJECTION_CODES = Object.freeze({
  NOT_ATTEMPTED: 0,
  APPLIED: 1,
  STUB_PREDATES_FAULTS: 2,
  HOST_UNREACHABLE: 3,
  NO_SERVICE_BUS_PROXY: 4,
  APPLY_REFUSED: 5
})

/**
 * Words why a fault was not injected.
 *
 * @param {number} code - A value of `INJECTION_CODES` other than `APPLIED`.
 * @param {string} environment - The environment the run is in.
 * @returns {string} The reason, such as `the stub predates fault injection (GET /faults answered 404)`.
 */
export const notInjectedReason = (code, environment) =>
  ({
    [INJECTION_CODES.NOT_ATTEMPTED]: 'the fault was never switched on',
    [INJECTION_CODES.STUB_PREDATES_FAULTS]:
      'the stub predates fault injection (GET /faults answered 404)',
    [INJECTION_CODES.HOST_UNREACHABLE]: 'the stub could not be reached',
    [INJECTION_CODES.NO_SERVICE_BUS_PROXY]: `no Service Bus fault proxy in ${environment}: CDP configuration (req-006)`,
    [INJECTION_CODES.APPLY_REFUSED]: 'the fault host refused the fault'
  })[code] ?? 'the fault was not injected'

const stubFaultFields = ({ kind, model }) => {
  const { slowDelayMs, hangMs, retryAfterSeconds, errorStatus } =
    model.resilience

  return {
    slow: { delayMs: slowDelayMs },
    hang: { delayMs: hangMs },
    reset: {},
    throttle: { retryAfterSeconds },
    error: { status: errorStatus }
  }[kind]
}

/**
 * The rate a fault kind applies at.
 *
 * @param {object} options - The fault.
 * @param {string} options.kind - A fault kind.
 * @param {object} options.model - A resolved traffic model.
 * @returns {number} A share from 0 to 1.
 */
export const rateOf = ({ kind, model }) => model.resilience[`${kind}Rate`]

/**
 * Builds the body of `PUT /faults/{integration}` for a fault.
 *
 * @param {object} options - The fault.
 * @param {string} options.kind - A fault kind.
 * @param {object} options.model - A resolved traffic model.
 * @returns {object} The body. The fault expires a margin after its window, so a run that dies cannot leave a stub broken.
 */
export const stubFaultBody = ({ kind, model }) => ({
  kind,
  rate: rateOf({ kind, model }),
  ...stubFaultFields({ kind, model }),
  expiresInSeconds:
    durationSeconds(model.resilience.faultDuration) +
    FAULT_EXPIRY_MARGIN_SECONDS
})

const TOXICS = Object.freeze({
  slow: ({ slowDelayMs }) => ({
    type: 'latency',
    attributes: { latency: slowDelayMs, jitter: 0 }
  }),
  hang: () => ({ type: 'timeout', attributes: { timeout: 0 } }),
  reset: () => ({ type: 'reset_peer', attributes: { timeout: 0 } })
})

/**
 * The name of a Service Bus fault's toxic.
 *
 * @param {string} kind - `slow`, `hang` or `reset`.
 * @returns {string} For example `resilience-hang`.
 */
export const toxicName = (kind) => `${TOXIC_PREFIX}${kind}`

/**
 * Builds the body of toxiproxy's `POST /proxies/servicebus/toxics` for a Service Bus fault.
 *
 * `timeout` with a timeout of 0 holds data until the toxic is removed; the
 * toxicity is the fault's rate, per connection, since the gateway holds one
 * long-lived AMQP connection.
 *
 * @param {object} options - The fault.
 * @param {string} options.kind - `slow`, `hang` or `reset`.
 * @param {object} options.model - A resolved traffic model.
 * @returns {{ name: string, type: string, stream: string, toxicity: number, attributes: object }} The body.
 */
export const toxicBody = ({ kind, model }) => ({
  name: toxicName(kind),
  ...TOXICS[kind](model.resilience),
  stream: 'downstream',
  toxicity: rateOf({ kind, model })
})

const plural = (count, word) => (count === 1 ? word : `${word}s`)

/**
 * Words a count with its noun.
 *
 * @param {number} count - How many.
 * @param {string} noun - The noun in the singular, such as `message`.
 * @returns {string} For example `1 message` or `2 messages`.
 */
export const countText = (count, noun) => `${count} ${plural(count, noun)}`

/**
 * The log line that states what a resilience run applies.
 *
 * @param {object} options - The run.
 * @param {object} options.model - A resolved traffic model.
 * @param {ReadonlyArray<{ id: string }>} options.faults - The faults the run injects.
 * @returns {string} The line.
 */
export const resilienceProfileLine = ({ model, faults }) => {
  const {
    faultDuration,
    clearedDuration,
    recoveryStep,
    slowDelayMs,
    hangMs,
    errorStatus,
    retryAfterSeconds,
    throttleRate,
    errorRate
  } = model.resilience
  const percent = (rate) => `${Math.round(rate * 100)}%`

  return `Resilience: ${countText(faults.length, 'fault')} (${faults.map(({ id }) => id).join(', ')}), each ${faultDuration} injected then ${clearedDuration} cleared in ${recoveryStep} steps; slow ${slowDelayMs}ms, hang ${hangMs}ms, throttle 429 at ${percent(throttleRate)} with Retry-After ${retryAfterSeconds}s, error ${errorStatus} at ${percent(errorRate)}; SNS, SQS and cdp-uploader are never faulted`
}

/**
 * How long, in whole recovery steps, a cleared window lasts.
 *
 * @param {object} model - A resolved traffic model.
 * @returns {number} The number of steps.
 */
export const recoveryStepCount = (model) =>
  durationSeconds(model.resilience.clearedDuration) /
  durationSeconds(model.resilience.recoveryStep)

/**
 * Words how long a number of recovery steps takes.
 *
 * @param {object} model - A resolved traffic model.
 * @param {number} steps - A number of steps.
 * @returns {string} For example `90s`.
 */
export const stepsDurationText = (model, steps) =>
  durationText(steps * durationSeconds(model.resilience.recoveryStep))
