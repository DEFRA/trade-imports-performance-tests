import exec from 'k6/execution'
import { Counter } from 'k6/metrics'

import {
  BACKGROUND_SCENARIOS,
  DATASTORES,
  backgroundScenarios,
  indexesBuiltLine,
  targetsFrom
} from '../config/background-volume.js'
import {
  IDENTITY,
  JOURNEYS,
  PERF_ADDRESS,
  SETUP_TIMEOUT,
  resolvePassword
} from '../config/smoke.js'
import { resolveRecordedCeilings } from '../config/stub-ceilings.js'
import { STUBBED_INTEGRATIONS } from '../config/stub-profiles.js'
import {
  backgroundVolumeReportThresholds,
  backgroundVolumeThresholds,
  stubHeadroomReportThresholds,
  stubProfileReportThresholds
} from '../config/thresholds.js'
import {
  resolveEnvironment,
  resolveLocalhostAlias,
  resolveServiceUrl
} from '../config/target.js'
import {
  BACKGROUND_VOLUME_PROFILE,
  resolveTrafficModel
} from '../config/traffic.js'
import { createdLine, toCreate } from '../lib/background-volume.js'
import { ensurePerfAddress } from '../k6/front-door.js'
import { HIGH_RISK_PLANTS_STEPS } from '../k6/high-risk-plants.js'
import { notificationJourney } from '../k6/journeys.js'
import { LIVE_ANIMALS_STEPS } from '../k6/live-animals.js'
import {
  addBackgroundAddress,
  measureBackgroundVolume,
  reportBackgroundVolume
} from '../k6/background-volume.js'
import { waitForReadiness } from '../k6/readiness.js'
import { reportStubHeadroom } from '../k6/stub-ceilings.js'
import {
  clearStubAnswered,
  readStubProfiles,
  reportStubProfiles
} from '../k6/stub-profiles.js'

const environment = resolveEnvironment(__ENV)
const ceilings = resolveRecordedCeilings(__ENV, environment)
const localhostAlias = resolveLocalhostAlias(__ENV)
const credentials = {
  crn: IDENTITY.crn,
  password: resolvePassword(__ENV)
}
const model = resolveTrafficModel(__ENV, BACKGROUND_VOLUME_PROFILE)
const staleRedirects = new Counter('stale_concurrency_redirects')

const animals = JOURNEYS['live-animals']
const plants = JOURNEYS['high-risk-plants']

const urls = {
  ins: resolveServiceUrl(__ENV, 'trade-imports-ins-frontend'),
  animalsFrontend: resolveServiceUrl(__ENV, animals.frontend),
  plantsFrontend: resolveServiceUrl(__ENV, plants.frontend),
  animalsBackend: resolveServiceUrl(__ENV, animals.backend),
  plantsBackend: resolveServiceUrl(__ENV, plants.backend),
  insBackend: resolveServiceUrl(__ENV, 'trade-imports-ins-backend'),
  referenceData: resolveServiceUrl(__ENV, 'trade-imports-reference-data'),
  tradeImportsStub: resolveServiceUrl(__ENV, 'trade-imports-stub'),
  defraIdStub: resolveServiceUrl(__ENV, 'trade-imports-defra-id-stub')
}

export const options = {
  scenarios: backgroundScenarios(model),
  thresholds: {
    ...backgroundVolumeThresholds(Object.keys(BACKGROUND_SCENARIOS)),
    ...backgroundVolumeReportThresholds(DATASTORES),
    ...stubProfileReportThresholds(STUBBED_INTEGRATIONS),
    ...stubHeadroomReportThresholds(STUBBED_INTEGRATIONS)
  },
  setupTimeout: SETUP_TIMEOUT,
  teardownTimeout: SETUP_TIMEOUT,
  tags: { environment, stub_profile: 'as-reported' }
}

const measure = () =>
  measureBackgroundVolume({ urls, localhostAlias, credentials })

export function setup() {
  console.log(`Background volume run in ${environment}`)
  console.log(`Traffic model: ${JSON.stringify(model)}`)

  waitForReadiness({ urls, localhostAlias, credentials })
  reportStubProfiles(readStubProfiles({ urls }), 'start', new Date())
  clearStubAnswered({ urls })

  const stubLoadSince = Date.now()

  console.log(indexesBuiltLine())
  ensurePerfAddress({
    insUrl: urls.ins,
    localhostAlias,
    credentials,
    address: PERF_ADDRESS
  })

  const before = measure()
  const targets = targetsFrom(model.backgroundVolume)
  const cap = model.backgroundVolume.maxCreatedPerRun

  reportBackgroundVolume(before, model.backgroundVolume, 'start')

  return {
    addressName: PERF_ADDRESS.name,
    stubLoadSince,
    before,
    toCreate: Object.fromEntries(
      Object.keys(targets).map((datastore) => [
        datastore,
        toCreate(targets[datastore], before[datastore], cap)
      ])
    )
  }
}

const journeyOptions = ({
  journey,
  datastore,
  steps,
  frontend,
  backend,
  data
}) => ({
  journey,
  steps,
  model,
  backendUrl: backend,
  urls: { ins: urls.ins, frontend },
  credentials,
  localhostAlias,
  staleRedirects,
  addressName: data.addressName,
  vu: exec.vu.idInTest,
  paced: false,
  replaysCapturedSave: false,
  iterationInTest: data.before[datastore] + exec.scenario.iterationInTest
})

const hasNothingLeftToCreate = (data, datastore) =>
  exec.scenario.iterationInTest >= data.toCreate[datastore]

export function seedLiveAnimals(data) {
  if (hasNothingLeftToCreate(data, 'live-animals')) {
    return
  }

  notificationJourney(
    journeyOptions({
      journey: animals,
      datastore: 'live-animals',
      steps: LIVE_ANIMALS_STEPS,
      frontend: urls.animalsFrontend,
      backend: urls.animalsBackend,
      data
    })
  )
}

export function seedHighRiskPlants(data) {
  if (hasNothingLeftToCreate(data, 'high-risk-plants')) {
    return
  }

  notificationJourney(
    journeyOptions({
      journey: plants,
      datastore: 'high-risk-plants',
      steps: HIGH_RISK_PLANTS_STEPS,
      frontend: urls.plantsFrontend,
      backend: urls.plantsBackend,
      data
    })
  )
}

export function seedAddressBook(data) {
  if (hasNothingLeftToCreate(data, 'address-book')) {
    return
  }

  addBackgroundAddress({
    urls,
    credentials,
    localhostAlias,
    staleRedirects,
    index: data.before['address-book'] + exec.scenario.iterationInTest
  })
}

export function teardown(data) {
  const after = measure()

  reportBackgroundVolume(after, model.backgroundVolume, 'end')
  console.log(createdLine(data.before, after))
  const entries = readStubProfiles({ urls })

  reportStubProfiles(entries, 'end', new Date())
  reportStubHeadroom({
    entries,
    ceilings,
    environment,
    since: data.stubLoadSince,
    now: Date.now()
  })
}
