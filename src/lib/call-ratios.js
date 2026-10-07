import {
  CALL_COUNT_JOURNEYS,
  DERIVED_CALL_RATIOS
} from '../config/call-ratios.js'
import { EXTERNAL_CALLS } from '../config/external-calls.js'
import { subMetricKey } from '../config/thresholds.js'
import { summaryMetricValue } from './external-calls.js'

const RATIO_DECIMALS = 2
const NO_BACKEND_RESOLUTIONS = 0
const NO_PERMISSION_CHECKS = 0

const roundedText = (value) => String(Number(value.toFixed(RATIO_DECIMALS)))

/**
 * Reads one frontend's totals from the body of its `/call-counts` endpoint.
 *
 * @param {{ totals: { pageRequests: number, backendCalls: number, sessionResolutions: number, externalCalls?: Record<string, Record<string, number>> } }} body - The endpoint's response.
 * @returns {{ pageRequests: number, backendCalls: number, sessionResolutions: number, externalCalls: Record<string, Record<string, number>> }} The totals.
 */
export const journeyCallCounts = ({ totals }) => ({
  pageRequests: totals.pageRequests,
  backendCalls: totals.backendCalls,
  sessionResolutions: totals.sessionResolutions,
  externalCalls: totals.externalCalls ?? {}
})

const COUNT_FIELDS = ['pageRequests', 'backendCalls', 'sessionResolutions']

const hasCounts = (totals) =>
  totals !== null &&
  typeof totals === 'object' &&
  COUNT_FIELDS.every((field) => Number.isFinite(totals[field]))

/**
 * Reads a 200 answer from a frontend's `/call-counts` endpoint without
 * throwing: a body that is not JSON, or has no totals, comes back as a reason.
 *
 * @param {{ json: () => unknown }} response - The endpoint's answer, whose `json()` throws on a body that is not JSON.
 * @returns {{ counts: ReturnType<typeof journeyCallCounts> } | { reason: string }} The counts, or why the body was not call counts.
 */
export const parseCallCounts = (response) => {
  try {
    const body = response.json()

    return hasCounts(body?.totals)
      ? { counts: journeyCallCounts(body) }
      : { reason: 'the body has no call count totals' }
  } catch (error) {
    return { reason: `the body was not JSON (${error.message})` }
  }
}

const derivedPerPage = ({ perPage, perBackendCall }, backendCallsPerPage) =>
  perPage + perBackendCall * backendCallsPerPage

const NO_RATIOS = Object.freeze({
  backendCallsPerPage: null,
  sessionResolutionsPerPage: null,
  frontendSessionResolutionsPerPage: null,
  backendSessionResolutionsPerPage: null,
  permissionChecksPerPage: null,
  derived: Object.freeze({
    backendCallsPerPage: null,
    sessionResolutionsPerPage: null,
    sessionResolutionsAtMeasuredD1: null,
    permissionChecksPerPage: null
  })
})

/**
 * Works out the call ratios a journey measured, beside the ones the
 * volumetrics page derives (D1, D2, D3).
 *
 * No journey backend resolves a session or checks a permission today (c-008),
 * so D2's backend share and all of D3 measure zero.
 *
 * @param {{ pageRequests: number, backendCalls: number, sessionResolutions: number }} counts - The journey's totals.
 * @returns {object} Every figure null when the journey carried no page requests.
 */
