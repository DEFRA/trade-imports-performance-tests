import http from 'k6/http'
import { Gauge } from 'k6/metrics'

import { deadLetterGrowth, deadLetterLine } from '../lib/dead-letters.js'
import { READINESS_TAGS } from './readiness.js'

const HTTP_OK = 200
const SERVICE_BUS = 'service-bus'

const deadLettersGauge = new Gauge('downstream_dead_letters')

/**
 * Reads how many messages the gateway's dead-letter queue holds.
 *
 * The request carries the readiness tags, so no threshold measures it. A
 * gateway that does not answer 200, or cannot be reached, gives null.
 *
 * @param {object} options - Read settings.
 * @param {Record<string, string>} options.urls - The `gateway` base URL.
 * @returns {number | null} The queue's approximate depth, or null when it could not be read.
 */
export const readDeadLetterCount = ({ urls }) => {
  try {
    const response = http.get(`${urls.gateway}/dlq/notifications?limit=1`, {
      tags: READINESS_TAGS
    })

    return response.status === HTTP_OK
      ? (response.json('approximate_count') ?? null)
      : null
  } catch {
    return null
  }
}

/**
 * Logs what the dead-letter queue held at each end of the run and, when both
 * were read, records its growth for the cascade threshold.
 *
 * @param {object} options - The two readings.
 * @param {number | null} options.before - The depth at the start, or null.
 * @param {number | null} options.after - The depth at the end, or null.
 */
export const reportDeadLetters = ({ before, after }) => {
  console.log(deadLetterLine({ before, after }))

  const growth = deadLetterGrowth({ before, after })

  if (growth !== null) {
    deadLettersGauge.add(growth, { downstream: SERVICE_BUS })
  }
}
