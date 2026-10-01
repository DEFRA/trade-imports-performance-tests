import { Counter } from 'k6/metrics'

import {
  IDENTITY,
  JOURNEYS,
  SCENARIOS,
  SETUP_TIMEOUT,
  STUB_PROFILE,
  resolvePassword,
  smokeScenarios
} from '../config/smoke.js'
import { smokeThresholds } from '../config/thresholds.js'
import {
  resolveEnvironment,
  resolveLocalhostAlias,
  resolveServiceUrl
} from '../config/target.js'
import { createBrowserSession } from '../k6/browser-session.js'
import {
  draftJourney,
  insFrontDoor as visitInsFrontDoor
} from '../k6/journeys.js'
import { waitForReadiness } from '../k6/readiness.js'

const environment = resolveEnvironment(__ENV)
const localhostAlias = resolveLocalhostAlias(__ENV)
const credentials = {
  crn: IDENTITY.crn,
  password: resolvePassword(__ENV)
}
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
  scenarios: smokeScenarios(),
  thresholds: smokeThresholds(SCENARIOS),
  setupTimeout: SETUP_TIMEOUT,
  tags: { environment, stub_profile: STUB_PROFILE }
}

const sessionOn = (baseUrl) =>
  createBrowserSession({ baseUrl, localhostAlias, credentials, staleRedirects })

// Each session has to outlive the iterations of its virtual user.
let insSession
let animalsSession
let plantsSession

export function setup() {
  console.log(`Smoke run in ${environment} with stub profile ${STUB_PROFILE}`)

  waitForReadiness({ urls, localhostAlias, credentials })
}

export function insFrontDoor() {
  insSession ??= sessionOn(urls.ins)

  visitInsFrontDoor(insSession, __ITER)
}

export function liveAnimals() {
  animalsSession ??= sessionOn(urls.animalsFrontend)

  draftJourney({
    journey: animals,
    session: animalsSession,
    backendUrl: urls.animalsBackend,
    vu: __VU,
    iteration: __ITER
  })
}

export function highRiskPlants() {
  plantsSession ??= sessionOn(urls.plantsFrontend)

  draftJourney({
    journey: plants,
    session: plantsSession,
    backendUrl: urls.plantsBackend,
    vu: __VU,
    iteration: __ITER
  })
}
