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
  STUB_PROFILE,
  resolvePassword
} from '../config/smoke.js'
import {
  backgroundVolumeReportThresholds,
  backgroundVolumeThresholds
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

const environment = resolveEnvironment(__ENV)
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
  referenceData: resolveServiceUrl(__ENV, 'trade-imports-reference-data')
}

export const options = {
  scenarios: backgroundScenarios(model),
  thresholds: {
    ...backgroundVolumeThresholds(Object.keys(BACKGROUND_SCENARIOS)),
    ...backgroundVolumeReportThresholds(DATASTORES)
  },
  setupTimeout: SETUP_TIMEOUT,
  teardownTimeout: SETUP_TIMEOUT,
  tags: { environment, stub_profile: STUB_PROFILE }
}

const measure = () =>
  measureBackgroundVolume({ urls, localhostAlias, credentials })

export function setup() {
  console.log(
    `Background volume run in ${environment} with stub profile ${STUB_PROFILE}`
  )
  console.log(`Traffic model: ${JSON.stringify(model)}`)

  waitForReadiness({ urls, localhostAlias, credentials })
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
}
