import {
  CONFORMANCE_OVERDUE_FLAG,
  NOT_REPORTED_PROFILE,
  SLA_PROFILE,
  UNAGREED_FLAG,
  ZERO_DELAY_PROFILE
} from '../config/stub-profiles.js'

const MS_PER_DAY = 86400000
const HTTP_NO_CONTENT = 204
const HTTP_NOT_FOUND = 404
const HTTP_METHOD_NOT_ALLOWED = 405
const NOT_REPORTED_TEXT = 'not reported'

const flagText = (flag) => flag.toUpperCase().replaceAll('-', ' ')

const targetsText = ({ targets }) =>
  `p50 ${targets.p50Ms}ms, p95 ${targets.p95Ms}ms, p99 ${targets.p99Ms}ms`

const isNotReported = (entry) => entry.profile === NOT_REPORTED_PROFILE

const isServiceBus = (entry) => entry.stub === null

const whereText = (entry) => `${entry.integration} (${entry.stub})`

const wholeDaysBefore = (lastConformed, runDate) =>
  Math.floor((runDate.getTime() - Date.parse(lastConformed)) / MS_PER_DAY)

const isConformanceOverdue = (entry, runDate, intervalDays) => {
  if (!entry.lastConformed) {
    return true
  }

  const daysAgo = wholeDaysBefore(entry.lastConformed, runDate)

  return !Number.isFinite(daysAgo) || daysAgo < 0 || daysAgo > intervalDays
}

/**
 * Adds the stub that answered to each integration its report lists.
 *
 * @param {{ integrations?: object[] }} report - The JSON a stub answered `/latency-profiles` with.
 * @param {string} stub - The stub service that answered.
 * @returns {object[]} The report's integrations, each with `stub` added.
 * @throws {Error} When the report has no integrations list.
 */
export const entriesFromReport = (report, stub) => {
  if (!Array.isArray(report?.integrations)) {
    throw new Error(
      `${stub} answered /latency-profiles without an integrations list`
    )
  }

  return report.integrations.map((integration) => ({ ...integration, stub }))
}

/**
 * Stands in for the integrations of a stub that predates latency profiles. Such
 * a stub adds no delay, but cannot say so, so every field it would report is
 * absent and the entry is flagged.
 *
 * @param {string} stub - The stub service that answered 404.
 * @param {Array<{ integration: string, stub: string | null }>} integrations - Every stubbed integration.
 * @returns {object[]} One not-reported entry for each integration hosted by this stub.
 */
export const notReportedEntries = (stub, integrations) =>
  integrations
    .filter((integration) => integration.stub === stub)
    .map(({ integration }) => ({
      integration,
      stub,
      interface: NOT_REPORTED_TEXT,
      owner: NOT_REPORTED_TEXT,
      serviceLevelSource: NOT_REPORTED_TEXT,
      agreed: false,
      lastConformed: null,
      profile: NOT_REPORTED_PROFILE,
      slaTargets: null,
      fitted: null,
      targets: { p50Ms: 0, p95Ms: 0, p99Ms: 0 },
      answered: null
    }))

/**
 * Works out which flags a profile carries.
 *
 * @param {{ agreed: boolean, lastConformed: string | null }} entry - The profile's entry.
 * @param {Date} runDate - When the run started.
 * @param {number} intervalDays - How many days a profile may go without being conformed.
 * @returns {string[]} `unagreed` when the profile is not agreed, then `conformance-overdue` when it was never conformed, its date is malformed or after the run, or it was last conformed more than `intervalDays` whole days before the run.
 */
export const flagsFor = (entry, runDate, intervalDays) => {
  const flags = []

  if (entry.agreed !== true) {
    flags.push(UNAGREED_FLAG)
  }

  if (isConformanceOverdue(entry, runDate, intervalDays)) {
    flags.push(CONFORMANCE_OVERDUE_FLAG)
  }

  return flags
}

/**
 * Says when a profile was last conformed to the real system.
 *
 * @param {{ lastConformed: string | null }} entry - The profile's entry.
 * @param {Date} runDate - When the run started.
 * @param {number} intervalDays - How many days a profile may go without being conformed.
 * @returns {string} `never conformed`, `last conformed <date>`, or that with `, overdue (every <n> days)`.
 */
export const conformanceText = (entry, runDate, intervalDays) => {
  if (!entry.lastConformed) {
    return 'never conformed'
  }

  const overdue = flagsFor(entry, runDate, intervalDays).includes(
    CONFORMANCE_OVERDUE_FLAG
  )

  return overdue
    ? `last conformed ${entry.lastConformed}, overdue (every ${intervalDays} days)`
    : `last conformed ${entry.lastConformed}`
}

const flagLabels = (entry, runDate, intervalDays) => [
  ...(isNotReported(entry) ? [NOT_REPORTED_PROFILE] : []),
  ...flagsFor(entry, runDate, intervalDays)
]

const metadataText = (entry, runDate, intervalDays) =>
  `${entry.interface}; owner ${entry.owner}; from ${entry.serviceLevelSource}; ${conformanceText(entry, runDate, intervalDays)}; flags: ${flagLabelsText(entry, runDate, intervalDays)}`

const flagLabelsText = (entry, runDate, intervalDays) => {
  const labels = flagLabels(entry, runDate, intervalDays)

  return labels.length === 0 ? 'none' : labels.map(flagText).join(', ')
}

