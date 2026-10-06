import { check, sleep } from 'k6'
import exec from 'k6/execution'
import { Counter, Gauge, Rate, Trend } from 'k6/metrics'

import {
  ARRIVAL_POLL_SECONDS,
  ARRIVAL_TIMEOUT_SECONDS,
  SCHEMA_VERSIONS,
  SETTLE_POLL_SECONDS,
  SETTLE_TIMEOUT_SECONDS
} from '../config/eventing.js'
import {
  INITIAL_BACKLOG_STATE,
  backlogDepthFrom,
  differentInstancesLine,
  eventingWatchLine,
  externalEventCount,
  forwardedCountFrom,
  forwardedDelta,
  hasArrived,
  isSettled,
  latestVersion,
  readingsLine,
  settleLine,
  trackBacklog
} from '../lib/eventing.js'
import { READINESS_TAGS } from './readiness.js'
import { serviceHttp } from './service-http.js'

const HTTP_OK = 200
const MS_PER_SECOND = 1000
const FIRST_VERSION = SCHEMA_VERSIONS[0]
const WATCH_TAGS = { watch: 'eventing' }

const externalEventsPublished = new Counter('external_events_published')
const eventArrivals = new Rate('event_arrivals')
const eventArrivalSeconds = new Trend('event_arrival_seconds')
const serviceBusForwarded = new Gauge('service_bus_forwarded')
const serviceBusForwardedMessages = new Counter(
  'service_bus_forwarded_messages'
)
const backlogDepthGauge = new Gauge('eventing_backlog_depth')
const preBurstDepthGauge = new Gauge('eventing_backlog_pre_burst_depth')
const peakDepthGauge = new Gauge('eventing_backlog_peak_depth')
const drainSecondsGauge = new Gauge('eventing_backlog_drain_seconds')
const drained = new Rate('eventing_backlog_drained')
const peakPerSecondGauge = new Gauge('service_bus_peak_per_second')

const readBody = (url) => {
  try {
    const response = serviceHttp.get(url, { tags: READINESS_TAGS })

    return response.status === HTTP_OK ? response.json() : null
  } catch {
    return null
  }
}

const readForwardedCount = ({ urls, version }) =>
  forwardedCountFrom(
    readBody(
      `${urls.gateway}/metrics/notification.sqs.messages?tag=outcome:forwarded&tag=schemaVersion:${version}`
    )
  )

/**
 * Reads how many messages this gateway instance has forwarded to Service Bus, as
 * each schema version. Every event is sent once as each, so the two counts
 * should match.
 *
 * The request carries the readiness tags, so no threshold measures it.
 *
 * @param {object} options - Read settings.
 * @param {Record<string, string>} options.urls - The `gateway` base URL.
 * @returns {Record<string, number | null>} A count for each schema version; null where it could not be read.
 */
export const readForwardedCounts = ({ urls }) =>
  Object.fromEntries(
    SCHEMA_VERSIONS.map((version) => [
      version,
      readForwardedCount({ urls, version })
    ])
  )

/**
 * Reads how many messages the gateway's source queue holds, visible and in flight.
 *
 * @param {object} options - Read settings.
 * @param {Record<string, string>} options.urls - The `gateway` base URL.
 * @returns {number | null} The backlog; null when it could not be read.
 */
export const readBacklogDepth = ({ urls }) =>
  backlogDepthFrom(readBody(`${urls.gateway}/queue/notifications`))

const readNow = ({ urls }) => ({
  forwarded: readForwardedCounts({ urls }),
  depth: readBacklogDepth({ urls })
})

/**
 * Takes the readings a run counts from: the forwarded counts and the backlog.
 *
 * @param {object} options - Read settings.
 * @param {Record<string, string>} options.urls - The `gateway` base URL.
 * @returns {{ forwarded: Record<string, number | null>, depth: number | null }} The readings.
 */
export const readEventingStart = ({ urls }) => readNow({ urls })

const awaitArrival = ({ insBackendUrl, referenceNumber, version }) => {
  const deadline = Date.now() + ARRIVAL_TIMEOUT_SECONDS * MS_PER_SECOND
  const hasReached = () =>
    hasArrived(
      readBody(
        `${insBackendUrl}/notifications?referenceNumber=${referenceNumber}`
      ),
      version
    )

  while (!hasReached()) {
    if (Date.now() >= deadline) {
      return false
    }

    sleep(ARRIVAL_POLL_SECONDS)
  }

  return true
}

/**
 * Proves one notification's events reached the dashboard read model.
 *
 * Reads the notification's outbox events once, counts the ones the gateway
 * forwards, and takes the highest aggregate version. Then it polls the read
 * model until it holds that version, for up to the arrival timeout, and records
 * whether it did and how long it took.
 *
 * @param {object} options - The notification.
 * @param {string} options.backendUrl - The journey backend's base URL.
 * @param {string} options.insBackendUrl - The INS backend's base URL, which holds the read model.
 * @param {string} options.referenceNumber - The notification's reference number.
 */
