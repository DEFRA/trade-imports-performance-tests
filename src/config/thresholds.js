import { PHASES, SHAPES } from './design-target.js'
import { kindOf } from './endpoints.js'
import { HEADROOM_MEASURES } from './stub-ceilings.js'
import { FLAGS, PROFILES, QUANTILES } from './stub-profiles.js'

// Pages that upload and scan a document: DR-EUDP-005 section 4.7, SYN-28, SYN-29.
const UPLOAD_PAGE_ALLOWANCE_MS = 60_000

// Interim targets until INS sets its own: c-004 default, DR-EUDP-005 section 4.7.
export const INTERIM_TARGETS = Object.freeze({
  page: Object.freeze({ p95Ms: 2000, p99Ms: 5000 }),
  api: Object.freeze({ p95Ms: 200, p99Ms: 1200 }),
  upload: Object.freeze({ p99Ms: UPLOAD_PAGE_ALLOWANCE_MS }),
  maxFailureRate: 0.01,
  minCheckPassRate: 0.99,
  // c-004's default: P99 burst passes when 5xx stays under 1% and P95 is no worse
  // than twice the sustained-peak P95. minSamples is interim: a P95 of a handful
  // of requests says nothing.
  burst: Object.freeze({
    maxServerErrorRate: 0.01,
    p95FactorOverPeak: 2,
    minSamples: 10
  })
})

const MAX_DROPPED_ITERATIONS = 1

const ABORT = Object.freeze({ abortOnFail: true, delayAbortEval: '30s' })

const withAbort = (limits) =>
  limits.map((threshold) => ({ threshold, ...ABORT }))

const durationLimits = (kind) => {
  const { p95Ms, p99Ms } = INTERIM_TARGETS[kind]

  return [
    ...(p95Ms === undefined ? [] : [`p(95)<${p95Ms}`]),
    ...(p99Ms === undefined ? [] : [`p(99)<${p99Ms}`])
  ]
}

const scenarioHealthThresholds = (scenario) => ({
  [`http_req_failed{scenario:${scenario}}`]: withAbort([
    `rate<${INTERIM_TARGETS.maxFailureRate}`
  ]),
  [`checks{scenario:${scenario}}`]: withAbort([
    `rate>${INTERIM_TARGETS.minCheckPassRate}`
  ]),
  [`dropped_iterations{scenario:${scenario}}`]: [
    `count<${MAX_DROPPED_ITERATIONS}`
  ]
})

/**
 * Spells a sub-metric key the way k6 keys its summary.
 *
 * @param {string} metric - The metric name.
 * @param {Record<string, string>} tags - The tags, in the order they are written.
 * @returns {string} For example `http_req_duration{scenario:a,phase:hold}`.
 */
export const subMetricKey = (metric, tags) =>
  `${metric}{${Object.entries(tags)
    .map(([key, value]) => `${key}:${value}`)
    .join(',')}}`

/**
 * Builds the named thresholds for one scenario.
 *
 * Every key is scoped to the scenario, so the readiness wait in `setup()` is
 * never measured. Response times are also scoped to each endpoint, with the
 * limits for its kind, and to a phase when one is given. Failed requests and
 * failed checks each get a rate limit. The open model must start every
 * iteration on time, so a dropped iteration fails the run: it means the stated
 * arrival rate was not applied.
 *
 * Unphased response times abort the run on a breach. Phase-scoped response
 * times are judged at the end of the run and do not abort: k6 counts the abort
 * delay from the start of the test, so a phase that starts hours in would be
 * judged on its first few samples.
 *
 * @param {string} scenario - The scenario name.
 * @param {string[]} endpoints - Endpoint names from the catalogue.
 * @param {string} [phase] - A run phase that response times are scoped to.
 * @returns {Record<string, Array<string | { threshold: string, abortOnFail: boolean, delayAbortEval: string }>>} k6 thresholds.
 */
export const scenarioThresholds = (scenario, endpoints, phase) => {
  const durations = Object.fromEntries(
    endpoints.map((endpoint) => [
      subMetricKey('http_req_duration', {
        scenario,
        endpoint,
        ...(phase === undefined ? {} : { phase })
      }),
      phase === undefined
        ? withAbort(durationLimits(kindOf(endpoint)))
        : durationLimits(kindOf(endpoint))
    ])
  )

  return { ...durations, ...scenarioHealthThresholds(scenario) }
}