export const callRatios = ({
  pageRequests,
  backendCalls,
  sessionResolutions
}) => {
  if (!pageRequests) {
    return NO_RATIOS
  }

  const backendCallsPerPage = backendCalls / pageRequests
  const frontendSessionResolutionsPerPage = sessionResolutions / pageRequests

  return {
    backendCallsPerPage,
    sessionResolutionsPerPage:
      frontendSessionResolutionsPerPage + NO_BACKEND_RESOLUTIONS,
    frontendSessionResolutionsPerPage,
    backendSessionResolutionsPerPage: NO_BACKEND_RESOLUTIONS,
    permissionChecksPerPage: NO_PERMISSION_CHECKS,
    derived: {
      backendCallsPerPage: derivedPerPage(DERIVED_CALL_RATIOS.d1, 0),
      sessionResolutionsPerPage: derivedPerPage(
        DERIVED_CALL_RATIOS.d2,
        DERIVED_CALL_RATIOS.d1.perPage
      ),
      sessionResolutionsAtMeasuredD1: derivedPerPage(
        DERIVED_CALL_RATIOS.d2,
        backendCallsPerPage
      ),
      permissionChecksPerPage: derivedPerPage(
        DERIVED_CALL_RATIOS.d3,
        DERIVED_CALL_RATIOS.d1.perPage
      )
    }
  }
}

const measuredText = ({ journey, service, counts }) => {
  const ratios = callRatios(counts)
  const { derived } = ratios

  return [
    `Call ratio ${journey} (${service}, ${counts.pageRequests} page requests):`,
    `backend calls ${roundedText(ratios.backendCallsPerPage)} a page against ${derived.backendCallsPerPage} (${DERIVED_CALL_RATIOS.d1.label});`,
    `session resolutions ${roundedText(ratios.sessionResolutionsPerPage)} a page against ${derived.sessionResolutionsPerPage} (D2: ${DERIVED_CALL_RATIOS.d2.perPage} a page plus ${DERIVED_CALL_RATIOS.d2.perBackendCall} a backend call; ${roundedText(derived.sessionResolutionsAtMeasuredD1)} at the measured backend calls),`,
    `the frontend ${roundedText(ratios.frontendSessionResolutionsPerPage)} and the journey backend ${ratios.backendSessionResolutionsPerPage} (no backend resolves a session today, c-008);`,
    `permission checks ${ratios.permissionChecksPerPage} a page against ${derived.permissionChecksPerPage} (D3): no permission check exists today (c-008; open items 17, 28)`
  ].join(' ')
}

/**
 * Words a journey's measured call ratios as one line for the run log.
 *
 * @param {{ journey: string, service: string, counts: { pageRequests: number, backendCalls: number, sessionResolutions: number } }} options - The journey and its totals.
 * @returns {string} The line, or one saying the frontend carried no page requests.
 */
export const callRatioLine = ({ journey, service, counts }) =>
  counts.pageRequests
    ? measuredText({ journey, service, counts })
    : `Call ratio ${journey} (${service}): carried no page requests`

const HTTP_NOT_FOUND = 404

/**
 * Words why a journey's counts could not be read from its frontend.
 *
 * @param {{ journey: string, service: string, status: number }} options - The journey, its frontend and the status the endpoint answered.
 * @returns {string} The line.
 */
export const notMeasuredLine = ({ journey, service, status }) =>
  status === HTTP_NOT_FOUND
    ? `Call ratio ${journey}: not measured here: ${service} does not expose /call-counts. On the platform the external call report reads its BackendCalls and SessionResolutions from CloudWatch`
    : `Call ratio ${journey}: not measured here: could not read /call-counts: status ${status}`

/**
 * Words why a frontend answered 200 but its body was not call counts.
 *
 * @param {{ journey: string, service: string, reason: string }} options - The journey, its frontend and why the body was not call counts.
 * @returns {string} The line.
 */
export const unreadableCountsLine = ({ journey, service, reason }) =>
  `Call ratio ${journey}: could not read /call-counts from ${service}: ${reason}`

const countsKey = (journey, measure) =>
  subMetricKey('call_count', { journey, measure })

const defraIdOperationsOf = (service) =>
  EXTERNAL_CALLS.filter(
    (call) => call.service === service && call.dependency === 'defra-id'
  )

