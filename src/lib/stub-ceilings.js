import {
  DEFRA_ID_PROFILED_CALLS_PER_SIGN_IN,
  FRONT_DOOR_SPIKE_PER_SECOND,
  HEADROOM_FACTOR,
  LATENCY_ALLOWANCE_MS,
  SIGN_IN_TARGETS,
  SPIKE_SECONDS,
  requiredSignInsPerSecond
} from '../config/stub-ceilings.js'
import { SLA_PROFILE, STUBBED_INTEGRATIONS } from '../config/stub-profiles.js'
import { INTERIM_TARGETS } from '../config/thresholds.js'
import { absoluteLocation } from './redirects.js'
import { effectiveProfile } from './stub-profiles.js'

const DEFRA_ID = 'defra-id'
const HTTP_OK = 200
const HTTP_REDIRECT = 302
const PERCENT = 100
const MS_PER_SECOND = 1000
const MEAN_DECIMALS = 2
const FIGURE_DECIMALS = 2
const TRUST_NOT_JUDGED =
  "Run trust: not judged: this run measures the stubs' own ceilings"

const percentText = (rate) => `${(rate * PERCENT).toFixed(2)}%`

const figureText = (value) => String(Number(value.toFixed(FIGURE_DECIMALS)))

const unitFor = (integration) =>
  integration === DEFRA_ID ? 'sign-ins a second' : 'requests a second'

const stubOf = (integration) =>
  STUBBED_INTEGRATIONS.find((entry) => entry.integration === integration)?.stub

const iterationsText = (count) =>
  `${count} ${count === 1 ? 'iteration' : 'iterations'}`

/**
 * Reads the `code` query parameter from a redirect's `Location`.
 *
 * @param {string | undefined} location - The `Location` header value.
 * @returns {string} The code, or an empty string when there is none.
 */
export const codeFromLocation = (location) => {
  const query = (location ?? '').split('#')[0].split('?')[1] ?? ''
  const pair = query
    .split('&')
    .map((part) => part.split('='))
    .find(([name]) => name === 'code')

  return pair?.[1] === undefined ? '' : decodeURIComponent(pair[1])
}

/**
 * Turns a redirect `Location` into an absolute URL, or null when the response sent none.
 *
 * @param {string} fromUrl - The URL that answered with the redirect.
 * @param {string | undefined} location - The `Location` header value.
 * @returns {string | null} An absolute URL, or null when there is no `Location`.
 */
export const absoluteLocationOrNull = (fromUrl, location) =>
  location ? absoluteLocation(fromUrl, location) : null

/**
 * Tells whether a Defra ID sign-in went all the way through.
 *
 * @param {object} options - What the sign-in saw.
 * @param {boolean} options.statusesAsExpected - True when every step up to the code answered as expected.
 * @param {number} options.keysStatus - The status of the keys request.
 * @param {string} options.accessToken - The access token, or an empty string when there was none.
 * @param {boolean} options.signOut - Whether the sign-in ends the session afterwards.
 * @param {number | null} options.signOutStatus - The status of the sign-out request, null when none was sent.
 * @returns {boolean} True when the steps, the keys and the token are right and, with `signOut`, the sign-out redirected.
 */
export const signInCompleted = ({
  statusesAsExpected,
  keysStatus,
  accessToken,
  signOut,
  signOutStatus
}) =>
  statusesAsExpected &&
  keysStatus === HTTP_OK &&
  accessToken !== '' &&
  (!signOut || signOutStatus === HTTP_REDIRECT)

const valueOf = (metrics, key, stat) => metrics[key]?.values?.[stat]

const failureReason = ({
  failedRate,
  checksRate,
  dropped,
  p95Ms,
  latencyLimitMs
}) => {
  if (failedRate >= INTERIM_TARGETS.maxFailureRate) {
    return `failed ${percentText(failedRate)} of requests`
  }

  if (checksRate !== null && checksRate <= INTERIM_TARGETS.minCheckPassRate) {
    return `checks passed ${percentText(checksRate)}`
  }

  if (dropped >= 1) {
    return `dropped ${iterationsText(dropped)}`
  }

  return p95Ms > latencyLimitMs
    ? `p95 ${Math.round(p95Ms)}ms over the ${Math.round(latencyLimitMs)}ms limit`
    : undefined
}

