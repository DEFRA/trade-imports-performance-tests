import { Counter, Rate } from 'k6/metrics'

const HTTP_SERVER_ERROR = 500
const FAILED_BELOW_HTTP = 0

const serverErrors = new Rate('server_errors')
const transportErrors = new Counter('transport_errors')

/**
 * Records whether a response was a server error, a 5xx status.
 *
 * `http_req_failed` also counts 4xx, and k6 cannot judge a range of statuses in
 * a threshold, so the burst run's 5xx rule reads this rate.
 *
 * @param {{ status: number }} response - A k6 response.
 */
export const recordServerError = (response) => {
  serverErrors.add(response.status >= HTTP_SERVER_ERROR)
}

/**
 * Counts a response whose request failed below HTTP.
 *
 * k6 gives status 0 when a request is refused, reset or timed out, which is the
 * signature of a crashed service or one stuck behind an exhausted pool, so the
 * endurance run reads this count as its sign of exhaustion.
 *
 * @param {{ status: number }} response - A k6 response.
 * @param {Record<string, string>} [tags] - Tags to add to the count, such as the request's `endpoint`, so a report can tell whose requests failed.
 */
export const recordTransportError = (response, tags = {}) => {
  if (response.status === FAILED_BELOW_HTTP) {
    transportErrors.add(1, tags)
  }
}
