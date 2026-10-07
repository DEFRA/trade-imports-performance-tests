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
import { resolveRecordedCeilings } from '../config/stub-ceilings.js'
import {
  STUBBED_INTEGRATIONS,
  resolveRequiredStubProfile
} from '../config/stub-profiles.js'
import {
  backgroundVolumeReportThresholds,
  callCountThresholds,
  documentScanThresholds,
  eventArrivalThresholds,
  eventingReportThresholds,
  notificationSplitThresholds,
  runEnvironmentReportThresholds,
  serviceBusThresholds,
  smokeThresholds,
  stubHeadroomReportThresholds,
  stubProfileReportThresholds
} from '../config/thresholds.js'
import {
  documentScanAllowanceLine,
  standInCaveat
} from '../config/test-data.js'
import {
  backendRouteLine,
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
import { clearCallCounts, reportCallCounts } from '../k6/call-counts.js'
import { readEventingStart, reportEventCounts } from '../k6/eventing.js'
import { HIGH_RISK_PLANTS_STEPS } from '../k6/high-risk-plants.js'
import { notificationJourney } from '../k6/journeys.js'
import { LIVE_ANIMALS_STEPS } from '../k6/live-animals.js'
import { waitForReadiness } from '../k6/readiness.js'
import { recordRunEnvironment } from '../k6/run-environment.js'
import { reportStubHeadroom } from '../k6/stub-ceilings.js'
import {
  clearStubAnswered,
  readStubProfiles,
  reportStubProfiles,
  requireStubProfiles
} from '../k6/stub-profiles.js'

const environment = resolveEnvironment(__ENV)
const ceilings = resolveRecordedCeilings(__ENV, environment)
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
  defraIdStub: resolveServiceUrl(__ENV, 'trade-imports-defra-id-stub'),
  gateway: resolveServiceUrl(__ENV, 'trade-imports-dynamics-gateway')
}

export const options = {
  scenarios: smokeScenarios(model),
  thresholds: {
    ...smokeThresholds(SCENARIOS),
    ...eventingReportThresholds(),
    ...eventArrivalThresholds(SCENARIOS),
    ...serviceBusThresholds(environment),
    ...documentScanThresholds('live-animals'),
    ...notificationSplitThresholds(notificationSplits(model)),
    ...backgroundVolumeReportThresholds(DATASTORES),
    ...stubProfileReportThresholds(STUBBED_INTEGRATIONS),
    ...stubHeadroomReportThresholds(STUBBED_INTEGRATIONS),
    ...callCountThresholds(environment),
    ...runEnvironmentReportThresholds(environment)
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  setupTimeout: SETUP_TIMEOUT,
  teardownTimeout: SETUP_TIMEOUT,
  tags: { environment, stub_profile: requiredStubProfile ?? 'as-reported' }
}

export function setup() {
  console.log(
    `Smoke run in ${environment}, requiring stub profile ${requiredStubProfile ?? 'none'}`
  )
  console.log(backendRouteLine(__ENV))
  recordRunEnvironment(environment)
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

  const stubLoadSince = Date.now()

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

  clearCallCounts({ urls })

  return {
    addressName: PERF_ADDRESS.name,
    stubLoadSince,
    eventingStart: readEventingStart({ urls })
  }
}

export function teardown(data) {
  try {
    reportCallCounts({ urls })

    const entries = readStubProfiles({ urls })

    reportStubProfiles(entries, 'end', new Date())
    reportStubHeadroom({
      entries,
      ceilings,
      environment,
      since: data.stubLoadSince,
      now: Date.now()
    })
  } finally {
    reportEventCounts({ urls, start: data.eventingStart })
  }
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
  iterationInTest: exec.scenario.iterationInTest,
  confirmsEventArrival: true,
  insBackendUrl: urls.insBackend
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
