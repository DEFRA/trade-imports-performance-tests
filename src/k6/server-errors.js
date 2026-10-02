import { Rate } from 'k6/metrics'

const HTTP_SERVER_ERROR = 500

const serverErrors = new Rate('server_errors')

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
