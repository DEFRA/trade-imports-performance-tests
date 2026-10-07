import exec from 'k6/execution'
import { Counter } from 'k6/metrics'

import { DATASTORES, indexesBuiltLine } from '../config/background-volume.js'
import {
  FAULT_CONTROL_SCENARIO,
  REFERENCE_DATA_WATCH_SCENARIO,
  REPORTED_PHASES,
  RETURNING_SCENARIOS,
  SCENARIO_LENGTH_PROFILES,
  SHAPES,
  averageLoadProfileLine,
  combinedProfileLine,
  confirmsArrivals,
  designTargetScenarios,
  enduranceProfileLine,
  enduranceRunSeconds,
  eventingWatchScenario,
  eventingWindow,
  faultControlScenario,
  isScriptCheck,
  localRunLine,
  phaseSchedule,
  referenceDataWatchScenario,
  requiredStubProfileFor,
  resiliencePhases,
  resolveScenarioLength,
  runLine,
  scenarioSchedules,
  scenarioSetForShape,
  spikeProfileLine,
  watchesDeadLetters,
  watchesEventing,
  watchesReferenceData
} from '../config/design-target.js'
import { mixTargetLine } from '../config/request-mix.js'
import {
  IDENTITY,
  JOURNEYS,
  PERF_ADDRESS,
  SCENARIOS,
  SETUP_TIMEOUT,
  notificationSplits,
  resolvePassword
} from '../config/smoke.js'
import {
  resilienceProfileLine,
  resolveResilienceFaults
} from '../config/resilience.js'
import { resolveRecordedCeilings } from '../config/stub-ceilings.js'
import { STUBBED_INTEGRATIONS } from '../config/stub-profiles.js'
import {
  backgroundVolumeReportThresholds,
  combinedReportThresholds,
  designTargetReportThresholds,
  designTargetThresholds,
  documentScanThresholds,
  eventingReportThresholds,
  hourlyReportThresholds,
  notificationSplitThresholds,
  reauthenticationReportThresholds,
  resilienceReportThresholds,
  stubHeadroomReportThresholds,
  stubProfileReportThresholds
} from '../config/thresholds.js'
import {
  documentScanAllowanceLine,
  standInCaveat
} from '../config/test-data.js'
import {
  resolveEnvironment,
  resolveLocalhostAlias,
  resolveServiceUrl,
  resolveToxiproxyUrl
} from '../config/target.js'
import { resolveTrafficModel } from '../config/traffic.js'
import {
  designTargetHtml,
  designTargetReport,
  designTargetText,
  failedComparisonLines,
  readModelLine
} from '../lib/design-target-summary.js'
import { failedResilienceLines } from '../lib/resilience.js'
import {
  resilienceHtml,
  resilienceReport,
  resilienceText
} from '../lib/resilience-summary.js'
import {
  measureBackgroundVolume,
  reportBackgroundVolume,
  requireBackgroundVolume
} from './background-volume.js'
import { readDeadLetterCount, reportDeadLetters } from './dead-letters.js'
import {
  readEventingStart,
  reportEventCounts,
  reportEventingWatchSetup,
  watchEventing
} from './eventing.js'
import {
  addressBookSession,
  dashboardOnlySession,
  ensurePerfAddress
} from './front-door.js'
import { HIGH_RISK_PLANTS_STEPS } from './high-risk-plants.js'
import { notificationJourney } from './journeys.js'
import { LIVE_ANIMALS_STEPS } from './live-animals.js'
import { markPhase, usePhaseSchedule } from './phase.js'
import { waitForReadiness } from './readiness.js'
import { watchReferenceData } from './reference-data.js'
import { clearEveryFault, controlFaults, prepareFaults } from './resilience.js'
import { returningVisit } from './returning-session.js'
import { reportStubHeadroom } from './stub-ceilings.js'
import {
  clearStubAnswered,
  readStubProfiles,
  reportStubProfiles,
  requireStubProfiles
} from './stub-profiles.js'

const SUMMARY_TREND_STATS = [
  'count',
  'avg',
  'min',
  'med',
  'max',
  'p(90)',
  'p(95)',
  'p(99)'
]