/**
 * Judges one step of a ladder from k6's own measurements.
 *
 * A step holds when failed requests are under 1%, checks pass over 99%, no
 * iteration was dropped and the p95 of its profiled requests is within the
 * limit. A step with no completed request breaks.
 *
 * @param {object} options - The step to judge.
 * @param {Record<string, { values: Record<string, number> }>} options.metrics - k6's summary metrics.
 * @param {string} options.scenario - The step's scenario name.
 * @param {number} options.latencyLimitMs - The p95 limit, in milliseconds.
 * @returns {{ held: boolean, failedRate: number | null, checksRate: number | null, dropped: number, p95Ms: number | null, reason: string }} The verdict.
 */
export const stepVerdict = ({ metrics, scenario, latencyLimitMs }) => {
  const failedRate =
    valueOf(metrics, `http_req_failed{scenario:${scenario}}`, 'rate') ?? null
  const checksRate =
    valueOf(metrics, `checks{scenario:${scenario}}`, 'rate') ?? null
  const dropped =
    valueOf(metrics, `dropped_iterations{scenario:${scenario}}`, 'count') ?? 0
  const p95Ms =
    valueOf(
      metrics,
      `http_req_duration{scenario:${scenario},profiled:yes}`,
      'p(95)'
    ) ?? null
  const base = { failedRate, checksRate, dropped, p95Ms }

  if (failedRate === null || p95Ms === null) {
    return { ...base, held: false, reason: 'no requests completed' }
  }

  const reason = failureReason({ ...base, latencyLimitMs })

  return reason === undefined
    ? { ...base, held: true, reason: 'held' }
    : { ...base, held: false, reason }
}

/**
 * The p95 a step's profiled requests may take.
 *
 * @param {{ profile: string, fittedP95Ms: number }} options - The profile the stub ran and its fitted p95.
 * @returns {number} The fitted p95 for `sla`, otherwise 0, plus the latency allowance.
 */
export const latencyLimitMs = ({ profile, fittedP95Ms }) =>
  (profile === SLA_PROFILE ? fittedP95Ms : 0) + LATENCY_ALLOWANCE_MS

/**
 * Finds the ceiling of a ladder: the rate of the last step that held before
 * the first that broke.
 *
 * @param {Array<{ rate: number, verdict: { held: boolean, reason: string } }>} steps - The steps, in ladder order.
 * @returns {{ rps: number, atLeast: boolean, brokeAt: number | null, brokeBecause: string | null }} The ceiling in the ladder's own unit. `atLeast` is true when every step held, and `rps` is then the top step.
 */
export const ceilingFrom = (steps) => {
  const brokenIndex = steps.findIndex(({ verdict }) => !verdict.held)

  if (brokenIndex === -1) {
    return {
      rps: steps.at(-1).rate,
      atLeast: true,
      brokeAt: null,
      brokeBecause: null
    }
  }

  const broken = steps[brokenIndex]

  return {
    rps: brokenIndex === 0 ? 0 : steps[brokenIndex - 1].rate,
    atLeast: false,
    brokeAt: broken.rate,
    brokeBecause: broken.verdict.reason
  }
}

/**
 * Converts a ladder rate to requests a second at the stub's profiled endpoints.
 *
 * @param {string} integration - The integration the ladder measures.
 * @param {number} rate - The rate in the ladder's own unit.
 * @returns {number} Requests a second: the rate times 3 for `defra-id`, whose ladder counts sign-ins, otherwise the rate.
 */
export const ceilingRpsFor = (integration, rate) =>
  integration === DEFRA_ID ? rate * DEFRA_ID_PROFILED_CALLS_PER_SIGN_IN : rate

/**
 * States how one ladder step went.
 *
 * @param {object} options - The step.
 * @param {string} options.integration - The integration.
 * @param {number} options.rate - The step's rate.
 * @param {{ held: boolean, failedRate: number | null, checksRate: number | null, p95Ms: number | null, dropped: number, reason: string }} options.verdict - The step's verdict.
 * @returns {string} The line to log.
 */
export const stepLine = ({ integration, rate, verdict }) => {
  const { held, failedRate, checksRate, p95Ms, dropped, reason } = verdict
  const figures =
    failedRate === null
      ? reason
      : `${held ? 'held' : `broke: ${reason}`} (failed ${percentText(failedRate)}, checks ${checksRate === null ? 'none' : percentText(checksRate)}, p95 ${Math.round(p95Ms)}ms, dropped ${dropped})`

  return `Stub ceiling step: ${integration} ${rate} ${unitFor(integration)}: ${figures}`
}