export const confirmEventArrival = ({
  backendUrl,
  insBackendUrl,
  referenceNumber
}) => {
  const events = readBody(
    `${backendUrl}/notifications/${referenceNumber}/outbox-events`
  )
  const startedAt = Date.now()

  externalEventsPublished.add(externalEventCount(events))

  const version = latestVersion(events)

  if (version === null) {
    eventArrivals.add(false)
    check(false, {
      'events reached the dashboard read model': (reached) => reached
    })

    return
  }

  const arrived = awaitArrival({ insBackendUrl, referenceNumber, version })

  eventArrivals.add(arrived)

  if (arrived) {
    eventArrivalSeconds.add((Date.now() - startedAt) / MS_PER_SECOND)
  }

  check(arrived, {
    'events reached the dashboard read model': (reached) => reached
  })
}

const settle = ({ urls, startDepth }) => {
  const startedAt = Date.now()
  const deadline = startedAt + SETTLE_TIMEOUT_SECONDS * MS_PER_SECOND
  let previousForwarded = null
  let reading = readNow({ urls })

  const isQuiet = () =>
    isSettled({
      startDepth,
      depth: reading.depth,
      previousForwarded,
      forwarded: reading.forwarded[FIRST_VERSION]
    })

  while (!isQuiet() && Date.now() < deadline) {
    previousForwarded = reading.forwarded[FIRST_VERSION]
    sleep(SETTLE_POLL_SECONDS)
    reading = readNow({ urls })
  }

  return {
    reading,
    settledSeconds: isQuiet()
      ? Math.round((Date.now() - startedAt) / MS_PER_SECOND)
      : null
  }
}

const recordForwarded = ({ start, end }) => {
  for (const version of SCHEMA_VERSIONS) {
    const before = start.forwarded[version]
    const after = end.forwarded[version]
    const delta = forwardedDelta({ before, after })

    if (delta !== null) {
      serviceBusForwarded.add(delta, { schema_version: version })
    } else if (before !== null && after !== null) {
      console.log(differentInstancesLine())
    }
  }
}

/**
 * Settles, then records what the gateway forwarded to Service Bus over the run.
 *
 * Settling waits for the backlog to be back at or below where the run started
 * and for the v0.1.0 forwarded count to stop rising, for up to the settle
 * timeout. Only then does it record each schema version's count, end minus start,
 * as the gauge `service_bus_forwarded`. A count that went down came from a
 * different gateway instance, so it is not recorded.
 *
 * @param {object} options - The run.
 * @param {Record<string, string>} options.urls - The `gateway` base URL.
 * @param {{ forwarded: Record<string, number | null>, depth: number | null }} options.start - The readings from `readEventingStart`.
 */
export const reportEventCounts = ({ urls, start }) => {
  const { reading, settledSeconds } = settle({ urls, startDepth: start.depth })

  console.log(
    settleLine({ settledSeconds, timeoutSeconds: SETTLE_TIMEOUT_SECONDS })
  )
  console.log(readingsLine({ start, end: reading }))
  recordForwarded({ start, end: reading })
}

/**
 * Logs what a burst or spike run's eventing watch reads, and over which window.
 *
 * @param {object} options - The watch.
 * @param {{ phase: string, startSeconds: number, endSeconds: number }} options.window - The burst or spike window.
 */
export const reportEventingWatchSetup = ({ window }) => {
  console.log(eventingWatchLine({ phase: window.phase, window }))
}

let watchState = INITIAL_BACKLOG_STATE
let previousForwarded = null

const recordWatchGauges = (gauges) => {
  if ('preBurstDepth' in gauges) {
    preBurstDepthGauge.add(gauges.preBurstDepth)
  }

  if ('peakDepth' in gauges) {
    peakDepthGauge.add(gauges.peakDepth)
  }

  if ('peakPerSecond' in gauges) {
    peakPerSecondGauge.add(gauges.peakPerSecond)
  }

  if ('drainSeconds' in gauges) {
    drainSecondsGauge.add(gauges.drainSeconds)
    drained.add(true)
  }
}

/**
 * Takes one second's reading of the eventing path during a burst or spike run.
 *
 * Records the forwarded messages since the last reading, which is the outbound
 * rate on the one-second time series, and the backlog depth. Then it folds the
 * reading into the window's tracking and records the figures that changed.
 * One virtual user runs this, so the module's state has one owner.
 *
 * @param {object} options - The reading.
 * @param {Record<string, string>} options.urls - The `gateway` base URL.
 * @param {{ startSeconds: number, endSeconds: number }} options.window - The burst or spike window on the run's clock.
 */
export const watchEventing = ({ urls, window }) => {
  const seconds = Math.round(
    (Date.now() - exec.scenario.startTime) / MS_PER_SECOND
  )
  const forwarded = readForwardedCount({ urls, version: FIRST_VERSION })
  const depth = readBacklogDepth({ urls })
  const delta = forwardedDelta({ before: previousForwarded, after: forwarded })

  previousForwarded = forwarded

  if (delta !== null) {
    serviceBusForwardedMessages.add(delta, WATCH_TAGS)
  }

  if (depth !== null) {
    backlogDepthGauge.add(depth, WATCH_TAGS)
  }

  const tracked = trackBacklog(
    watchState,
    { seconds, depth, forwardedDelta: delta },
    window
  )

  watchState = tracked.state
  recordWatchGauges(tracked.gauges)
}
