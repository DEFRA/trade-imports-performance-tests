import { kindOf } from './endpoints.js'

// Interim targets until INS sets its own: c-004 default, DR-EUDP-005 section 4.7.
export const INTERIM_TARGETS = Object.freeze({
  page: Object.freeze({ p95Ms: 2000, p99Ms: 5000 }),
  api: Object.freeze({ p95Ms: 200, p99Ms: 1200 }),
  maxFailureRate: 0.01,
  minCheckPassRate: 0.99
})

const MAX_DROPPED_ITERATIONS = 1

const ABORT = Object.freeze({ abortOnFail: true, delayAbortEval: '30s' })

const withAbort = (limits) =>
  limits.map((threshold) => ({ threshold, ...ABORT }))

const durationLimits = (kind) => {
  const { p95Ms, p99Ms } = INTERIM_TARGETS[kind]

  return [`p(95)<${p95Ms}`, `p(99)<${p99Ms}`]
}

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

  return {
    ...durations,
    [`http_req_failed{scenario:${scenario}}`]: withAbort([
      `rate<${INTERIM_TARGETS.maxFailureRate}`
    ]),
    [`checks{scenario:${scenario}}`]: withAbort([
      `rate>${INTERIM_TARGETS.minCheckPassRate}`
    ]),
    [`dropped_iterations{scenario:${scenario}}`]: [
      `count<${MAX_DROPPED_ITERATIONS}`
    ]
  }
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