const ceilingTail = ({ brokeAt, brokeBecause, atLeast, rps, integration }) => {
  const requests = ceilingRpsFor(integration, rps)
  const signIns = integration === DEFRA_ID ? ` (${rps} sign-ins a second)` : ''

  if (atLeast) {
    return `at least ${requests} requests a second${signIns}: every step held, so raise the ladder`
  }

  if (rps === 0) {
    return `below ${ceilingRpsFor(integration, brokeAt)} requests a second: the first step broke: ${brokeBecause}`
  }

  return `${requests} requests a second${signIns}; broke at ${brokeAt}: ${brokeBecause}`
}

/**
 * States the ceiling a ladder found for one integration.
 *
 * @param {object} options - The ceiling.
 * @param {string} options.integration - The integration.
 * @param {string} options.stub - The stub service that hosts it.
 * @param {string} options.profile - The profile the stub ran.
 * @param {string} options.environment - The environment the run was in.
 * @param {{ rps: number, atLeast: boolean, brokeAt: number | null, brokeBecause: string | null }} options.ceiling - The ceiling, in the ladder's own unit.
 * @returns {string} The line to log.
 */
export const ceilingLine = ({
  integration,
  stub,
  profile,
  environment,
  ceiling
}) =>
  `Stub ceiling: ${integration} (${stub}, ${profile}, ${environment}) ${ceilingTail({ ...ceiling, integration })}`

/**
 * Prints the measured ceilings in the shape `RECORDED_CEILINGS` holds them.
 *
 * @param {object} options - The measurement.
 * @param {Record<string, { profile: string, rps: number, atLeast: boolean }>} options.ceilings - Each integration's ceiling in the ladder's own unit, with the profile it ran.
 * @param {string} options.measured - The run date, `YYYY-MM-DD`.
 * @param {string} options.environment - The environment the run was in.
 * @param {string[]} options.groups - The groups that ran.
 * @returns {string} A line with the entries ready to paste, in requests a second, each with a source naming the run.
 */
export const ceilingsRecordedLine = ({
  ceilings,
  measured,
  environment,
  groups
}) =>
  `Stub ceilings recorded: ${JSON.stringify(
    Object.fromEntries(
      Object.entries(ceilings).map(
        ([integration, { profile, rps, atLeast }]) => [
          integration,
          {
            [profile]: {
              rps: ceilingRpsFor(integration, rps),
              atLeast,
              measured,
              source: `breakpoint-stubs run in ${environment}, groups ${groups.join(', ')}`
            }
          }
        ]
      )
    )
  )}`

/**
 * Compares the Defra ID stub's sign-in ceiling with the sign-ins a second it must carry.
 *
 * @param {number} signInsPerSecond - The ceiling, in sign-ins a second.
 * @param {boolean} atLeast - True when every step held, so the figure is only a floor.
 * @returns {string} The line to log.
 */
export const signInCeilingLine = (signInsPerSecond, atLeast) => {
  const needed = requiredSignInsPerSecond(SIGN_IN_TARGETS.twoJourneys)
  const neededWithIuu = requiredSignInsPerSecond(SIGN_IN_TARGETS.withIuu)
  const ceilingText = `${atLeast ? 'at least ' : ''}${figureText(signInsPerSecond)} sign-ins a second`
  const neededText = figureText(needed)
  const neededWithIuuText = figureText(neededWithIuu)

  if (signInsPerSecond < needed) {
    return `Defra ID ceiling ${ceilingText}, short of the ${neededText} needed (two journeys): change the session store (c-010)`
  }

  if (signInsPerSecond < neededWithIuu) {
    return `Defra ID ceiling ${ceilingText}: headroom for two journeys, short of the ${neededWithIuuText} with IUU (reported, not gated)`
  }

  return `Defra ID ceiling ${ceilingText} against ${neededText} needed (two journeys) and ${neededWithIuuText} (with IUU): headroom for both`
}

/**
 * States whether the Defra ID stub carried a sign-in target with the front-door spike on top.
 *
 * @param {object} options - The target.
 * @param {string} options.label - `two journeys` or `with IUU`.
 * @param {number} options.perHour - Sign-ins an hour carried.
 * @param {{ held: boolean, failedRate: number | null, checksRate: number | null, p95Ms: number | null, dropped: number, reason: string }} options.verdict - The target's verdict.
 * @returns {string} The line to log.
 */
