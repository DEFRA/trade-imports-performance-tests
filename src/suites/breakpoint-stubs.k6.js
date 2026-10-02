import exec from 'k6/execution'

import {
  ceilingScenarios,
  resolveCeilingGroups,
  resolveCeilingModel,
  resolveDefraIdClient
} from '../config/stub-ceilings.js'
import { IDENTITY, SETUP_TIMEOUT, resolvePassword } from '../config/smoke.js'
import {
  SLA_PROFILE,
  STUBBED_INTEGRATIONS,
  resolveRequiredStubProfile
} from '../config/stub-profiles.js'
import {
  signInTargetThresholds,
  stubCeilingStepThresholds,
  stubProfileReportThresholds
} from '../config/thresholds.js'
import { resolveEnvironment, resolveServiceUrl } from '../config/target.js'
import { ceilingSummaryText } from '../lib/stub-ceilings.js'
import { effectiveProfile } from '../lib/stub-profiles.js'
import {
  defraIdSignIn as signInThroughDefraId,
  mdmCall as askMdm,
  tradeTokenCall as askTradeToken
} from '../k6/stub-ceilings.js'
import {
  clearStubAnswered,
  readStubProfiles,
  reportStubProfiles,
  requireStubProfiles
} from '../k6/stub-profiles.js'

const environment = resolveEnvironment(__ENV)
const requiredStubProfile = resolveRequiredStubProfile(__ENV) ?? SLA_PROFILE
const credentials = {
  crn: IDENTITY.crn,
  password: resolvePassword(__ENV)
}
const model = resolveCeilingModel(__ENV)
const groups = resolveCeilingGroups(__ENV)
const { scenarios, stepScenarios, ladders } = ceilingScenarios(model, groups)
const client = resolveDefraIdClient(__ENV)
const urls = {
  tradeImportsStub: resolveServiceUrl(__ENV, 'trade-imports-stub'),
  defraIdStub: resolveServiceUrl(__ENV, 'trade-imports-defra-id-stub')
}

const targetThresholds = groups.includes('defra-id-target')
  ? signInTargetThresholds({
      gating: ['defra-id-target-two-journeys'],
      reporting: ['defra-id-target-with-iuu']
    })
  : {}

export const options = {
  scenarios,
  thresholds: {
    ...stubCeilingStepThresholds(stepScenarios),
    ...targetThresholds,
    ...stubProfileReportThresholds(STUBBED_INTEGRATIONS)
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  setupTimeout: SETUP_TIMEOUT,
  tags: { environment, stub_profile: requiredStubProfile }
}

const profilesOf = (entries) =>
  Object.fromEntries(
    entries
      .filter((entry) => entry.stub !== null)
      .map((entry) => [
        entry.integration,
        {
          profile: effectiveProfile(entry),
          fittedP95Ms: entry.fitted?.p95Ms ?? 0
        }
      ])
  )

export function setup() {
  console.log(
    `Stub ceiling run in ${environment}, requiring stub profile ${requiredStubProfile}, groups ${groups.join(', ')}`
  )

  const entries = readStubProfiles({ urls })

  reportStubProfiles(entries, 'start', new Date())
  requireStubProfiles(entries, requiredStubProfile)
  clearStubAnswered({ urls })

  return { profiles: profilesOf(entries) }
}

export function tradeTokenCall() {
  askTradeToken({ urls, timeout: model.requestTimeout })
}

export function mdmCall() {
  askMdm({
    urls,
    timeout: model.requestTimeout,
    iteration: exec.scenario.iterationInTest
  })
}

const signIn = (signOut) =>
  signInThroughDefraId({
    urls,
    client,
    credentials,
    timeout: model.requestTimeout,
    signOut
  })

export function defraIdSignIn() {
  signIn(false)
}

export function defraIdSignInAndOut() {
  signIn(true)
}

export function teardown() {
  reportStubProfiles(readStubProfiles({ urls }), 'end', new Date())
}

const today = () => new Date().toISOString().slice(0, 10)

export function handleSummary(data) {
  return {
    stdout: ceilingSummaryText({
      metrics: data.metrics,
      setupData: data.setup_data,
      ladders,
      groups,
      environment,
      measured: today()
    })
  }
}
