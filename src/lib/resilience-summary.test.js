import { describe, expect, test } from 'vitest'

import {
  SCENARIO_LENGTH_PROFILES,
  SHAPES,
  phaseSchedule,
  scenarioSetForShape
} from '../config/design-target.js'
import { FAULT_CATALOGUE, INJECTION_CODES } from '../config/resilience.js'
import { SCENARIOS } from '../config/smoke.js'
import { subMetricKey } from '../config/thresholds.js'
import { resolveTrafficModel } from '../config/traffic.js'
import { failedResilienceLines } from './resilience.js'
import {
  resilienceHtml,
  resilienceReport,
  resilienceText
} from './resilience-summary.js'

const WATCH = 'reference-data-watch'
const model = resolveTrafficModel({}, SCENARIO_LENGTH_PROFILES.local)
const scenarioSet = scenarioSetForShape({ shape: SHAPES.RESILIENCE })
const MDM_ERROR = FAULT_CATALOGUE.find(({ id }) => id === 'mdm-error')
const DEFRA_ID_ERROR = FAULT_CATALOGUE.find(({ id }) => id === 'defra-id-error')
const faults = [DEFRA_ID_ERROR, MDM_ERROR]
const schedule = phaseSchedule({
  shape: SHAPES.RESILIENCE,
  model,
  scenarioNames: Object.keys(SCENARIOS),
  faults
})

const ascending = (earlier, later) => earlier - later

const entry = (metric, tags, values) => ({
  [subMetricKey(metric, tags)]: { values }
})

const injectedMdmError = ({ maxMs = 812, failedRate = 0.47 } = {}) => ({
  ...entry(
    'fault_injection_applied',
    { fault: 'mdm-error' },
    { value: INJECTION_CODES.APPLIED }
  ),
  ...entry(
    'fault_injection_applied',
    { fault: 'defra-id-error' },
    {
      value: INJECTION_CODES.STUB_PREDATES_FAULTS
    }
  ),
  ...entry(
    'stub_requests',
    { integration: 'mdm', phase: 'fault-mdm-error' },
    { count: 31 }
  ),
  ...entry(
    'stub_requests',
    { integration: 'mdm', phase: 'baseline' },
    { count: 30 }
  ),
  ...entry(
    'stub_faults_injected',
    { integration: 'mdm', phase: 'fault-mdm-error' },
    { count: 14 }
  ),
  ...entry(
    'http_req_duration',
    { endpoint: 'reference-data-countries-uncached', phase: 'fault-mdm-error' },
    { count: 30 }
  ),
  ...entry(
    'http_req_duration',
    { endpoint: 'reference-data-countries-uncached', phase: 'baseline' },
    { count: 30 }
  ),
  ...entry(
    'http_req_duration',
    { scenario: WATCH, kind: 'api', phase: 'fault-mdm-error' },
    { count: 31, max: maxMs, 'p(95)': maxMs }
  ),
  ...entry(
    'http_req_failed',
    { scenario: WATCH, phase: 'fault-mdm-error' },
    { rate: failedRate }
  ),
  ...entry(
    'transport_errors',
    { scenario: WATCH, phase: 'fault-mdm-error' },
    { count: 0 }
  )
})

const reportFor = (metrics) =>
  resilienceReport({
    metrics,
    shape: SHAPES.RESILIENCE,
    scenarioLength: 'local',
    environment: 'local',
    stubProfile: 'zero-delay',
    schedule,
    scenarioSet,
    model,
    faults
  })

