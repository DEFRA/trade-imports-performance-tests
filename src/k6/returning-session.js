import { check } from 'k6'
import http from 'k6/http'
import { Counter } from 'k6/metrics'

import { TRAFFIC_CLASSES } from '../config/request-mix.js'
import { durationSeconds } from '../config/traffic.js'
import { pathOf } from '../lib/redirects.js'
import { createBrowserSession } from './browser-session.js'
import { createWalker } from './pages.js'
import { pacedSleep } from './phase.js'

const HTTP_OK = 200
const MS_PER_SECOND = 1000
const NO_THINK_TIME = 0
const NEVER_SIGNED_IN = 0

const reauthentications = new Counter('reauthentications')

const states = {}

const stateFor = ({
  scenario,
  entry,
  baseUrl,
  credentials,
  localhostAlias,
  staleRedirects
}) => {
  if (states[scenario] === undefined) {
    const jar = new http.CookieJar()
    const session = createBrowserSession({
      baseUrl,
      localhostAlias,
      credentials,
      staleRedirects,
      jar
    })

    states[scenario] = {
      jar,
      session,
      walker: createWalker({
        session,
        thinkMean: NO_THINK_TIME,
        trafficClass: TRAFFIC_CLASSES.DASHBOARD_READ,
        frontend: entry.frontend
      }),
      signedInAt: NEVER_SIGNED_IN
    }
  }

  return states[scenario]
}

const forgetsSessionWhenExpired = ({ state, baseUrl, model }) => {
  const { sessionExpiry, sessionLifetime } = model.endurance
  const signedForSeconds = (Date.now() - state.signedInAt) / MS_PER_SECOND

  if (
    sessionExpiry === 'client' &&
    state.signedInAt !== NEVER_SIGNED_IN &&
    signedForSeconds >= durationSeconds(sessionLifetime)
  ) {
    state.jar.clear(baseUrl)
  }
}

const recordSignIn = ({ state, entry, page, signInsBefore }) => {
  if (signInsBefore === 0) {
    state.walker.record(TRAFFIC_CLASSES.SIGN_IN)

    return
  }

  state.walker.record(TRAFFIC_CLASSES.RE_AUTHENTICATION)
  reauthentications.add(1)
  check(page, {
    're-authenticated and returned to the page it asked for': (landed) =>
      landed.status === HTTP_OK && pathOf(landed.url) === entry.path
  })
}

/**
 * Makes one visit of a returning user: a user who keeps one browser, and so one
 * session, for the whole run.
 *
 * Re-authentication only happens to a browser that outlives its session, and
 * every other scenario signs in with a fresh browser each time. The user opens
 * their frontend's dashboard, and when the frontend's session has expired the
 * visit goes through Defra ID again and lands back on the dashboard. That
 * sign-in is recorded as re-authentication traffic, counted, and checked. With
 * `sessionExpiry` set to `client` the browser forgets its cookies once the
 * session lifetime has passed, standing in for an expiry a compressed run
 * cannot reach. The visit ends with a wait of the visit interval.
 *
 * @param {object} options - The visit.
 * @param {string} options.scenario - The returning scenario's name.
 * @param {{ frontend: string, path: string, endpoints: ReadonlyArray<string> }} options.entry - The scenario's frontend, page and endpoints.
 * @param {string} options.baseUrl - The frontend's base URL.
 * @param {object} options.model - A resolved traffic model.
 * @param {{ crn: string, password: string }} options.credentials - The stub identity to sign in with.
 * @param {string} options.localhostAlias - The host that stands in for `localhost` in redirects.
 * @param {{ add: (value: number) => void }} options.staleRedirects - Counts handled stale-concurrency redirects.
 */
export const returningVisit = (options) => {
  const { entry, baseUrl, model } = options
  const state = stateFor(options)

  forgetsSessionWhenExpired({ state, baseUrl, model })

  const signInsBefore = state.session.signIns()
  const page = state.walker.open(entry.path, entry.endpoints[1])

  if (state.session.signIns() > signInsBefore) {
    state.signedInAt = Date.now()
    recordSignIn({ state, entry, page, signInsBefore })
  }

  check(page, {
    'returning visit landed': (landed) => landed.status === HTTP_OK
  })
  pacedSleep(durationSeconds(model.endurance.visitInterval))
}