const resolveRun = ({ shape, env }) => {
  const environment = resolveEnvironment(env)
  const scenarioLength = resolveScenarioLength(env, environment)
  const stubProfile = requiredStubProfileFor(env, environment)
  const model = resolveTrafficModel(
    env,
    SCENARIO_LENGTH_PROFILES[scenarioLength]
  )
  const scenarioSet = scenarioSetForShape({ shape })
  const faults = shape === SHAPES.RESILIENCE ? resolveResilienceFaults(env) : []
  const schedule = phaseSchedule({
    shape,
    model,
    scenarioNames: Object.keys(SCENARIOS),
    faults
  })

  return {
    environment,
    scenarioLength,
    stubProfile,
    model,
    scenarioSet,
    faults,
    schedule,
    schedules: scenarioSchedules({ shape, schedule, model, scenarioSet })
  }
}

const resolveUrls = (env) => {
  const animals = JOURNEYS['live-animals']
  const plants = JOURNEYS['high-risk-plants']

  return {
    ins: resolveServiceUrl(env, 'trade-imports-ins-frontend'),
    animalsFrontend: resolveServiceUrl(env, animals.frontend),
    plantsFrontend: resolveServiceUrl(env, plants.frontend),
    animalsBackend: resolveServiceUrl(env, animals.backend),
    plantsBackend: resolveServiceUrl(env, plants.backend),
    insBackend: resolveServiceUrl(env, 'trade-imports-ins-backend'),
    referenceData: resolveServiceUrl(env, 'trade-imports-reference-data'),
    tradeImportsStub: resolveServiceUrl(env, 'trade-imports-stub'),
    defraIdStub: resolveServiceUrl(env, 'trade-imports-defra-id-stub'),
    gateway: resolveServiceUrl(env, 'trade-imports-dynamics-gateway')
  }
}

const reportedPhasesOf = ({ shape, run }) =>
  shape === SHAPES.RESILIENCE
    ? resiliencePhases(run.schedule)
    : REPORTED_PHASES[shape]

const thresholdsFor = ({ shape, run }) => ({
  ...(shape === SHAPES.AVERAGE_LOAD
    ? hourlyReportThresholds({
        scenarioSet: run.scenarioSet,
        phases: reportedPhasesOf({ shape, run })
      })
    : designTargetReportThresholds({
        scenarioSet: run.scenarioSet,
        phases: reportedPhasesOf({ shape, run })
      })),
  ...(shape === SHAPES.RESILIENCE
    ? resilienceReportThresholds({
        scenarioSet: run.scenarioSet,
        phases: reportedPhasesOf({ shape, run }),
        faults: run.faults
      })
    : {}),
  ...(shape === SHAPES.COMBINED
    ? combinedReportThresholds({
        scenarioSet: run.scenarioSet,
        phases: REPORTED_PHASES[shape]
      })
    : {}),
  ...designTargetThresholds({ shape, scenarioSet: run.scenarioSet }),
  ...(shape === SHAPES.ENDURANCE ? reauthenticationReportThresholds() : {}),
  ...documentScanThresholds('live-animals'),
  ...eventingReportThresholds(),
  ...notificationSplitThresholds(notificationSplits(run.model)),
  ...backgroundVolumeReportThresholds(DATASTORES),
  ...stubProfileReportThresholds(STUBBED_INTEGRATIONS),
  ...stubHeadroomReportThresholds(STUBBED_INTEGRATIONS)
})

/**
 * Builds a design-target run: the options, set-up, tear-down, summary and exec
 * functions a suite file re-exports.
 *
 * The shape (sustained peak, P99 burst, average load, spike and recovery,
 * endurance, combined or resilience) and the run length come from configuration, so
 * a suite is the import and the re-exports only.
 * Run it at k6's init stage: it reads the environment and resolves the model.
 *
 * @param {object} options - The run.
 * @param {string} options.shape - A value of `SHAPES`.
 * @param {Record<string, string | undefined>} options.env - k6's `__ENV`.
 * @returns {Record<string, Function | object>} `options`, `setup`, `teardown`, `handleSummary` and the exec functions.
 */