export const signInTargetLine = ({ label, perHour, verdict }) => {
  const { held, failedRate, checksRate, p95Ms, dropped, reason } = verdict
  const outcome = held ? 'carried' : `did not carry (${reason})`
  const figures =
    failedRate === null
      ? 'no requests completed'
      : `failed ${percentText(failedRate)}, checks ${checksRate === null ? 'none' : percentText(checksRate)}, p95 ${Math.round(p95Ms)}ms, dropped ${dropped}`

  return `Defra ID sign-in target (${label}): ${outcome} ${perHour} sign-ins an hour plus a ${FRONT_DOOR_SPIKE_PER_SECOND} a second spike for ${SPIKE_SECONDS} seconds, ${figures}`
}

/**
 * Lists every threshold k6 evaluated, with its result.
 *
 * @param {Record<string, { thresholds?: Record<string, { ok: boolean }> }>} metrics - k6's summary metrics.
 * @returns {string[]} One line per threshold, in metric order.
 */
export const thresholdLines = (metrics) =>
  Object.entries(metrics).flatMap(([metric, { thresholds }]) =>
    Object.entries(thresholds ?? {}).map(
      ([expression, { ok }]) =>
        `Threshold ${metric} ${expression}: ${ok ? 'passed' : 'FAILED'}`
    )
  )

const profileOf = (setupData, integration) =>
  setupData?.profiles?.[integration] ?? { profile: SLA_PROFILE, fittedP95Ms: 0 }

const judgedSteps = ({ metrics, setupData, integration, steps }) =>
  steps.map(({ scenario, rate }) => ({
    rate,
    verdict: stepVerdict({
      metrics,
      scenario,
      latencyLimitMs: latencyLimitMs(profileOf(setupData, integration))
    })
  }))

const ladderResults = ({ metrics, setupData, ladders }) =>
  Object.entries(ladders).map(([integration, steps]) => {
    const judged = judgedSteps({ metrics, setupData, integration, steps })

    return { integration, judged, ceiling: ceilingFrom(judged) }
  })

const signInTargetLines = (metrics) =>
  [
    [
      'defra-id-target-two-journeys',
      'two journeys',
      SIGN_IN_TARGETS.twoJourneys
    ],
    ['defra-id-target-with-iuu', 'with IUU', SIGN_IN_TARGETS.withIuu]
  ].map(([scenario, label, target]) =>
    signInTargetLine({
      label,
      perHour: target.steadyStateSessions,
      verdict: stepVerdict({
        metrics,
        scenario,
        latencyLimitMs: Number.POSITIVE_INFINITY
      })
    })
  )

const ladderLines = ({ results, setupData, environment }) =>
  results.flatMap(({ integration, judged, ceiling }) => [
    ...judged.map(({ rate, verdict }) =>
      stepLine({ integration, rate, verdict })
    ),
    ceilingLine({
      integration,
      stub: stubOf(integration),
      profile: profileOf(setupData, integration).profile,
      environment,
      ceiling
    }),
    ...(integration === DEFRA_ID
      ? [signInCeilingLine(ceiling.rps, ceiling.atLeast)]
      : [])
  ])

/**
 * Writes the whole end-of-run text of the stub-ceiling suite.
 *
 * @param {object} options - The run.
 * @param {Record<string, object>} options.metrics - k6's summary metrics.
 * @param {{ profiles?: Record<string, { profile: string, fittedP95Ms: number }> } | undefined} options.setupData - What `setup()` returned.
 * @param {Record<string, Array<{ scenario: string, rate: number }>>} options.ladders - The ladders that ran.
 * @param {string[]} options.groups - The groups that ran.
 * @param {string} options.environment - The environment the run was in.
 * @param {string} options.measured - The run date, `YYYY-MM-DD`.
 * @returns {string} Lines joined with newlines, ending in one.
 */