/**
 * States the profile an integration ran with, what it represents and its flags.
 *
 * @param {object} entry - The integration's entry.
 * @param {Date} runDate - When the run started.
 * @param {number} intervalDays - How many days a profile may go without being conformed.
 * @returns {string} The line to log.
 */
export const profileLine = (entry, runDate, intervalDays) => {
  if (isNotReported(entry)) {
    return `Stub profile: ${whereText(entry)} runs ${ZERO_DELAY_PROFILE}: the stub does not report latency profiles, so it adds no delay; flags: ${flagLabelsText(entry, runDate, intervalDays)}`
  }

  const where = isServiceBus(entry)
    ? `${entry.integration} (not a stub service: ${entry.standIn})`
    : whereText(entry)
  const fit =
    entry.profile === SLA_PROFILE
      ? ` (lognormal fit p95 ${entry.fitted.p95Ms}ms, p99 ${entry.fitted.p99Ms}ms)`
      : ''

  return `Stub profile: ${where} runs ${entry.profile}, targets ${targetsText(entry)}${fit}; ${metadataText(entry, runDate, intervalDays)}`
}

/**
 * States the latency a stub answered with, beside its targets.
 *
 * @param {object} entry - The integration's entry, read at the end of the run.
 * @returns {string} The line to log.
 */
export const answeredLine = (entry) => {
  if (isServiceBus(entry)) {
    return `Stub latency answered: ${entry.integration} is not measured by a stub: ${entry.standIn}`
  }

  if (isNotReported(entry)) {
    return `Stub latency answered: ${whereText(entry)} not reported`
  }

  const { answered } = entry

  if (answered.count === 0) {
    return `Stub latency answered: ${whereText(entry)} no calls recorded, beside targets ${targetsText(entry)}`
  }

  return `Stub latency answered: ${whereText(entry)} p50 ${answered.p50Ms}ms, p95 ${answered.p95Ms}ms, p99 ${answered.p99Ms}ms over ${answered.count} calls, beside targets ${targetsText(entry)}`
}

/**
 * Names every integration that carries a flag.
 *
 * @param {object[]} entries - Every integration's entry.
 * @param {Date} runDate - When the run started.
 * @param {number} intervalDays - How many days a profile may go without being conformed.
 * @returns {string} The line to log.
 */
export const flaggedLine = (entries, runDate, intervalDays) => {
  const flagged = entries
    .map((entry) => ({
      entry,
      labels: flagLabels(entry, runDate, intervalDays)
    }))
    .filter(({ labels }) => labels.length > 0)
    .map(({ entry, labels }) => `${entry.integration} ${labels.join(', ')}`)

  return `Stub profiles flagged: ${flagged.length === 0 ? 'none' : flagged.join('; ')}`
}

/**
 * The profile an entry actually adds delay with. A stub that does not report
 * profiles predates them and adds none.
 *
 * @param {{ profile: string }} entry - The integration's entry.
 * @returns {string} `zero-delay` for a not-reported entry, otherwise its profile.
 */
export const effectiveProfile = (entry) =>
  isNotReported(entry) ? ZERO_DELAY_PROFILE : entry.profile

/**
 * Names every stub-hosted integration that runs another profile than the one a run requires.
 * Azure Service Bus is never checked, because nothing here can switch it.
 *
 * @param {object[]} entries - Every integration's entry.
 * @param {string | undefined} required - The required profile, or undefined when none is.
 * @returns {string | undefined} The message, or undefined when nothing is required or every integration matches.
 */
export const profileMismatchMessage = (entries, required) => {
  if (required === undefined) {
    return undefined
  }

  const mismatched = entries.filter(
    (entry) => !isServiceBus(entry) && effectiveProfile(entry) !== required
  )

  return mismatched.length === 0
    ? undefined
    : `Stub profiles do not match STUB_PROFILE=${required}: ${mismatched
        .map((entry) => `${entry.integration} runs ${effectiveProfile(entry)}`)
        .join(', ')}`
}

/**
 * Puts the entries in the order of the stubbed integrations.
 *
 * @param {object[]} entries - The entries the stubs reported, in any order.
 * @param {Array<{ integration: string, stub: string | null }>} integrations - Every stubbed integration, in report order.
 * @returns {object[]} One entry per integration, in the order of `integrations`.
 * @throws {Error} Naming the integration, and the stub that should host it, when no entry reports it.
 */
export const orderEntries = (entries, integrations) =>
  integrations.map(({ integration, stub }) => {
    const found = entries.find((entry) => entry.integration === integration)

    if (found === undefined) {
      throw new Error(
        `${stub ?? 'the stubs'} did not report a latency profile for ${integration}`
      )
    }

    return found
  })

/**
 * Decides whether a stub answered a request to clear its answered latencies.
 *
 * @param {string} stub - The stub service that answered.
 * @param {number} status - The HTTP status it answered with.
 * @returns {boolean} True when the stub cleared its answers, false when it predates profiles (404 or 405) and has none to clear.
 * @throws {Error} When the stub answered anything else.
 */
export const answeredClearedBy = (stub, status) => {
  if (status === HTTP_NO_CONTENT) {
    return true
  }

  if (status === HTTP_NOT_FOUND || status === HTTP_METHOD_NOT_ALLOWED) {
    return false
  }

  throw new Error(
    `Could not clear the answered latencies of ${stub}: status ${status}`
  )
}