/**
 * Merges the thresholds of every scenario into one k6 `thresholds` object.
 *
 * @param {Record<string, { endpoints: string[] }>} scenarios - Scenarios shaped like `SCENARIOS`.
 * @returns {Record<string, Array<string | { threshold: string, abortOnFail: boolean, delayAbortEval: string }>>} k6 thresholds.
 */
export const smokeThresholds = (scenarios) =>
  Object.assign(
    {},
    ...Object.entries(scenarios).map(([scenario, { endpoints }]) =>
      scenarioThresholds(scenario, endpoints)
    )
  )

/**
 * Builds the thresholds of the background-volume run, one set per scenario.
 *
 * They gate correctness only, never speed: the run is set-up with no think
 * time, so it measures nothing. Failed requests and failed checks abort the
 * run. A dropped iteration fails it at the end, so a run that could not finish
 * its batch in time says so.
 *
 * @param {string[]} scenarios - The scenario names.
 * @returns {Record<string, Array<string | { threshold: string, abortOnFail: boolean, delayAbortEval: string }>>} k6 thresholds.
 */
export const backgroundVolumeThresholds = (scenarios) =>
  Object.assign({}, ...scenarios.map(scenarioHealthThresholds))

/**
 * Builds one threshold per datastore, so k6 prints the background volume each
 * held when the run started.
 *
 * These can never fail: `value>=0` is always true. They exist only so the
 * end-of-test summary states each count. Every gating threshold stays tied to
 * a figure.
 *
 * @param {string[]} datastores - The datastore names.
 * @returns {Record<string, string[]>} k6 thresholds.
 */
export const backgroundVolumeReportThresholds = (datastores) =>
  Object.fromEntries(
    datastores.map((datastore) => [
      `background_volume{datastore:${datastore}}`,
      ['value>=0']
    ])
  )

const stubProfileKeys = ({ integration, stub }) => {
  const latencyKeys = (source) =>
    QUANTILES.map(
      (quantile) =>
        `stub_latency{integration:${integration},source:${source},quantile:${quantile}}`
    )

  return [
    ...PROFILES.map(
      (profile) => `stub_profile{integration:${integration},profile:${profile}}`
    ),
    ...FLAGS.map(
      (flag) => `stub_profile_flagged{integration:${integration},flag:${flag}}`
    ),
    ...latencyKeys('target'),
    ...(stub === null
      ? []
      : [
          ...latencyKeys('answered'),
          `stub_latency_answered_count{integration:${integration}}`
        ])
  ]
}

/**
 * Builds the reporting-only thresholds that make k6 print each stubbed
 * integration's profile, flags and latency.
 *
 * These can never fail: `value>=0` is always true, with or without data. They
 * exist only so the end-of-test summary states each profile, flag and latency.
 * Every gating threshold stays tied to a figure. The answered quantiles are
 * meaningful only when `stub_latency_answered_count` is above 0.
 *
 * @param {Array<{ integration: string, stub: string | null }>} integrations - The stubbed integrations.
 * @returns {Record<string, string[]>} k6 thresholds.
 */
export const stubProfileReportThresholds = (integrations) =>
  Object.fromEntries(
    integrations.flatMap(stubProfileKeys).map((key) => [key, ['value>=0']])
  )

/**
 * Builds the threshold on how long a document's virus scan takes.
 *
 * The scan is held to the upload page allowance, P99 under 60 seconds. It is
 * judged at the end of the run and never aborts it, because a slow scan should
 * fail the run, not cut it short.
 *
 * @param {string} scenario - The scenario that uploads documents.
 * @returns {Record<string, string[]>} k6 thresholds.
 */
export const documentScanThresholds = (scenario) => ({
  [`document_scan_duration{scenario:${scenario}}`]: [
    `p(99)<${UPLOAD_PAGE_ALLOWANCE_MS}`
  ]
})

/**
 * Builds one threshold per notification type, so k6 prints each split of the load.
 *
 * These can never fail: `count>=0` is always true. They exist only so the
 * end-of-test summary states how many notifications of each type started.
 * Every gating threshold stays tied to a figure.
 *
 * @param {Array<[string, string]>} splits - Pairs of scenario name and notification type.
 * @returns {Record<string, string[]>} k6 thresholds.
 */
