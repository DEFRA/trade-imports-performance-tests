import { check } from 'k6'
import { Counter, Gauge, Trend } from 'k6/metrics'

import { REFERENCE_DATA_READS } from '../config/reference-data.js'
import {
  INITIAL_WATCH_STATE,
  cacheClassOf,
  mdmAnsweredCount,
  nextWatchState
} from '../lib/reference-data.js'
import { READINESS_TAGS } from './readiness.js'
import { serviceHttp } from './service-http.js'

const HTTP_OK = 200
const WATCH_TAGS = { watch: 'reference-data' }
const COLD_FIRST_READ = 1
const WARM_FIRST_READ = 0

const referenceDataDuration = new Trend('reference_data_duration', true)
const firstRead = new Gauge('reference_data_first_read')
// Reads that did not answer 200; they are counted here and never timed.
const failedReads = new Counter('reference_data_failed_reads')

let watchState = INITIAL_WATCH_STATE

/**
 * Reads how many calls the trade-imports stub has answered for MDM.
 *
 * The request carries the readiness tags, so no threshold measures it. A stub
 * that does not answer 200, or cannot be reached, gives null.
 *
 * @param {object} options - Read settings.
 * @param {Record<string, string>} options.urls - The `tradeImportsStub` base URL.
 * @returns {number | null} The count; null when it could not be read.
 */
const readMdmCount = ({ urls }) => {
  try {
    const response = serviceHttp.get(
      `${urls.tradeImportsStub}/latency-profiles`,
      {
        tags: READINESS_TAGS
      }
    )

    return response.status === HTTP_OK
      ? mdmAnsweredCount(response.json())
      : null
  } catch {
    return null
  }
}

const recordFirstRead = ({ endpoint, cache }) => {
  if (cache !== 'unclassified') {
    firstRead.add(cache === 'cold' ? COLD_FIRST_READ : WARM_FIRST_READ, {
      endpoint
    })
  }
}

const readOnce = ({ urls, read }) => {
  const { endpoint, path } = read
  const response = serviceHttp.get(`${urls.referenceData}${path}`, {
    tags: { endpoint, kind: 'api', name: endpoint, ...WATCH_TAGS }
  })

  check(response, {
    'reference data answered': (answered) => answered.status === HTTP_OK
  })

  const count = readMdmCount({ urls })
  const cache = cacheClassOf({ before: watchState.previousCount, after: count })
  const next = nextWatchState(watchState, { endpoint, count })

  watchState = next.state

  if (response.status !== HTTP_OK) {
    failedReads.add(1, { endpoint })

    return
  }

  referenceDataDuration.add(response.timings.duration, { endpoint, cache })

  if (next.isFirstRead) {
    recordFirstRead({ endpoint, cache })
  }
}

/**
 * Reads reference-data directly, on the URLs the frontends use, and times each
 * answer as cold or warm.
 *
 * The frontends load their reference data once for the life of the process, so
 * journey traffic reaches reference-data only on a process's first use. This
 * watch stands in for that load. A read is cold when the stub's MDM answered
 * count rose across it (reference-data went to MDM), warm when it did not, and
 * unclassified when either count is unknown. Only reference-data calls MDM, and
 * the watch's reads are serial, so a rise across one read is that read's miss.
 * One virtual user runs this, so the module's state has one owner.
 *
 * @param {object} options - The watch.
 * @param {Record<string, string>} options.urls - The `referenceData` and `tradeImportsStub` base URLs.
 */
export const watchReferenceData = ({ urls }) => {
  if (watchState.previousCount === null) {
    watchState = { ...watchState, previousCount: readMdmCount({ urls }) }
  }

  REFERENCE_DATA_READS.forEach((read) => readOnce({ urls, read }))
}
