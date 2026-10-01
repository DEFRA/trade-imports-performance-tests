import { kindOf } from './endpoints.js'

// Pages that upload and scan a document: DR-EUDP-005 section 4.7, SYN-28, SYN-29.
const UPLOAD_PAGE_ALLOWANCE_MS = 60_000

// Interim targets until INS sets its own: c-004 default, DR-EUDP-005 section 4.7.
export const INTERIM_TARGETS = Object.freeze({
  page: Object.freeze({ p95Ms: 2000, p99Ms: 5000 }),
  api: Object.freeze({ p95Ms: 200, p99Ms: 1200 }),
  upload: Object.freeze({ p99Ms: UPLOAD_PAGE_ALLOWANCE_MS }),
  maxFailureRate: 0.01,
  minCheckPassRate: 0.99
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
 * Builds the named thresholds for one scenario.
 *
 * Every key is scoped to the scenario, so the readiness wait in `setup()` is
 * never measured. Response times are also scoped to each endpoint, with the
 * limits for its kind. Failed requests and failed checks each get a rate limit.
 * The open model must start every iteration on time, so a dropped iteration
 * fails the run: it means the stated arrival rate was not applied.
 *
 * @param {string} scenario - The scenario name.
 * @param {string[]} endpoints - Endpoint names from the catalogue.
 * @returns {Record<string, Array<string | { threshold: string, abortOnFail: boolean, delayAbortEval: string }>>} k6 thresholds.
 */
export const scenarioThresholds = (scenario, endpoints) => {
  const durations = Object.fromEntries(
    endpoints.map((endpoint) => [
      `http_req_duration{scenario:${scenario},endpoint:${endpoint}}`,
      withAbort(durationLimits(kindOf(endpoint)))
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