export const notificationSplitThresholds = (splits) =>
  Object.fromEntries(
    splits.map(([scenario, notificationType]) => [
      `notifications_started{scenario:${scenario},notification_type:${notificationType}}`,
      ['count>=0']
    ])
  )

const reportingOnly = (keys) =>
  Object.fromEntries(keys.map((key) => [key, ['value>=0']]))

const stepReportKeys = (scenario) => ({
  [`http_req_failed{scenario:${scenario}}`]: ['rate>=0'],
  [`checks{scenario:${scenario}}`]: ['rate>=0'],
  [`dropped_iterations{scenario:${scenario}}`]: ['count>=0'],
  [`iterations{scenario:${scenario}}`]: ['count>=0'],
  [`http_req_duration{scenario:${scenario},profiled:yes}`]: ['p(95)>=0']
})

/**
 * Builds the reporting-only thresholds that put each ladder step's figures in
 * the summary data `handleSummary` reads.
 *
 * These can never fail: each limit is always true. k6 keeps a sub-metric's
 * figures only when a threshold names it, and the suite judges each step from
 * them itself.
 *
 * @param {string[]} stepScenarios - The ladder steps' scenario names.
 * @returns {Record<string, string[]>} k6 thresholds.
 */
export const stubCeilingStepThresholds = (stepScenarios) =>
  Object.assign({}, ...stepScenarios.map(stepReportKeys))

const signInTargetGatingKeys = (scenario) => ({
  [`http_req_failed{scenario:${scenario}}`]: [
    `rate<${INTERIM_TARGETS.maxFailureRate}`
  ],
  [`checks{scenario:${scenario}}`]: [
    `rate>${INTERIM_TARGETS.minCheckPassRate}`
  ],
  [`dropped_iterations{scenario:${scenario}}`]: ['count<1'],
  [`http_req_duration{scenario:${scenario},profiled:yes}`]: ['p(95)>=0']
})

/**
 * Builds the thresholds of the Defra ID sign-in targets.
 *
 * A gating scenario must carry its sign-ins with failed requests under 1%,
 * checks over 99% and no dropped iteration. A reporting scenario states the
 * same figures and can never fail: with-IUU figures are reporting-only.
 *
 * @param {{ gating: string[], reporting: string[] }} scenarios - The scenario names of each kind.
 * @returns {Record<string, string[]>} k6 thresholds.
 */
export const signInTargetThresholds = ({ gating, reporting }) =>
  Object.assign(
    {},
    ...gating.map(signInTargetGatingKeys),
    ...reporting.map(stepReportKeys)
  )

/**
 * Builds the reporting-only thresholds that make k6 print each stubbed
 * integration's load, ceiling and headroom, and whether the run is trusted.
 *
 * These can never fail: `value>=0` is always true, with or without data. The
 * verdict is reported, never gated.
 *
 * @param {Array<{ integration: string, stub: string | null }>} integrations - The stubbed integrations.
 * @returns {Record<string, string[]>} k6 thresholds.
 */
export const stubHeadroomReportThresholds = (integrations) =>
  reportingOnly([
    ...integrations
      .filter(({ stub }) => stub !== null)
      .flatMap(({ integration }) => [
        ...HEADROOM_MEASURES.map(
          (measure) =>
            `stub_load{integration:${integration},measure:${measure}}`
        ),
        `stub_ceiling{integration:${integration}}`,
        `stub_headroom{integration:${integration}}`
      ]),
    'run_trusted'
  ])

const NEVER_FAILING_LIMITS = Object.freeze({
  http_req_duration: ['p(95)>=0'],
  session_seconds: ['p(95)>=0'],
  document_scan_duration: ['p(95)>=0'],
  http_req_failed: ['rate>=0'],
  checks: ['rate>=0'],
  server_errors: ['rate>=0'],
  dashboard_read_share: ['rate>=0'],
  dropped_iterations: ['count>=0'],
  page_requests: ['count>=0'],
  notifications_started: ['count>=0']
})

const metricNameOf = (key) => key.split('{')[0]

/**
 * Turns thresholds into reporting-only ones: each key keeps its sub-metric but
 * gets a limit that can never fail, so k6 still prints and exports its figures.
 *
 * @param {Record<string, unknown>} thresholds - k6 thresholds.
 * @returns {Record<string, string[]>} The same keys with limits that are always true.
 */
export const asReportingOnly = (thresholds) =>
  Object.fromEntries(
    Object.keys(thresholds).map((key) => [
      key,
      NEVER_FAILING_LIMITS[metricNameOf(key)] ?? ['value>=0']
    ])
  )

