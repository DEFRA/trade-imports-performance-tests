export const ZERO_DELAY_PROFILE = 'zero-delay'
export const SLA_PROFILE = 'sla'
export const NOT_REPORTED_PROFILE = 'not-reported'
export const PROFILES = Object.freeze([
  ZERO_DELAY_PROFILE,
  SLA_PROFILE,
  NOT_REPORTED_PROFILE
])

export const UNAGREED_FLAG = 'unagreed'
export const CONFORMANCE_OVERDUE_FLAG = 'conformance-overdue'
export const FLAGS = Object.freeze([UNAGREED_FLAG, CONFORMANCE_OVERDUE_FLAG])
export const QUANTILES = Object.freeze(['p50', 'p95', 'p99'])

/**
 * How many days a profile may go without being conformed to the real system.
 * The volumetrics decision page says stub profiles are re-checked "weekly or
 * per release" (confluence:6608160092 Summary).
 */
export const CONFORMANCE_INTERVAL_DAYS = 7

/** Each stub service that reports latency profiles, and the `urls` key it is read from. */
export const STUB_SERVICES = Object.freeze({
  'trade-imports-stub': 'tradeImportsStub',
  'trade-imports-defra-id-stub': 'defraIdStub'
})

/**
 * Every system outside the boundary that an INS service calls today, and the
 * stub that hosts its latency profile. SNS, SQS and cdp-uploader stay real, so
 * none is listed. Azure Service Bus has no stub service of its own, so its
 * `stub` is null.
 */
export const STUBBED_INTEGRATIONS = Object.freeze([
  Object.freeze({
    integration: 'defra-id',
    stub: 'trade-imports-defra-id-stub'
  }),
  Object.freeze({ integration: 'trade-token', stub: 'trade-imports-stub' }),
  Object.freeze({ integration: 'mdm', stub: 'trade-imports-stub' }),
  Object.freeze({ integration: 'azure-service-bus', stub: null })
])

/**
 * The Azure Service Bus entry, in the shape the stubs report. Nothing in a stub
 * service can switch it, so it is declared here: zero added delay, unagreed and
 * never conformed.
 */
export const SERVICE_BUS_ENTRY = Object.freeze({
  integration: 'azure-service-bus',
  stub: null,
  interface: 'Azure Service Bus, the only route to Dynamics and PIMS',
  owner: 'TBC: no §9.5 row',
  serviceLevelSource:
    'None: §9.5 gives no Service Bus figure, so zero added delay until one is agreed',
  agreed: false,
  lastConformed: null,
  profile: ZERO_DELAY_PROFILE,
  slaTargets: null,
  fitted: null,
  targets: Object.freeze({ p50Ms: 0, p95Ms: 0, p99Ms: 0 }),
  answered: null,
  standIn:
    "locally the workspace stack's toxiproxy in front of the Service Bus emulator; in CDP, CDP configuration"
})

/**
 * Reads the stub profile a run requires.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @returns {string | undefined} `zero-delay` or `sla`, or undefined when `STUB_PROFILE` is blank or unset.
 * @throws {Error} When `STUB_PROFILE` is anything else.
 */
export const resolveRequiredStubProfile = (env) => {
  const value = env.STUB_PROFILE?.trim()

  if (!value) {
    return undefined
  }

  if (value !== ZERO_DELAY_PROFILE && value !== SLA_PROFILE) {
    throw new Error('STUB_PROFILE must be zero-delay or sla, or unset.')
  }

  return value
}
