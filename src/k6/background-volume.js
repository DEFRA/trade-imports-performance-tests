import { check } from 'k6'
import http from 'k6/http'
import { Gauge } from 'k6/metrics'

import { targetsFrom } from '../config/background-volume.js'
import { PERF_ADDRESS } from '../config/smoke.js'
import {
  addressCountFrom,
  backgroundAddressName,
  shortfallMessage,
  volumeLine
} from '../lib/background-volume.js'
import { createBrowserSession } from './browser-session.js'
import { READINESS_TAGS, ignoreStaleRedirects } from './readiness.js'

const HTTP_OK = 200
const ADDRESS_BOOK = '/address-book'
const RESULTS_LABEL = '[data-testid="address-book-results-label"]'

const backgroundVolumeGauge = new Gauge('background_volume')

const unreadable = (datastore) =>
  new Error(`Could not read the background volume of ${datastore}`)

const totalOf = (url, datastore) => {
  const response = http.get(url, { tags: READINESS_TAGS })

  if (response.status !== HTTP_OK) {
    throw unreadable(datastore)
  }

  const total = response.json('totalElements')

  if (!Number.isInteger(total)) {
    throw unreadable(datastore)
  }

  return total
}

const addressCount = ({ urls, localhostAlias, credentials }) => {
  const session = createBrowserSession({
    baseUrl: urls.ins,
    localhostAlias,
    credentials,
    staleRedirects: ignoreStaleRedirects,
    extraTags: READINESS_TAGS
  })
  const page = session.open(ADDRESS_BOOK, 'ins-address-book')

  if (page.status !== HTTP_OK) {
    throw unreadable('address-book')
  }

  const count = addressCountFrom({
    heading: page.heading,
    labelText: page.html.find(RESULTS_LABEL).text()
  })

  if (count === undefined) {
    throw unreadable('address-book')
  }

  return count
}

/**
 * Reads how much background volume each datastore holds.
 *
 * The journey backends and the dashboard read model answer a count over HTTP.
 * The address book is counted from the INS address-book page's results label.
 * Every request carries the readiness tags, so no threshold measures it.
 *
 * @param {object} options - Read settings.
 * @param {Record<string, string>} options.urls - `ins`, `animalsBackend`, `plantsBackend` and `insBackend` base URLs.
 * @param {string} options.localhostAlias - The host that stands in for `localhost` in redirects.
 * @param {{ crn: string, password: string }} options.credentials - The stub identity to sign in with.
 * @returns {Record<string, number>} The count in each datastore.
 * @throws {Error} When a datastore's count cannot be read.
 */
export const measureBackgroundVolume = ({
  urls,
  localhostAlias,
  credentials
}) => ({
  'live-animals': totalOf(
    `${urls.animalsBackend}/notifications/reference-numbers?page=0`,
    'live-animals'
  ),
  'high-risk-plants': totalOf(
    `${urls.plantsBackend}/notifications/reference-numbers?page=0`,
    'high-risk-plants'
  ),
  'dashboard-read-model': totalOf(
    `${urls.insBackend}/notifications?page=1`,
    'dashboard-read-model'
  ),
  'address-book': addressCount({ urls, localhostAlias, credentials })
})

/**
 * Logs the background volume and, for the start of a run, records it, so the
 * run's report states the volume present when it started.
 *
 * @param {Record<string, number>} volume - The count in each datastore.
 * @param {object} backgroundVolume - The `backgroundVolume` part of the traffic model.
 * @param {string} moment - When it was read, `start` or `end`.
 */
export const reportBackgroundVolume = (volume, backgroundVolume, moment) => {
  console.log(volumeLine(moment, volume, targetsFrom(backgroundVolume)))

  if (moment !== 'start') {
    return
  }

  for (const [datastore, count] of Object.entries(volume)) {
    backgroundVolumeGauge.add(count, { datastore })
  }
}

/**
 * Stops a load run that would measure an environment short of its background volume.
 *
 * @param {Record<string, number>} volume - The count in each datastore.
 * @param {object} backgroundVolume - The `backgroundVolume` part of the traffic model.
 * @throws {Error} Naming each datastore below its target.
 */
export const requireBackgroundVolume = (volume, backgroundVolume) => {
  const message = shortfallMessage(volume, targetsFrom(backgroundVolume))

  if (message !== undefined) {
    throw new Error(message)
  }
}

/**
 * Adds one background address through the INS add-address form.
 *
 * Signs in afresh and waits for nothing. With no picker handshake, the save
 * redirects to the address-book list.
 *
 * @param {object} options - Address settings.
 * @param {Record<string, string>} options.urls - Service base URLs, with `ins`.
 * @param {{ crn: string, password: string }} options.credentials - The stub identity to sign in with.
 * @param {string} options.localhostAlias - The host that stands in for `localhost` in redirects.
 * @param {{ add: (value: number) => void }} options.staleRedirects - Counts handled stale-concurrency redirects.
 * @param {number} options.index - The address's number across the background volume, from 0.
 */
export const addBackgroundAddress = ({
  urls,
  credentials,
  localhostAlias,
  staleRedirects,
  index
}) => {
  const session = createBrowserSession({
    baseUrl: urls.ins,
    localhostAlias,
    credentials,
    staleRedirects
  })
  const form = session.open(`${ADDRESS_BOOK}/add`, 'ins-address-add')
  const saved = session.submitForm(
    form,
    {
      ...PERF_ADDRESS,
      name: backgroundAddressName(index),
      addressLine1: `${index + 1} Background Road`
    },
    'ins-address-add-save'
  )

  check(saved, {
    'background address added': (page) =>
      page.status === HTTP_OK && page.url.endsWith(ADDRESS_BOOK)
  })
}
