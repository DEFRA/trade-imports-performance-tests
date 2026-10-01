import exec from 'k6/execution'
import { Counter } from 'k6/metrics'

import { mixTargetLine } from '../config/request-mix.js'
import {
  IDENTITY,
  JOURNEYS,
  PERF_ADDRESS,
  SCENARIOS,
  SETUP_TIMEOUT,
  STUB_PROFILE,
  resolvePassword,
  notificationSplits,
  smokeScenarios
} from '../config/smoke.js'
import {
  documentScanThresholds,
  notificationSplitThresholds,
  smokeThresholds
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
import { HIGH_RISK_PLANTS_STEPS } from '../k6/high-risk-plants.js'
import { notificationJourney } from '../k6/journeys.js'
import { LIVE_ANIMALS_STEPS } from '../k6/live-animals.js'
import { waitForReadiness } from '../k6/readiness.js'

const environment = resolveEnvironment(__ENV)
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
  referenceData: resolveServiceUrl(__ENV, 'trade-imports-reference-data')
}

export const options = {
  scenarios: smokeScenarios(model),
  thresholds: {
    ...smokeThresholds(SCENARIOS),
    ...documentScanThresholds('live-animals'),
    ...notificationSplitThresholds(notificationSplits(model))
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  setupTimeout: SETUP_TIMEOUT,
  tags: { environment, stub_profile: STUB_PROFILE }
}

export function setup() {
  console.log(`Smoke run in ${environment} with stub profile ${STUB_PROFILE}`)
  console.log(`Traffic model: ${JSON.stringify(model)}`)
  console.log(mixTargetLine(model))
  console.log(documentScanAllowanceLine())

  const caveat = standInCaveat(environment)

  if (caveat) {
    console.log(caveat)
  }

  waitForReadiness({ urls, localhostAlias, credentials })
  ensurePerfAddress({
    insUrl: urls.ins,
    localhostAlias,
    credentials,
    address: PERF_ADDRESS
  })

  return { addressName: PERF_ADDRESS.name }
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