export const ceilingSummaryText = ({
  metrics,
  setupData,
  ladders,
  groups,
  environment,
  measured
}) => {
  const results = ladderResults({ metrics, setupData, ladders })
  const profiles = Object.entries(setupData?.profiles ?? {})
    .map(([integration, { profile }]) => `${integration} ${profile}`)
    .join(', ')

  return `${[
    `Stub ceiling run in ${environment}, groups ${groups.join(', ')}; stub profiles: ${profiles}`,
    ...ladderLines({ results, setupData, environment }),
    ...(groups.includes('defra-id-target') ? signInTargetLines(metrics) : []),
    ceilingsRecordedLine({
      ceilings: Object.fromEntries(
        results.map(({ integration, ceiling }) => [
          integration,
          { ...ceiling, profile: profileOf(setupData, integration).profile }
        ])
      ),
      measured,
      environment,
      groups
    }),
    TRUST_NOT_JUDGED,
    ...thresholdLines(metrics)
  ].join('\n')}\n`
}

/**
 * Works out the load an integration carried in a run.
 *
 * @param {{ answered: { count: number, peakPerSecond?: number } | null }} entry - The integration's entry, read at the end of the run.
 * @param {number} sinceMs - When the stub was cleared, in epoch milliseconds.
 * @param {number} nowMs - When the entry was read, in epoch milliseconds.
 * @returns {{ peakPerSecond: number | null, meanPerSecond: number }} The busiest second the stub reported (null when it does not report one) and the mean a second since the clear, to two places.
 */
export const loadOf = (entry, sinceMs, nowMs) => {
  const count = entry.answered?.count ?? 0
  const seconds = (nowMs - sinceMs) / MS_PER_SECOND
  const peak = entry.answered?.peakPerSecond

  return {
    peakPerSecond: typeof peak === 'number' ? peak : null,
    meanPerSecond:
      seconds > 0 ? Number((count / seconds).toFixed(MEAN_DECIMALS)) : 0
  }
}

const verdictOf = (verdict, reason = verdict) => ({
  judged: true,
  verdict,
  reason
})

const notJudged = (reason) => ({ judged: false, verdict: 'not judged', reason })

/**
 * Decides whether a stub had headroom over the load an integration put on it.
 *
 * The busiest second the stub carried must be at most half its measured
 * ceiling. A stub that cannot say what it carried, or has no ceiling to be
 * judged against, is not trusted.
 *
 * @param {object} options - The integration.
 * @param {object} options.entry - The integration's entry, read at the end of the run.
 * @param {{ rps: number, atLeast: boolean } | undefined} options.ceiling - The ceiling for this environment and profile, if one is recorded.
 * @param {{ peakPerSecond: number | null }} options.load - The load it carried.
 * @returns {{ judged: boolean, verdict: string, reason: string }} `headroom`, `no headroom`, `no ceiling measured` or `load not reported`, or not judged for Azure Service Bus and an integration that carried nothing.
 */
export const headroomVerdict = ({ entry, ceiling, load }) => {
  if (entry.stub === null) {
    return notJudged('not a stub service')
  }

  if (entry.answered === null || entry.answered === undefined) {
    return verdictOf('load not reported')
  }

  if (entry.answered.count === 0) {
    return notJudged('carried no load')
  }

  if (load.peakPerSecond === null) {
    return verdictOf('load not reported')
  }

  if (ceiling === undefined) {
    return verdictOf('no ceiling measured')
  }

  return load.peakPerSecond * HEADROOM_FACTOR <= ceiling.rps
    ? verdictOf('headroom')
    : verdictOf('no headroom')
}

const loadedIntegrations = ({ entries, loads }) =>
  entries.filter(
    (entry) =>
      entry.stub !== null &&
      (entry.answered?.count ?? 0) > 0 &&
      typeof loads[entry.integration]?.peakPerSecond === 'number'
  )

const distortionFor = ({ entry, siblings, ceilings, loads }) => {
  const ceiling = ceilings[entry.integration]
  const own = loads[entry.integration].peakPerSecond
  const others = siblings.filter(
    ({ integration }) => integration !== entry.integration
  )
  const combinedPeak = siblings.reduce(
    (total, { integration }) => total + loads[integration].peakPerSecond,
    0
  )
  const hasOwnHeadroom =
    ceiling !== undefined && own * HEADROOM_FACTOR <= ceiling.rps

  return hasOwnHeadroom &&
    others.length > 0 &&
    combinedPeak * HEADROOM_FACTOR > ceiling.rps
    ? [
        {
          stub: entry.stub,
          integration: entry.integration,
          combinedPeak,
          ceilingRps: ceiling.rps,
          others: others.map(({ integration }) => integration)
        }
      ]
    : []
}