const externalCallsFromSummary = (summaryExport, journey, service) =>
  defraIdOperationsOf(service).reduce(
    (externalCalls, { dependency, operation }) => {
      const calls = summaryMetricValue(
        summaryExport,
        subMetricKey('call_count_external', { journey, dependency, operation })
      )

      return calls
        ? {
            ...externalCalls,
            [dependency]: { ...externalCalls[dependency], [operation]: calls }
          }
        : externalCalls
    },
    {}
  )

const countsFromSummary = (summaryExport, journey, service) => ({
  pageRequests: summaryMetricValue(
    summaryExport,
    countsKey(journey, 'page-requests')
  ),
  backendCalls: summaryMetricValue(
    summaryExport,
    countsKey(journey, 'backend-calls')
  ),
  sessionResolutions: summaryMetricValue(
    summaryExport,
    countsKey(journey, 'session-resolutions')
  ),
  externalCalls: externalCallsFromSummary(summaryExport, journey, service)
})

const isMeasuredIn = (summaryExport) => (journey) =>
  summaryMetricValue(
    summaryExport,
    subMetricKey('call_counts_measured', { journey })
  ) === 1

/**
 * Reads the call counts a run recorded as gauges in its own k6 summary export.
 *
 * @param {{ metrics?: Record<string, object> } | undefined} summaryExport - The parsed `--summary-export` file, or undefined when the run wrote none.
 * @returns {{ source: 'call-counts', journeys: Record<string, object> } | null} The counts of each journey that was measured, or null when none was.
 */
export const callCountsFromSummary = (summaryExport) => {
  const measured = Object.keys(CALL_COUNT_JOURNEYS).filter(
    isMeasuredIn(summaryExport)
  )

  return measured.length === 0
    ? null
    : {
        source: 'call-counts',
        journeys: Object.fromEntries(
          measured.map((journey) => [
            journey,
            countsFromSummary(
              summaryExport,
              journey,
              CALL_COUNT_JOURNEYS[journey].service
            )
          ])
        )
      }
}

const externalCallsFromRows = (externalCallRows, service) =>
  externalCallRows
    .filter((row) => row.service === service && row.calls > 0)
    .reduce(
      (externalCalls, { dependency, operation, calls }) => ({
        ...externalCalls,
        [dependency]: { ...externalCalls[dependency], [operation]: calls }
      }),
      {}
    )

/**
 * Builds the call counts from what the frontends published to CloudWatch: their
 * page request counts and the external call report's rows.
 *
 * @param {object} options - The CloudWatch figures.
 * @param {Record<string, { pageRequests: number, backendCalls: number, sessionResolutions: number } | null>} options.pageRequestCounts - Each journey's counts, null where its frontend published none.
 * @param {Array<{ service: string, dependency: string, operation: string, calls: number | null }>} options.externalCallRows - The external call report's rows.
 * @returns {{ source: 'cloudwatch', journeys: Record<string, object> } | null} The counts of each journey with data, or null when none has.
 */
export const callCountsFromCloudWatch = ({
  pageRequestCounts,
  externalCallRows
}) => {
  const journeys = Object.entries(CALL_COUNT_JOURNEYS)
    .filter(([journey]) => pageRequestCounts[journey])
    .map(([journey, { service }]) => [
      journey,
      {
        ...pageRequestCounts[journey],
        externalCalls: externalCallsFromRows(externalCallRows, service)
      }
    ])

  return journeys.length === 0
    ? null
    : { source: 'cloudwatch', journeys: Object.fromEntries(journeys) }
}

/**
 * Words each measured journey's call ratios as lines for the run log.
 *
 * @param {{ journeys: Record<string, object> } | null} callCounts - The counts, or null when none was measured.
 * @returns {string[]} One line for each journey, none when nothing was measured.
 */
export const callRatioLinesFor = (callCounts) =>
  Object.entries(callCounts?.journeys ?? {}).map(([journey, counts]) =>
    callRatioLine({
      journey,
      service: CALL_COUNT_JOURNEYS[journey].service,
      counts
    })
  )
