import { Gauge } from 'k6/metrics'

import { CALL_COUNTS_PATH, CALL_COUNT_JOURNEYS } from '../config/call-ratios.js'
import {
  callRatioLine,
  callRatios,
  notMeasuredLine,
  parseCallCounts,
  unreadableCountsLine
} from '../lib/call-ratios.js'
import { READINESS_TAGS } from './readiness.js'
import { serviceHttp } from './service-http.js'

const HTTP_OK = 200
const HTTP_NO_CONTENT = 204
const HTTP_NOT_FOUND = 404

const callCountsMeasuredGauge = new Gauge('call_counts_measured')
const callCountGauge = new Gauge('call_count')
const callCountExternalGauge = new Gauge('call_count_external')
const callRatioGauge = new Gauge('call_ratio')

const urlOf = (urls, { urlKey }) => `${urls[urlKey]}${CALL_COUNTS_PATH}`

/**
 * Forgets what every journey frontend has counted so far, so the run's figures
 * cover only the run. A frontend that does not expose the endpoint (404) has
 * nothing to clear. Any other answer is logged, never thrown: a diagnostic must
 * not stop a run. Every request carries the readiness tags, so no threshold
 * measures it.
 *
 * @param {object} options - Clear settings.
 * @param {Record<string, string>} options.urls - The journey frontends' base URLs, `animalsFrontend` and `plantsFrontend`.
 */
export const clearCallCounts = ({ urls }) => {
  for (const journey of Object.values(CALL_COUNT_JOURNEYS)) {
    const response = serviceHttp.del(urlOf(urls, journey), null, {
      tags: READINESS_TAGS
    })

    if (![HTTP_NO_CONTENT, HTTP_NOT_FOUND].includes(response.status)) {
      console.log(
        `Call counts: could not clear ${journey.service}: status ${response.status}`
      )
    }
  }
}

const recordCounts = (journey, counts) => {
  callCountsMeasuredGauge.add(1, { journey })
  callCountGauge.add(counts.pageRequests, { journey, measure: 'page-requests' })
  callCountGauge.add(counts.backendCalls, { journey, measure: 'backend-calls' })
  callCountGauge.add(counts.sessionResolutions, {
    journey,
    measure: 'session-resolutions'
  })

  for (const [dependency, operations] of Object.entries(counts.externalCalls)) {
    for (const [operation, calls] of Object.entries(operations)) {
      callCountExternalGauge.add(calls, { journey, dependency, operation })
    }
  }

  if (counts.pageRequests > 0) {
    const ratios = callRatios(counts)

    callRatioGauge.add(ratios.backendCallsPerPage, {
      journey,
      ratio: 'backend-calls-per-page'
    })
    callRatioGauge.add(ratios.sessionResolutionsPerPage, {
      journey,
      ratio: 'session-resolutions-per-page'
    })
  }
}

const reportJourney = (urls, journey, { service, urlKey }) => {
  const response = serviceHttp.get(urlOf(urls, { urlKey }), {
    tags: READINESS_TAGS
  })

  if (response.status !== HTTP_OK) {
    callCountsMeasuredGauge.add(0, { journey })
    console.log(notMeasuredLine({ journey, service, status: response.status }))

    return
  }

  const { counts, reason } = parseCallCounts(response)

  if (!counts) {
    callCountsMeasuredGauge.add(0, { journey })
    console.log(unreadableCountsLine({ journey, service, reason }))

    return
  }

  recordCounts(journey, counts)
  console.log(callRatioLine({ journey, service, counts }))
}

/**
 * Reads what every journey frontend counted, records it as gauges and logs each
 * journey's ratios against the derived D1, D2 and D3. A frontend that does not
 * answer 200 is recorded as not measured and logged with the reason, never
 * thrown. Every request carries the readiness tags, so no threshold measures it.
 *
 * @param {object} options - Report settings.
 * @param {Record<string, string>} options.urls - The journey frontends' base URLs, `animalsFrontend` and `plantsFrontend`.
 */
export const reportCallCounts = ({ urls }) => {
  for (const [journey, frontend] of Object.entries(CALL_COUNT_JOURNEYS)) {
    reportJourney(urls, journey, frontend)
  }
}