/**
 * Finds the integrations a shared stub's other integrations would distort.
 *
 * For a stub that hosts more than one integration, an integration that has
 * headroom on its own but not against the combined peak of everything the stub
 * carried is named: its results are distorted by the stub's ceiling.
 *
 * @param {object} options - The run.
 * @param {object[]} options.entries - Every integration's entry, read at the end of the run.
 * @param {Record<string, { rps: number } | undefined>} options.ceilings - Each integration's ceiling for this environment and profile.
 * @param {Record<string, { peakPerSecond: number | null }>} options.loads - Each integration's load.
 * @returns {Array<{ stub: string, integration: string, combinedPeak: number, ceilingRps: number, others: string[] }>} One per distorted integration.
 */
export const sharedStubDistortions = ({ entries, ceilings, loads }) => {
  const loaded = loadedIntegrations({ entries, loads })

  return loaded.flatMap((entry) =>
    distortionFor({
      entry,
      siblings: loaded.filter(({ stub }) => stub === entry.stub),
      ceilings,
      loads
    })
  )
}

const peakText = (load) =>
  `peak ${load.peakPerSecond} a second, mean ${load.meanPerSecond.toFixed(2)} a second`

/**
 * States the headroom verdict for one integration.
 *
 * @param {object} options - The integration.
 * @param {object} options.entry - The integration's entry, read at the end of the run.
 * @param {{ rps: number, atLeast: boolean, measured: string } | undefined} options.ceiling - The ceiling for this environment and profile, if one is recorded.
 * @param {{ peakPerSecond: number | null, meanPerSecond: number }} options.load - The load it carried.
 * @param {string} options.environment - The environment the run was in.
 * @param {{ judged: boolean, verdict: string }} options.result - The verdict.
 * @returns {string} The line to log.
 */
export const headroomLine = ({ entry, ceiling, load, environment, result }) => {
  const where = `${entry.integration} (${entry.stub})`

  if (entry.stub === null) {
    return `Stub headroom: ${entry.integration} is not a stub service: not judged`
  }

  if (result.verdict === 'load not reported') {
    return `Stub headroom: ${where} carried load not reported: the stub does not report it`
  }

  if (!result.judged) {
    return `Stub headroom: ${where} carried no load`
  }

  const profile = effectiveProfile(entry)

  if (ceiling === undefined) {
    return `Stub headroom: ${where} ${peakText(load)}, no ceiling measured for ${profile} in ${environment}`
  }

  const floor = ceiling.atLeast ? 'at least ' : ''

  return `Stub headroom: ${where} ${peakText(load)}, against a ceiling of ${floor}${ceiling.rps} a second (${profile}, ${environment}, measured ${ceiling.measured}): ${result.verdict}`
}

const joinNames = (names) =>
  names.length < 2
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/**
 * Names an integration whose results a shared stub's ceiling would distort.
 *
 * @param {{ stub: string, integration: string, combinedPeak: number, ceilingRps: number, others: string[] }} distortion - The distortion.
 * @returns {string} The line to log.
 */
export const distortionLine = ({
  stub,
  integration,
  combinedPeak,
  ceilingRps,
  others
}) =>
  `Shared stub: ${stub} carried a combined peak of ${combinedPeak} a second across ${joinNames([integration, ...others])}, more than half ${integration}'s ceiling of ${ceilingRps}: ${integration}'s results are distorted, which is evidence for splitting ${integration} into its own stub service`

const REASON_TEXT = Object.freeze({
  'load not reported': 'carried load not reported'
})

const untrustedReasons = (verdicts, distortions) => [
  ...verdicts
    .filter(({ judged, verdict }) => judged && verdict !== 'headroom')
    .map(
      ({ integration, verdict }) =>
        `${integration} ${REASON_TEXT[verdict] ?? verdict}`
    ),
  ...distortions.map(
    ({ integration }) => `${integration} shared-stub distortion`
  )
]

/**
 * States whether the run can be trusted: every stub it went through had headroom.
 *
 * @param {Array<{ integration: string, judged: boolean, verdict: string }>} verdicts - Each integration's verdict.
 * @param {Array<{ integration: string }>} distortions - The shared-stub distortions.
 * @returns {string} The line to log.
 */
export const trustLine = (verdicts, distortions) => {
  const reasons = untrustedReasons(verdicts, distortions)

  return reasons.length === 0
    ? 'Run trust: trusted: every stub the run went through had headroom'
    : `Run trust: untrusted: ${reasons.join('; ')}`
}
