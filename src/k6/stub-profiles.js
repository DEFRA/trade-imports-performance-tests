import { Gauge } from 'k6/metrics'

import {
  CONFORMANCE_INTERVAL_DAYS,
  FLAGS,
  PROFILES,
  QUANTILES,
  SERVICE_BUS_ENTRY,
  STUBBED_INTEGRATIONS,
  STUB_SERVICES
} from '../config/stub-profiles.js'
import {
  answeredClearedBy,
  answeredLine,
  entriesFromReport,
  flaggedLine,
  flagsFor,
  notReportedEntries,
  orderEntries,
  profileLine,
  profileMismatchMessage
} from '../lib/stub-profiles.js'
import { READINESS_TAGS } from './readiness.js'
import { serviceHttp } from './service-http.js'

const HTTP_OK = 200
const HTTP_NOT_FOUND = 404

const stubProfileGauge = new Gauge('stub_profile')
const stubProfileFlaggedGauge = new Gauge('stub_profile_flagged')
const stubLatencyGauge = new Gauge('stub_latency')
const stubLatencyAnsweredCountGauge = new Gauge('stub_latency_answered_count')

const readStub = ({ stub, url }) => {
  const response = serviceHttp.get(`${url}/latency-profiles`, {
    tags: READINESS_TAGS
  })

  if (response.status === HTTP_OK) {
    return entriesFromReport(response.json(), stub)
  }

  if (response.status === HTTP_NOT_FOUND) {
    return notReportedEntries(stub, STUBBED_INTEGRATIONS)
  }

  throw new Error(
    `Could not read the latency profiles of ${stub}: status ${response.status}`
  )
}

/**
 * Reads the latency profile of every stubbed integration from the stubs that
 * host them. A stub that answers 404 predates profiles and is reported as not
 * reported. Azure Service Bus has no stub, so its entry is declared here.
 * Every request carries the readiness tags, so no threshold measures it.
 *
 * @param {object} options - Read settings.
 * @param {Record<string, string>} options.urls - `tradeImportsStub` and `defraIdStub` base URLs.
 * @returns {object[]} One entry per stubbed integration, in the order of `STUBBED_INTEGRATIONS`.
 * @throws {Error} When a stub answers anything but 200 or 404.
 */
export const readStubProfiles = ({ urls }) => {
  const entries = [
    ...Object.entries(STUB_SERVICES).flatMap(([stub, urlKey]) =>
      readStub({ stub, url: urls[urlKey] })
    ),
    SERVICE_BUS_ENTRY
  ]

  return orderEntries(entries, STUBBED_INTEGRATIONS)
}

/**
 * Forgets what every stub answered so far, so the end-of-run figures cover only
 * this run. A stub that answers 404 or 405 predates profiles and has nothing to
 * clear. Every request carries the readiness tags, so no threshold measures it.
 *
 * @param {object} options - Clear settings.
 * @param {Record<string, string>} options.urls - `tradeImportsStub` and `defraIdStub` base URLs.
 * @throws {Error} When a stub answers anything but 204, 404 or 405.
 */
export const clearStubAnswered = ({ urls }) => {
  for (const [stub, urlKey] of Object.entries(STUB_SERVICES)) {
    const response = serviceHttp.del(
      `${urls[urlKey]}/latency-profiles/answered`,
      null,
      { tags: READINESS_TAGS }
    )

    answeredClearedBy(stub, response.status)
  }
}

const recordProfile = (entry, runDate) => {
  const tags = { integration: entry.integration }
  const flags = flagsFor(entry, runDate, CONFORMANCE_INTERVAL_DAYS)

  for (const profile of PROFILES) {
    stubProfileGauge.add(entry.profile === profile ? 1 : 0, {
      ...tags,
      profile
    })
  }

  for (const flag of FLAGS) {
    stubProfileFlaggedGauge.add(flags.includes(flag) ? 1 : 0, {
      ...tags,
      flag
    })
  }
}

const recordLatency = (entry, source, values) => {
  for (const quantile of QUANTILES) {
    stubLatencyGauge.add(values[`${quantile}Ms`], {
      integration: entry.integration,
      source,
      quantile
    })
  }
}

/**
 * Logs each integration's profile and, at the start of a run, records them, so
 * the run's report names the profile each ran with and its flags. At the end
 * of a run it logs and records the latency each stub actually answered with.
 *
 * @param {object[]} entries - One entry per stubbed integration.
 * @param {string} moment - When they were read, `start` or `end`.
 * @param {Date} runDate - When the run started.
 */
export const reportStubProfiles = (entries, moment, runDate) => {
  if (moment === 'start') {
    for (const entry of entries) {
      console.log(profileLine(entry, runDate, CONFORMANCE_INTERVAL_DAYS))
      recordProfile(entry, runDate)
      recordLatency(entry, 'target', entry.targets)
    }

    console.log(flaggedLine(entries, runDate, CONFORMANCE_INTERVAL_DAYS))

    return
  }

  for (const entry of entries) {
    console.log(answeredLine(entry))

    if (entry.stub !== null) {
      stubLatencyAnsweredCountGauge.add(entry.answered?.count ?? 0, {
        integration: entry.integration
      })
    }

    if (entry.answered?.count > 0) {
      recordLatency(entry, 'answered', entry.answered)
    }
  }
}

/**
 * Stops a run that would measure against stubs on the wrong latency profile.
 *
 * @param {object[]} entries - One entry per stubbed integration.
 * @param {string | undefined} required - The profile the run requires, or undefined when none.
 * @throws {Error} Naming each stub-hosted integration that runs another profile.
 */
export const requireStubProfiles = (entries, required) => {
  const message = profileMismatchMessage(entries, required)

  if (message !== undefined) {
    throw new Error(message)
  }
}
