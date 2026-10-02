import exec from 'k6/execution'
import { Counter } from 'k6/metrics'

import { DATASTORES, indexesBuiltLine } from '../config/background-volume.js'
import { mixTargetLine } from '../config/request-mix.js'
import {
  IDENTITY,
  JOURNEYS,
  PERF_ADDRESS,
  SCENARIOS,
  SETUP_TIMEOUT,
  resolvePassword,
  notificationSplits,
  smokeScenarios
} from '../config/smoke.js'
import {
  STUBBED_INTEGRATIONS,
  resolveRequiredStubProfile
} from '../config/stub-profiles.js'
import {
  backgroundVolumeReportThresholds,
  documentScanThresholds,
  notificationSplitThresholds,
  smokeThresholds,
  stubProfileReportThresholds
} from '../config/thresholds.js'
import {
  documentScanAllowanceLine,
  standInCaveat
} from '../config/test-data.js'
import {
  resolveEnvironment,
  resolveLocalhostAlias,
  resolveServiceUrl
} from '../config/target.js'
import { SMOKE_PROFILE, resolveTrafficModel } from '../config/traffic.js'
import {
  addressBookSession,
  dashboardOnlySession,
  ensurePerfAddress
} from '../k6/front-door.js'
import {
  measureBackgroundVolume,
  reportBackgroundVolume
} from '../k6/background-volume.js'
import { HIGH_RISK_PLANTS_STEPS } from '../k6/high-risk-plants.js'
import { notificationJourney } from '../k6/journeys.js'
import { LIVE_ANIMALS_STEPS } from '../k6/live-animals.js'
import { waitForReadiness } from '../k6/readiness.js'
import {
  clearStubAnswered,
  readStubProfiles,
  reportStubProfiles,
  requireStubProfiles
} from '../k6/stub-profiles.js'

const environment = resolveEnvironment(__ENV)
const requiredStubProfile = resolveRequiredStubProfile(__ENV)
const localhostAlias = resolveLocalhostAlias(__ENV)
const credentials = {
  crn: IDENTITY.crn,
  password: resolvePassword(__ENV)
}
const model = resolveTrafficModel(__ENV, SMOKE_PROFILE)
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
  scenarios: smokeScenarios(model),
  thresholds: {
    ...smokeThresholds(SCENARIOS),
    ...documentScanThresholds('live-animals'),
    ...notificationSplitThresholds(notificationSplits(model)),
    ...backgroundVolumeReportThresholds(DATASTORES),
    ...stubProfileReportThresholds(STUBBED_INTEGRATIONS)
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  setupTimeout: SETUP_TIMEOUT,
  tags: { environment, stub_profile: requiredStubProfile ?? 'as-reported' }
}

export function setup() {
  console.log(
    `Smoke run in ${environment}, requiring stub profile ${requiredStubProfile ?? 'none'}`
  )
  console.log(`Traffic model: ${JSON.stringify(model)}`)
  console.log(mixTargetLine(model))
  console.log(documentScanAllowanceLine())

  const caveat = standInCaveat(environment)

  if (caveat) {
    console.log(caveat)
  }

  waitForReadiness({ urls, localhostAlias, credentials })

  const stubProfiles = readStubProfiles({ urls })

  reportStubProfiles(stubProfiles, 'start', new Date())
  requireStubProfiles(stubProfiles, requiredStubProfile)
  clearStubAnswered({ urls })
  console.log(indexesBuiltLine())
  ensurePerfAddress({
    insUrl: urls.ins,
    localhostAlias,
    credentials,
    address: PERF_ADDRESS
  })
  reportBackgroundVolume(
    measureBackgroundVolume({ urls, localhostAlias, credentials }),
    model.backgroundVolume,
    'start'
  )

  return { addressName: PERF_ADDRESS.name }
}

export function teardown() {
  reportStubProfiles(readStubProfiles({ urls }), 'end', new Date())
}

const frontDoorOptions = () => ({
  urls,
  model,
  credentials,
  localhostAlias,
  staleRedirects,
  vu: exec.vu.idInTest,
  iteration: exec.scenario.iterationInTest
})

export function insFrontDoor() {
  dashboardOnlySession(frontDoorOptions())
}

export function insAddressBook() {
  addressBookSession(frontDoorOptions())
}

const journeyOptions = ({ journey, steps, frontend, backend, data }) => ({
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
  iterationInTest: exec.scenario.iterationInTest
})

export function liveAnimals(data) {
  notificationJourney(
    journeyOptions({
      journey: animals,
      steps: LIVE_ANIMALS_STEPS,
      frontend: urls.animalsFrontend,
      backend: urls.animalsBackend,
      data
    })
  )
}

export function highRiskPlants(data) {
  notificationJourney(
    journeyOptions({
      journey: plants,
      steps: HIGH_RISK_PLANTS_STEPS,
      frontend: urls.plantsFrontend,
      backend: urls.plantsBackend,
      data
    })
  )
}