describe('resilienceReport', () => {
  test('reports one injected and one not-injected fault', () => {
    const report = reportFor(injectedMdmError())
    const [defraId, mdm] = report.faults

    expect(defraId).toMatchObject({
      id: 'defra-id-error',
      injected: {
        applied: false,
        reason: 'the stub predates fault injection (GET /faults answered 404)'
      },
      wait: {
        verdict: 'not judged',
        reason:
          'not injected (the stub predates fault injection (GET /faults answered 404))'
      }
    })
    expect(defraId.lines).toEqual({
      fault:
        'Fault not injected: defra-id-error: the stub predates fault injection (GET /faults answered 404); nothing judged'
    })
    expect(mdm).toMatchObject({
      id: 'mdm-error',
      callers: 'reference-data',
      injected: { applied: true, requests: 31, count: 14 },
      wait: { verdict: 'bounded' },
      outcome: { verdict: 'failed cleanly' }
    })
    expect(mdm.lines.fault).toBe(
      'Fault mdm-error (reference-data): injected 14 of 31 requests at the stub'
    )
  })

  test('names the run, its environment and stub profile', () => {
    const report = reportFor(injectedMdmError())

    expect(report.run).toMatchObject({
      shape: 'resilience',
      environment: 'local',
      stubProfile: 'zero-delay'
    })
    expect(report.run.line).toContain(
      'Design-target run: resilience, local length'
    )
    expect(report.run.profileLine).toContain(
      'Resilience: 2 faults (defra-id-error, mdm-error)'
    )
  })

  test('has failed true only when a verdict fails', () => {
    expect(reportFor(injectedMdmError({ maxMs: 812 })).failed).toBe(false)
    expect(reportFor(injectedMdmError({ maxMs: 60_000 })).failed).toBe(true)
  })

  test('judges nothing for a fault that was not injected', () => {
    const report = reportFor({})

    expect(report.failed).toBe(false)
    expect(failedResilienceLines(report)).toEqual([])
  })

  test('writes every failing verdict to the failed lines', () => {
    const report = reportFor(injectedMdmError({ maxMs: 60_000, failedRate: 1 }))

    expect(failedResilienceLines(report)).toContain(
      'Bounded wait mdm-error (reference-data): slowest 60000ms against 30000ms: UNBOUNDED'
    )
  })
})

describe('resilienceText', () => {
  test('starts with the run and profile lines and ends with the threshold lines', () => {
    const metrics = {
      ...injectedMdmError(),
      http_req_failed: { thresholds: { 'rate>=0': { ok: true } } }
    }
    const lines = resilienceText(reportFor(metrics), metrics)
      .trimEnd()
      .split('\n')

    expect(lines[0]).toContain('Design-target run: resilience')
    expect(lines[1]).toContain('Resilience: 2 faults')
    expect(lines.at(-1)).toBe('Threshold http_req_failed rate>=0: passed')
  })

  test('puts each fault lines in the order of the criteria, then the outcome', () => {
    const text = resilienceText(
      reportFor(injectedMdmError()),
      injectedMdmError()
    )
    const lines = text.split('\n')
    const order = [
      'Fault not injected: defra-id-error',
      'Fault mdm-error',
      'Bounded wait mdm-error',
      'Bounded retries mdm-error',
      'Failure mdm-error',
      'Recovery mdm-error',
      'Cascade mdm-error',
      'Resilience: passed'
    ].map((prefix) => lines.findIndex((line) => line.startsWith(prefix)))

    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort(ascending)).toEqual(order)
  })

  test('says passed and how many faults were not injected', () => {
    const text = resilienceText(reportFor(injectedMdmError()), {})

    expect(text).toContain(
      'Resilience: passed (1 of 2 faults were not injected, nothing judged for them)'
    )
  })

  test('says FAILED naming each failing criterion', () => {
    const metrics = injectedMdmError({ maxMs: 60_000, failedRate: 1 })
    const text = resilienceText(reportFor(metrics), metrics)

    expect(text).toContain(
      'Resilience: FAILED: mdm-error wait; mdm-error failure'
    )
  })
})

describe('resilienceHtml', () => {
  test('shows a Faults table then an Endpoints table', () => {
    const html = resilienceHtml(reportFor(injectedMdmError()))

    expect(html.indexOf('<h2>Faults</h2>')).toBeGreaterThan(-1)
    expect(html.indexOf('<h2>Endpoints</h2>')).toBeGreaterThan(
      html.indexOf('<h2>Faults</h2>')
    )
    expect(html).toContain('not injected (the stub predates fault injection')
  })

  test('escapes values', () => {
    const report = reportFor(injectedMdmError())
    const hostile = {
      ...report,
      run: {
        ...report.run,
        line: '<script>alert(1)</script>',
        environment: '<b>'
      }
    }
    const html = resilienceHtml(hostile)

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<b>')
  })
})
