import { MDM_INTEGRATION } from '../config/reference-data.js'
import { SECONDS_PER_MINUTE } from '../config/traffic.js'

/**
 * Reads how many calls the stub has answered for MDM, out of its
 * `/latency-profiles` answer.
 *
 * @param {{ integrations?: Array<{ integration: string, answered?: { count?: number } }> } | null | undefined} report - The parsed JSON.
 * @returns {number | null} The count; null when there is no integrations list, no `mdm` entry or no whole-number count.
 */
export const mdmAnsweredCount = (report) => {
  if (!Array.isArray(report?.integrations)) {
    return null
  }

  const count = report.integrations.find(
    ({ integration }) => integration === MDM_INTEGRATION
  )?.answered?.count

  return Number.isInteger(count) ? count : null
}

/**
 * Classes a reference-data read by whether MDM was called for it.
 *
 * @param {object} options - The two readings either side of the read.
 * @param {number | null} options.before - MDM's answered count before the read.
 * @param {number | null} options.after - MDM's answered count after the read.
 * @returns {'cold' | 'warm' | 'unclassified'} `cold` when the count rose, `unclassified` when either is unknown.
 */
export const cacheClassOf = ({ before, after }) => {
  if (before === null || after === null) {
    return 'unclassified'
  }

  return after > before ? 'cold' : 'warm'
}

/** The watch's state before the first read: no MDM count yet and no endpoint seen. */
export const INITIAL_WATCH_STATE = Object.freeze({
  previousCount: null,
  seen: Object.freeze([])
})

/**
 * Folds one read into the watch's state.
 *
 * @param {{ previousCount: number | null, seen: ReadonlyArray<string> }} state - The state so far.
 * @param {object} read - The read.
 * @param {string} read.endpoint - The endpoint read.
 * @param {number | null} read.count - MDM's answered count after the read.
 * @returns {{ state: { previousCount: number | null, seen: string[] }, isFirstRead: boolean }} The next state, and whether this was the endpoint's first read.
 */
export const nextWatchState = (state, { endpoint, count }) => {
  const isFirstRead = !state.seen.includes(endpoint)

  return {
    state: {
      previousCount: count,
      seen: isFirstRead ? [...state.seen, endpoint] : state.seen
    },
    isFirstRead
  }
}

/**
 * Works out how many times the MDM cache should expire during a watch.
 *
 * @param {object} options - The watch.
 * @param {number} options.watchSeconds - How long the watch runs.
 * @param {number} options.cacheMinutes - How long reference-data keeps an MDM answer.
 * @returns {number} Whole expiries.
 */
export const expectedExpiries = ({ watchSeconds, cacheMinutes }) =>
  Math.floor(watchSeconds / (cacheMinutes * SECONDS_PER_MINUTE))