const burstScenarioThresholds = (scenario, endpoints) => ({
  [subMetricKey('server_errors', { scenario, phase: PHASES.BURST })]: [
    `rate<${INTERIM_TARGETS.burst.maxServerErrorRate}`
  ],
  [`checks{scenario:${scenario}}`]: [
    `rate>${INTERIM_TARGETS.minCheckPassRate}`
  ],
  [`dropped_iterations{scenario:${scenario}}`]: [
    `count<${MAX_DROPPED_ITERATIONS}`
  ],
  ...Object.fromEntries(
    endpoints.map((endpoint) => [
      subMetricKey('http_req_duration', {
        scenario,
        endpoint,
        phase: PHASES.PEAK
      }),
      ['p(95)>=0']
    ])
  )
})

const gatingDesignTargetThresholds = (shape, scenarioSet) => {
  const entries = Object.entries(scenarioSet)

  if (shape === SHAPES.SUSTAINED_PEAK) {
    return Object.assign(
      {},
      ...entries.map(([scenario, { endpoints }]) =>
        scenarioThresholds(scenario, endpoints, PHASES.HOLD)
      )
    )
  }

  return Object.assign(
    {},
    ...entries.map(([scenario, { endpoints }]) =>
      burstScenarioThresholds(scenario, endpoints)
    )
  )
}

/**
 * Builds the thresholds of a design-target run.
 *
 * Sustained peak judges response times in the hold phase, and failed requests,
 * checks and dropped iterations across the whole scenario. The burst run
 * judges 5xx in the burst minute, checks and dropped iterations across the
 * whole run, and only reports the peak phase's response times. With `gating`
 * false (the with-IUU profile) every limit can never fail.
 *
 * @param {object} options - The run.
 * @param {string} options.shape - `sustained-peak` or `p99-burst`.
 * @param {Record<string, { endpoints: string[] }>} options.scenarioSet - Scenarios shaped like `SCENARIOS`.
 * @param {boolean} options.gating - False makes the whole set reporting-only.
 * @returns {Record<string, Array<string | { threshold: string, abortOnFail: boolean, delayAbortEval: string }>>} k6 thresholds.
 */
export const designTargetThresholds = ({ shape, scenarioSet, gating }) => {
  const thresholds = gatingDesignTargetThresholds(shape, scenarioSet)

  return gating ? thresholds : asReportingOnly(thresholds)
}

const kindsOf = (endpoints) => [...new Set(endpoints.map(kindOf))]

const scenarioReportKeys = (scenario, endpoints, phase) => [
  subMetricKey('page_requests', { scenario, phase }),
  subMetricKey('notifications_started', { scenario, phase }),
  subMetricKey('session_seconds', { scenario, phase }),
  subMetricKey('server_errors', { scenario, phase }),
  ...kindsOf(endpoints).map((kind) =>
    subMetricKey('http_req_duration', { scenario, kind, phase })
  )
]

const runReportKeys = (phase) => [
  ...['ins', 'animals', 'plants'].map((frontend) =>
    subMetricKey('page_requests', { frontend, phase })
  ),
  subMetricKey('page_requests', { traffic_class: 'sign-in', phase }),
  subMetricKey('session_seconds', { phase }),
  subMetricKey('dashboard_read_share', { phase })
]

/**
 * Builds the reporting-only thresholds that put a design-target run's
 * per-phase figures in the summary data `handleSummary` reads.
 *
 * These can never fail. k6 keeps a sub-metric's figures only when a threshold
 * names it, and the run states its achieved rates from them.
 *
 * @param {object} options - The run.
 * @param {Record<string, { endpoints: string[] }>} options.scenarioSet - Scenarios shaped like `SCENARIOS`.
 * @param {string[]} options.phases - The phases the run reports.
 * @returns {Record<string, string[]>} k6 thresholds.
 */
export const designTargetReportThresholds = ({ scenarioSet, phases }) =>
  asReportingOnly(
    Object.fromEntries(
      phases
        .flatMap((phase) => [
          ...Object.entries(scenarioSet).flatMap(([scenario, { endpoints }]) =>
            scenarioReportKeys(scenario, endpoints, phase)
          ),
          ...runReportKeys(phase)
        ])
        .map((key) => [key, null])
    )
  )
