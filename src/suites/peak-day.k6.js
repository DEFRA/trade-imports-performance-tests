import exec from 'k6/execution'
import { Counter } from 'k6/metrics'

import { DATASTORES, indexesBuiltLine } from '../config/background-volume.js'
import {
  resolveScenarioLength,
  requiredStubProfileFor,
  isScriptCheck
} from '../config/design-target.js'
import {
  PEAK_DAY_LENGTH_PROFILES,
  PEAK_DAY_SCENARIOS,
  peakDayLine,
  peakDayScenarios
} from '../config/peak-day.js'
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
  backendRouteLine,
  resolveEnvironment,
  resolveLocalhostAlias,
  resolveServiceUrl
} from '../config/target.js'
import {
  documentScanAllowanceLine,
  standInCaveat
} from '../config/test-data.js'
import {
  backgroundVolumeReportThresholds,
  eventingReportThresholds,
  peakDayThresholds,
  runEnvironmentReportThresholds,
  stubHeadroomReportThresholds,
  stubProfileReportThresholds
} from '../config/thresholds.js'
import { resolveTrafficModel } from '../config/traffic.js'
import { peakDayReport, peakDayText } from '../lib/eventing.js'
import {
  measureBackgroundVolume,
  reportBackgroundVolume,
  requireBackgroundVolume
} from '../k6/background-volume.js'
import { readEventingStart, reportEventCounts } from '../k6/eventing.js'
import { ensurePerfAddress } from '../k6/front-door.js'
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
const scenarioLength = resolveScenarioLength(__ENV, environment)
const stubProfile = requiredStubProfileFor(__ENV, environment)
const model = resolveTrafficModel(
  __ENV,
  PEAK_DAY_LENGTH_PROFILES[scenarioLength]
)
const ceilings = resolveRecordedCeilings(__ENV, environment)
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
  insBackend: resolveServiceUrl(__ENV, 'trade-imports-ins-backend'),
  referenceData: resolveServiceUrl(__ENV, 'trade-imports-reference-data'),
  tradeImportsStub: resolveServiceUrl(__ENV, 'trade-imports-stub'),
  defraIdStub: resolveServiceUrl(__ENV, 'trade-imports-defra-id-stub'),
  gateway: resolveServiceUrl(__ENV, 'trade-imports-dynamics-gateway')
}

const settings = { model, scenarioLength, environment, stubProfile }

export const options = {
  scenarios: peakDayScenarios(model),
  thresholds: {
    ...peakDayThresholds(PEAK_DAY_SCENARIOS),
    ...eventingReportThresholds(),
    ...backgroundVolumeReportThresholds(DATASTORES),
    ...stubProfileReportThresholds(STUBBED_INTEGRATIONS),
    ...stubHeadroomReportThresholds(STUBBED_INTEGRATIONS),
    ...runEnvironmentReportThresholds(environment)
  },
  setupTimeout: SETUP_TIMEOUT,
  teardownTimeout: SETUP_TIMEOUT,
  tags: {
    environment,
    stub_profile: stubProfile ?? 'as-reported',
    scenario_length: scenarioLength,
    shape: 'peak-day'
  }
}

export function setup() {
  console.log(peakDayLine(settings))
  console.log(backendRouteLine(__ENV))

  const caveat = standInCaveat(environment)

  if (caveat) {
    console.log(caveat)
  }

  console.log(documentScanAllowanceLine())
  console.log(`Traffic model: ${JSON.stringify(model)}`)
  recordRunEnvironment(environment)
  waitForReadiness({ urls, localhostAlias, credentials })

  const stubProfiles = readStubProfiles({ urls })

  reportStubProfiles(stubProfiles, 'start', new Date())
  requireStubProfiles(stubProfiles, stubProfile)
  clearStubAnswered({ urls })

  const stubLoadSince = Date.now()

  console.log(indexesBuiltLine())
  ensurePerfAddress({
    insUrl: urls.ins,
    localhostAlias,
    credentials,
    address: PERF_ADDRESS
  })

  const volume = measureBackgroundVolume({
    urls,
    localhostAlias,
    credentials
  })

  reportBackgroundVolume(volume, model.backgroundVolume, 'start')

  if (!isScriptCheck(environment)) {
    requireBackgroundVolume(volume, model.backgroundVolume)
  }

  return {
    addressName: PERF_ADDRESS.name,
    stubLoadSince,
    eventingStart: readEventingStart({ urls })
  }
}

export function teardown(data) {
  try {
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

export function handleSummary(data) {
  const report = peakDayReport({
    metrics: data.metrics,
    run: {
      line: peakDayLine(settings),
      environment,
      stubProfile: stubProfile ?? 'as-reported',
      scenarioLength
    },
    scenarios: Object.keys(PEAK_DAY_SCENARIOS)
  })
  const files = { stdout: peakDayText({ report, metrics: data.metrics }) }
  const directory = __ENV.REPORTS_DIR

  if (directory) {
    files[`${directory}/peak-day.json`] = JSON.stringify(report, null, 2)
  }

  return files
}
