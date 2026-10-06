import { Counter, Rate, Trend } from 'k6/metrics'

import { TRAFFIC_CLASSES, isDashboardRead } from '../config/request-mix.js'
import { thinkSeconds } from '../lib/traffic-shape.js'
import { markPhase, pacedSleep } from './phase.js'

const HTTP_OK = 200

const pageRequests = new Counter('page_requests')
const dashboardReadShare = new Rate('dashboard_read_share')
const postSubmissionReads = new Counter('post_submission_reads')
const amendmentPages = new Counter('amendment_pages')
const pagesPerNotification = new Trend('pages_per_notification')
const sessionSeconds = new Trend('session_seconds')
const notificationsStarted = new Counter('notifications_started')
const notificationsSubmitted = new Counter('notifications_submitted')

const pathOf = (url) => url.replace(/^https?:\/\/[^/?#]+/, '').split(/[?#]/)[0]

/**
 * Records a page request in the request mix, with no request and no wait.
 *
 * @param {string} trafficClass - A value of `TRAFFIC_CLASSES`.
 * @param {string} [frontend] - The frontend the page is on, `ins`, `animals` or `plants`.
 */
export const recordPage = (trafficClass, frontend) => {
  markPhase()
  pageRequests.add(
    1,
    frontend === undefined
      ? { traffic_class: trafficClass }
      : { traffic_class: trafficClass, frontend }
  )
  dashboardReadShare.add(isDashboardRead(trafficClass))

  if (trafficClass === TRAFFIC_CLASSES.POST_SUBMISSION_READ) {
    postSubmissionReads.add(1)
  }

  if (trafficClass === TRAFFIC_CLASSES.AMENDMENT) {
    amendmentPages.add(1)
  }
}

/**
 * Records how many pages a finished notification took.
 *
 * @param {number} count - Journey-frontend page requests across all its sessions.
 */
export const recordNotificationPages = (count) =>
  pagesPerNotification.add(count)

/**
 * Counts a notification started, split by its type.
 *
 * @param {string} notificationType - `live-animals`, or a high-risk plants commodity type.
 */
export const recordNotificationStarted = (notificationType) => {
  markPhase()
  notificationsStarted.add(1, { notification_type: notificationType })
}

/**
 * Counts a notification submitted, split by whether it is the first submission
 * or the resubmission of an amendment.
 *
 * @param {string} submission - `first` or `amendment`.
 */
export const recordSubmission = (submission) => {
  markPhase()
  notificationsSubmitted.add(1, { submission })
}

/**
 * Records how long a user session lasted.
 *
 * @param {number} seconds - Wall-clock seconds, including think time.
 */
export const recordSession = (seconds) => {
  markPhase()
  sessionSeconds.add(seconds)
}

/**
 * Wraps a browser session so every page request is classified and followed by think time.
 *
 * Every navigation a scenario makes goes through here, which is what keeps the
 * request mix honest and the load paced like a person's. `upload` posts a
 * multipart form with one file and calls `onLanded` with the landing page
 * before the think time, so scan polling starts when the upload lands.
 *
 * @param {object} options - Walker settings.
 * @param {object} options.session - A browser session.
 * @param {number} options.thinkMean - The mean wait after a page, in seconds.
 * @param {string} options.trafficClass - The class page requests are recorded under.
 * @param {{ count: number }} [options.counter] - Counts the pages requested, shared across sessions.
 * @param {string} [options.frontend] - The frontend the pages are on, ins, animals or plants.
 * @returns {object} The walker.
 */
export const createWalker = ({
  session,
  thinkMean,
  trafficClass,
  counter,
  frontend
}) => {
  const settle = (page) => {
    recordPage(trafficClass, frontend)

    if (counter) {
      counter.count += 1
    }

    pacedSleep(thinkSeconds(thinkMean, Math.random()))

    return page
  }

  const open = (path, endpoint) => settle(session.open(path, endpoint))

  const post = (path, fields, endpoint) =>
    settle(session.post(path, fields, endpoint))

  const submit = (page, answers, endpoint) =>
    settle(session.submitForm(page, answers, endpoint))

  const upload = (page, answers, file, endpoint, onLanded) => {
    const landed = session.submitMultipart(page, answers, file, endpoint)

    onLanded(landed)

    return settle(landed)
  }

  const reach = (current, path, endpoint) =>
    current?.status === HTTP_OK && pathOf(current.url) === path
      ? current
      : open(path, endpoint)

  return {
    session,
    open,
    post,
    submit,
    upload,
    reach,
    record: (nextClass) => recordPage(nextClass, frontend),
    withClass: (nextClass) =>
      createWalker({
        session,
        thinkMean,
        trafficClass: nextClass,
        counter,
        frontend
      })
  }
}