export const createDesignTargetRun = ({ shape, env }) => {
  const run = resolveRun({ shape, env })
  const { environment, model, schedule, stubProfile } = run
  const ceilings = resolveRecordedCeilings(env, environment)
  const localhostAlias = resolveLocalhostAlias(env)
  const toxiproxyUrl = resolveToxiproxyUrl(env, environment)
  const credentials = { crn: IDENTITY.crn, password: resolvePassword(env) }
  const staleRedirects = new Counter('stale_concurrency_redirects')
  const urls = resolveUrls(env)
  const animals = JOURNEYS['live-animals']
  const plants = JOURNEYS['high-risk-plants']
  const returningBaseUrls = {
    'returning-ins': urls.ins,
    'returning-animals': urls.animalsFrontend,
    'returning-plants': urls.plantsFrontend
  }
  const settings = {
    shape,
    scenarioLength: run.scenarioLength,
    environment,
    stubProfile,
    model,
    faults: run.faults
  }

  const options = {
    scenarios: {
      ...designTargetScenarios({
        shape,
        model,
        scenarioSet: run.scenarioSet,
        schedule
      }),
      ...(watchesEventing(shape)
        ? { 'eventing-watch': eventingWatchScenario({ schedule }) }
        : {}),
      ...(watchesReferenceData(shape)
        ? {
            [REFERENCE_DATA_WATCH_SCENARIO]: referenceDataWatchScenario({
              model,
              schedule
            })
          }
        : {}),
      ...(shape === SHAPES.RESILIENCE
        ? { [FAULT_CONTROL_SCENARIO]: faultControlScenario({ schedule }) }
        : {})
    },
    thresholds: thresholdsFor({ shape, run }),
    summaryTrendStats: SUMMARY_TREND_STATS,
    setupTimeout: SETUP_TIMEOUT,
    teardownTimeout: SETUP_TIMEOUT,
    tags: {
      environment,
      stub_profile: stubProfile ?? 'as-reported',
      scenario_length: run.scenarioLength,
      shape
    }
  }

  const logRunSettings = () => {
    console.log(runLine(settings))

    if (shape === SHAPES.COMBINED) {
      console.log(combinedProfileLine({ model, scenarioSet: run.scenarioSet }))
    }

    if (shape === SHAPES.AVERAGE_LOAD) {
      console.log(averageLoadProfileLine(model))
    }

    if (shape === SHAPES.SPIKE_RECOVERY) {
      console.log(spikeProfileLine({ model, scenarioSet: run.scenarioSet }))
    }

    if (shape === SHAPES.ENDURANCE) {
      console.log(
        enduranceProfileLine({
          model,
          runSeconds: enduranceRunSeconds(schedule)
        })
      )
    }

    if (shape === SHAPES.RESILIENCE) {
      console.log(resilienceProfileLine({ model, faults: run.faults }))
    }

    console.log(`Traffic model: ${JSON.stringify(model)}`)
    console.log(mixTargetLine(model))
    console.log(documentScanAllowanceLine())

    const caveat = standInCaveat(environment)

    if (caveat) {
      console.log(caveat)
    }

    if (isScriptCheck(environment)) {
      console.log(localRunLine({ stubProfile }))
    }

    if (watchesEventing(shape)) {
      reportEventingWatchSetup({ window: eventingWindow({ shape, schedule }) })
    }
  }

  const setup = () => {
    logRunSettings()
    waitForReadiness({ urls, localhostAlias, credentials })

    const stubProfiles = readStubProfiles({ urls })

    reportStubProfiles(stubProfiles, 'start', new Date())
    requireStubProfiles(stubProfiles, stubProfile)
    clearStubAnswered({ urls })

    const faultHosts =
      shape === SHAPES.RESILIENCE
        ? prepareFaults({ urls, toxiproxyUrl, environment })
        : null
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

    if (shape === SHAPES.COMBINED) {
      console.log(readModelLine({ volume }))
    }

    return {
      addressName: PERF_ADDRESS.name,
      faultHosts,
      stubLoadSince,
      deadLettersAtStart: watchesDeadLetters(shape)
        ? readDeadLetterCount({ urls })
        : null,
      eventingStart: confirmsArrivals(shape)
        ? readEventingStart({ urls })
        : null
    }
  }

  const teardown = (data) => {
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
      if (shape === SHAPES.RESILIENCE) {
        clearEveryFault({ urls, toxiproxyUrl })
      }

      if (watchesDeadLetters(shape)) {
        reportDeadLetters({
          before: data.deadLettersAtStart,
          after: readDeadLetterCount({ urls })
        })
      }

      if (data.eventingStart !== null) {
        reportEventCounts({ urls, start: data.eventingStart })
      }
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
    confirmsEventArrival: confirmsArrivals(shape),
    insBackendUrl: urls.insBackend
  })

  const scheduled = (name, work) => (data) => {
    usePhaseSchedule(run.schedules[name])
    work(data)
  }

  const returning = (name) =>
    scheduled(name, () =>
      returningVisit({
        scenario: name,
        entry: RETURNING_SCENARIOS[name],
        baseUrl: returningBaseUrls[name],
        model,
        credentials,
        localhostAlias,
        staleRedirects
      })
    )

  const resilienceSummary = (data) => {
    const report = resilienceReport({
      metrics: data.metrics,
      ...settings,
      schedule,
      scenarioSet: run.scenarioSet
    })
    const files = { stdout: resilienceText(report, data.metrics) }
    const directory = env.REPORTS_DIR

    if (!directory) {
      return files
    }

    files[`${directory}/resilience.json`] = JSON.stringify(report, null, 2)
    files[`${directory}/resilience.html`] = resilienceHtml(report)

    if (report.failed) {
      files[`${directory}/relative-thresholds-failed.txt`] =
        `${failedResilienceLines(report).join('\n')}\n`
    }

    return files
  }

  const handleSummary = (data) => {
    if (shape === SHAPES.RESILIENCE) {
      return resilienceSummary(data)
    }

    const report = designTargetReport({
      metrics: data.metrics,
      ...settings,
      schedule,
      scenarioSet: run.scenarioSet
    })
    const files = { stdout: designTargetText(report, data.metrics) }
    const directory = env.REPORTS_DIR

    if (!directory) {
      return files
    }

    files[`${directory}/design-target.json`] = JSON.stringify(report, null, 2)
    files[`${directory}/design-target.html`] = designTargetHtml(report)

    if (report.relativeFailed) {
      files[`${directory}/relative-thresholds-failed.txt`] =
        `${failedComparisonLines(report).join('\n')}\n`
    }

    return files
  }

  return {
    options,
    setup,
    teardown,
    handleSummary,
    liveAnimals: scheduled('live-animals', (data) =>
      notificationJourney(
        journeyOptions({
          journey: animals,
          steps: LIVE_ANIMALS_STEPS,
          frontend: urls.animalsFrontend,
          backend: urls.animalsBackend,
          data
        })
      )
    ),
    highRiskPlants: scheduled('high-risk-plants', (data) =>
      notificationJourney(
        journeyOptions({
          journey: plants,
          steps: HIGH_RISK_PLANTS_STEPS,
          frontend: urls.plantsFrontend,
          backend: urls.plantsBackend,
          data
        })
      )
    ),
    insFrontDoor: scheduled('ins-front-door', () =>
      dashboardOnlySession(frontDoorOptions())
    ),
    insAddressBook: scheduled('ins-address-book', () =>
      addressBookSession(frontDoorOptions())
    ),
    eventingWatch: () =>
      watchEventing({
        urls,
        window: eventingWindow({ shape, schedule })
      }),
    referenceDataWatch: () => {
      usePhaseSchedule(run.schedule)
      markPhase()
      watchReferenceData({ urls })
    },
    faultControl: (data) =>
      controlFaults({
        urls,
        toxiproxyUrl,
        schedule,
        faults: run.faults,
        model,
        hosts: data.faultHosts,
        environment
      }),
    returningIns: returning('returning-ins'),
    returningAnimals: returning('returning-animals'),
    returningPlants: returning('returning-plants')
  }
}
