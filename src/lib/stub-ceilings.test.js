import { describe, expect, test } from 'vitest'

import { resolveRecordedCeilings } from '../config/stub-ceilings.js'
import {
  absoluteLocationOrNull,
  ceilingFrom,
  ceilingLine,
  ceilingRpsFor,
  ceilingSummaryText,
  ceilingsRecordedLine,
  codeFromLocation,
  distortionLine,
  headroomLine,
  headroomVerdict,
  latencyLimitMs,
  loadOf,
  sharedStubDistortions,
  signInCeilingLine,
  signInCompleted,
  signInTargetLine,
  stepLine,
  stepVerdict,
  trustLine
} from './stub-ceilings.js'

const stepMetrics = (
  scenario,
  { failed = 0, checks = 1, dropped = 0, p95 = 3 } = {}
) => ({
  [`http_req_failed{scenario:${scenario}}`]: { values: { rate: failed } },
  [`checks{scenario:${scenario}}`]: { values: { rate: checks } },
  [`dropped_iterations{scenario:${scenario}}`]: { values: { count: dropped } },
  [`http_req_duration{scenario:${scenario},profiled:yes}`]: {
    values: { 'p(95)': p95 }
  }
})

const verdict = (overrides = {}) =>
  stepVerdict({
    metrics: stepMetrics('step', overrides),
    scenario: 'step',
    latencyLimitMs: 200
  })

const held = {
  held: true,
  failedRate: 0,
  checksRate: 1,
  dropped: 0,
  p95Ms: 3,
  reason: 'held'
}
const broke = {
  held: false,
  failedRate: 0.041,
  checksRate: 0.99,
  dropped: 0,
  p95Ms: 9,
  reason: 'failed 4.10% of requests'
}

const mdmEntry = (answered, overrides = {}) => ({
  integration: 'mdm',
  stub: 'trade-imports-stub',
  profile: 'zero-delay',
  answered,
  ...overrides
})

const tokenEntry = (answered) =>
  mdmEntry(answered, { integration: 'trade-token' })

const ceiling = {
  rps: 400,
  atLeast: false,
  measured: '2026-10-02',
  source: 'a run'
}

describe('codeFromLocation', () => {
  test('reads the code of a redirect', () => {
    expect(codeFromLocation('http://x.invalid/auth?code=abc123&state=s1')).toBe(
      'abc123'
    )
  })

  test('is empty when there is no code', () => {
    expect(codeFromLocation('/organisations')).toBe('')
    expect(codeFromLocation(undefined)).toBe('')
  })
})

describe('absoluteLocationOrNull', () => {
  test('is null when the response sent no Location', () => {
    expect(absoluteLocationOrNull('http://stub:3200', undefined)).toBeNull()
    expect(absoluteLocationOrNull('http://stub:3200', '')).toBeNull()
  })

  test('is the absolute URL when there is a Location', () => {
    expect(absoluteLocationOrNull('http://stub:3200/a', '/b?c=1')).toBe(
      'http://stub:3200/b?c=1'
    )
  })
})

describe('signInCompleted', () => {
  const completed = {
    statusesAsExpected: true,
    keysStatus: 200,
    accessToken: 'token',
    signOut: true,
    signOutStatus: 302
  }

  test('passes when signing out redirected', () => {
    expect(signInCompleted(completed)).toBe(true)
  })

  test('fails when signing out answered anything but a redirect', () => {
    expect(signInCompleted({ ...completed, signOutStatus: 400 })).toBe(false)
  })

  test('fails when signing out was wanted but there was no token to do it with', () => {
    expect(
      signInCompleted({ ...completed, accessToken: '', signOutStatus: null })
    ).toBe(false)
  })

  test('ignores the sign-out when it was not wanted', () => {
    expect(
      signInCompleted({ ...completed, signOut: false, signOutStatus: null })
    ).toBe(true)
    expect(
      signInCompleted({ ...completed, signOut: false, signOutStatus: 400 })
    ).toBe(true)
  })

  test('fails when a step, the keys or the token is wrong', () => {
    expect(signInCompleted({ ...completed, statusesAsExpected: false })).toBe(
      false
    )
    expect(signInCompleted({ ...completed, keysStatus: 500 })).toBe(false)
    expect(
      signInCompleted({ ...completed, signOut: false, accessToken: '' })
    ).toBe(false)
  })
})

describe('stepVerdict', () => {
  test('holds when every rule is met', () => {
    expect(verdict()).toEqual(held)
  })

  test('breaks at 1% failed requests', () => {
    expect(verdict({ failed: 0.041 })).toMatchObject({
      held: false,
      reason: 'failed 4.10% of requests'
    })
  })

  test('breaks at exactly 1% failed requests and holds just under', () => {
    expect(verdict({ failed: 0.01 })).toMatchObject({
      held: false,
      reason: 'failed 1.00% of requests'
    })
    expect(verdict({ failed: 0.0099 }).held).toBe(true)
  })

  test('breaks at exactly 99% checks passed and holds just over', () => {
    expect(verdict({ checks: 0.99 })).toMatchObject({
      held: false,
      reason: 'checks passed 99.00%'
    })
    expect(verdict({ checks: 0.9901 }).held).toBe(true)
  })

  test('breaks when checks do not pass over 99%', () => {
    expect(verdict({ checks: 0.972 })).toMatchObject({
      held: false,
      reason: 'checks passed 97.20%'
    })
  })

  test('breaks on a dropped iteration', () => {
    expect(verdict({ dropped: 3 })).toMatchObject({
      held: false,
      reason: 'dropped 3 iterations'
    })
    expect(verdict({ dropped: 1 }).reason).toBe('dropped 1 iteration')
  })

  test('breaks when the p95 is over the limit', () => {
    expect(verdict({ p95: 712 })).toMatchObject({
      held: false,
      reason: 'p95 712ms over the 200ms limit'
    })
  })

  test('breaks when no request completed', () => {
    expect(
      stepVerdict({ metrics: {}, scenario: 'step', latencyLimitMs: 200 })
    ).toMatchObject({ held: false, reason: 'no requests completed' })
  })
})

describe('latencyLimitMs', () => {
  test('is the fitted p95 plus 200ms for sla', () => {
    expect(latencyLimitMs({ profile: 'sla', fittedP95Ms: 470 })).toBe(670)
  })

  test('is 200ms for zero-delay', () => {
    expect(latencyLimitMs({ profile: 'zero-delay', fittedP95Ms: 470 })).toBe(
      200
    )
  })
})

describe('ceilingFrom', () => {
  const steps = (...verdicts) =>
    verdicts.map((one, index) => ({ rate: (index + 1) * 100, verdict: one }))

  test('is the last step that held before the first that broke', () => {
    expect(ceilingFrom(steps(held, held, broke, held))).toEqual({
      rps: 200,
      atLeast: false,
      brokeAt: 300,
      brokeBecause: 'failed 4.10% of requests'
    })
  })

  test('is 0 when the first step broke', () => {
    expect(ceilingFrom(steps(broke, held))).toMatchObject({
      rps: 0,
      atLeast: false,
      brokeAt: 100
    })
  })

  test('is at least the top step when every step held', () => {
    expect(ceilingFrom(steps(held, held))).toEqual({
      rps: 200,
      atLeast: true,
      brokeAt: null,
      brokeBecause: null
    })
  })
})

describe('ceilingRpsFor', () => {
  test('counts three profiled requests a sign-in for defra-id', () => {
    expect(ceilingRpsFor('defra-id', 16)).toBe(48)
  })

  test('is the rate itself for the Java stub', () => {
    expect(ceilingRpsFor('mdm', 400)).toBe(400)
  })
})

describe('stepLine', () => {
  test('states a step that held', () => {
    expect(stepLine({ integration: 'mdm', rate: 200, verdict: held })).toBe(
      'Stub ceiling step: mdm 200 requests a second: held (failed 0.00%, checks 100.00%, p95 3ms, dropped 0)'
    )
  })

  test('states a step that broke, in sign-ins for defra-id', () => {
    expect(
      stepLine({ integration: 'defra-id', rate: 24, verdict: broke })
    ).toBe(
      'Stub ceiling step: defra-id 24 sign-ins a second: broke: failed 4.10% of requests (failed 4.10%, checks 99.00%, p95 9ms, dropped 0)'
    )
  })

  test('states a step with no requests', () => {
    expect(
      stepLine({
        integration: 'mdm',
        rate: 10,
        verdict: {
          held: false,
          failedRate: null,
          checksRate: null,
          dropped: 0,
          p95Ms: null,
          reason: 'no requests completed'
        }
      })
    ).toBe('Stub ceiling step: mdm 10 requests a second: no requests completed')
  })
})

describe('ceilingLine', () => {
  const where = {
    integration: 'mdm',
    stub: 'trade-imports-stub',
    profile: 'zero-delay',
    environment: 'local'
  }

  test('states a ceiling and where it broke', () => {
    expect(
      ceilingLine({
        ...where,
        ceiling: {
          rps: 400,
          atLeast: false,
          brokeAt: 600,
          brokeBecause: 'failed 4.10% of requests'
        }
      })
    ).toBe(
      'Stub ceiling: mdm (trade-imports-stub, zero-delay, local) 400 requests a second; broke at 600: failed 4.10% of requests'
    )
  })

  test('says to raise the ladder when every step held', () => {
    expect(
      ceilingLine({
        ...where,
        ceiling: { rps: 800, atLeast: true, brokeAt: null, brokeBecause: null }
      })
    ).toBe(
      'Stub ceiling: mdm (trade-imports-stub, zero-delay, local) at least 800 requests a second: every step held, so raise the ladder'
    )
  })

  test('says when the first step broke', () => {
    expect(
      ceilingLine({
        ...where,
        ceiling: {
          rps: 0,
          atLeast: false,
          brokeAt: 10,
          brokeBecause: 'dropped 4 iterations'
        }
      })
    ).toBe(
      'Stub ceiling: mdm (trade-imports-stub, zero-delay, local) below 10 requests a second: the first step broke: dropped 4 iterations'
    )
  })

  test('adds the sign-ins a second for defra-id', () => {
    expect(
      ceilingLine({
        integration: 'defra-id',
        stub: 'trade-imports-defra-id-stub',
        profile: 'zero-delay',
        environment: 'local',
        ceiling: {
          rps: 16,
          atLeast: false,
          brokeAt: 24,
          brokeBecause: 'dropped 9 iterations'
        }
      })
    ).toBe(
      'Stub ceiling: defra-id (trade-imports-defra-id-stub, zero-delay, local) 48 requests a second (16 sign-ins a second); broke at 24: dropped 9 iterations'
    )
  })
})

describe('ceilingsRecordedLine', () => {
  test('prints each ceiling in requests a second, ready to paste', () => {
    expect(
      ceilingsRecordedLine({
        ceilings: {
          mdm: { profile: 'zero-delay', rps: 400, atLeast: false },
          'defra-id': { profile: 'zero-delay', rps: 16, atLeast: true }
        },
        measured: '2026-10-02',
        environment: 'local',
        groups: ['mdm', 'defra-id']
      })
    ).toBe(
      'Stub ceilings recorded: {"mdm":{"zero-delay":{"rps":400,"atLeast":false,"measured":"2026-10-02","source":"breakpoint-stubs run in local, groups mdm, defra-id"}},"defra-id":{"zero-delay":{"rps":48,"atLeast":true,"measured":"2026-10-02","source":"breakpoint-stubs run in local, groups mdm, defra-id"}}}'
    )
  })

  test('prints an object that passes validation as printed', () => {
    const printed = ceilingsRecordedLine({
      ceilings: {
        mdm: { profile: 'zero-delay', rps: 400, atLeast: false },
        'defra-id': { profile: 'zero-delay', rps: 16, atLeast: true }
      },
      measured: '2026-10-02',
      environment: 'perf-test',
      groups: ['mdm', 'defra-id']
    }).replace('Stub ceilings recorded: ', '')

    expect(() =>
      resolveRecordedCeilings({ STUB_CEILINGS: printed }, 'perf-test')
    ).not.toThrow()
  })
})

describe('signInCeilingLine', () => {
  test('says there is headroom for both targets', () => {
    expect(signInCeilingLine(16, false)).toBe(
      'Defra ID ceiling 16 sign-ins a second against 5.11 needed (two journeys) and 5.43 (with IUU): headroom for both'
    )
  })

  test('says to change the session store when short of the two-journey need', () => {
    expect(signInCeilingLine(3, false)).toBe(
      'Defra ID ceiling 3 sign-ins a second, short of the 5.11 needed (two journeys): change the session store (c-010)'
    )
  })

  test('says when only the with-IUU figure is short', () => {
    expect(signInCeilingLine(5.2, false)).toBe(
      'Defra ID ceiling 5.2 sign-ins a second: headroom for two journeys, short of the 5.43 with IUU (reported, not gated)'
    )
  })

  test('says at least when every step held', () => {
    expect(signInCeilingLine(32, true)).toContain(
      'Defra ID ceiling at least 32 sign-ins a second'
    )
  })
})

describe('signInTargetLine', () => {
  test('states a target the stub carried', () => {
    expect(
      signInTargetLine({
        label: 'two journeys',
        perHour: 400,
        verdict: { ...held, p95Ms: 9 }
      })
    ).toBe(
      'Defra ID sign-in target (two journeys): carried 400 sign-ins an hour plus a 5 a second spike for 10 seconds, failed 0.00%, checks 100.00%, p95 9ms, dropped 0'
    )
  })

  test('states a target the stub did not carry', () => {
    expect(
      signInTargetLine({ label: 'with IUU', perHour: 1540, verdict: broke })
    ).toBe(
      'Defra ID sign-in target (with IUU): did not carry (failed 4.10% of requests) 1540 sign-ins an hour plus a 5 a second spike for 10 seconds, failed 4.10%, checks 99.00%, p95 9ms, dropped 0'
    )
  })
})

describe('ceilingSummaryText', () => {
  const metrics = {
    ...stepMetrics('ceiling-mdm-0010'),
    ...stepMetrics('ceiling-mdm-0025', { failed: 0.041 })
  }
  const text = ceilingSummaryText({
    metrics,
    setupData: {
      profiles: { mdm: { profile: 'zero-delay', fittedP95Ms: 0 } }
    },
    ladders: {
      mdm: [
        { scenario: 'ceiling-mdm-0010', rate: 10 },
        { scenario: 'ceiling-mdm-0025', rate: 25 }
      ]
    },
    groups: ['mdm'],
    environment: 'local',
    measured: '2026-10-02'
  })

  test('lists every step, the ceiling and the recorded entry', () => {
    expect(text).toContain(
      'Stub ceiling step: mdm 10 requests a second: held (failed 0.00%, checks 100.00%, p95 3ms, dropped 0)'
    )
    expect(text).toContain(
      'Stub ceiling step: mdm 25 requests a second: broke: failed 4.10% of requests'
    )
    expect(text).toContain(
      'Stub ceiling: mdm (trade-imports-stub, zero-delay, local) 10 requests a second; broke at 25: failed 4.10% of requests'
    )
    expect(text).toContain(
      'Stub ceilings recorded: {"mdm":{"zero-delay":{"rps":10,"atLeast":false,"measured":"2026-10-02","source":"breakpoint-stubs run in local, groups mdm"}}}'
    )
  })

  test('says the run is not judged and ends with a newline', () => {
    expect(text).toContain(
      "Run trust: not judged: this run measures the stubs' own ceilings"
    )
    expect(text.endsWith('\n')).toBe(true)
  })

  test('has no Defra ID lines when those groups did not run', () => {
    expect(text).not.toContain('Defra ID')
  })

  describe('with the Defra ID groups', () => {
    const failingStep = 'http_req_failed{scenario:ceiling-defra-id-0016}'
    const defraIdText = ceilingSummaryText({
      metrics: {
        ...stepMetrics('defra-id-target-two-journeys'),
        ...stepMetrics('defra-id-target-with-iuu', { failed: 0.041 }),
        ...stepMetrics('ceiling-defra-id-0008'),
        ...stepMetrics('ceiling-defra-id-0016', { failed: 0.041 }),
        [failingStep]: {
          values: { rate: 0.041 },
          thresholds: { 'rate<0.01': { ok: false } }
        }
      },
      setupData: {
        profiles: { 'defra-id': { profile: 'zero-delay', fittedP95Ms: 0 } }
      },
      ladders: {
        'defra-id': [
          { scenario: 'ceiling-defra-id-0008', rate: 8 },
          { scenario: 'ceiling-defra-id-0016', rate: 16 }
        ]
      },
      groups: ['defra-id-target', 'defra-id'],
      environment: 'local',
      measured: '2026-10-02'
    })

    test('states each sign-in target with its verdict', () => {
      expect(defraIdText).toContain(
        'Defra ID sign-in target (two journeys): carried 400 sign-ins an hour'
      )
      expect(defraIdText).toContain(
        'Defra ID sign-in target (with IUU): did not carry (failed 4.10% of requests) 1540 sign-ins an hour'
      )
    })

    test('states the Defra ID ceiling', () => {
      expect(defraIdText).toContain(
        'Defra ID ceiling 8 sign-ins a second against 5.11 needed (two journeys) and 5.43 (with IUU): headroom for both'
      )
    })

    test('records the Defra ID ceiling at 3 requests for each sign-in', () => {
      const recorded = JSON.parse(
        defraIdText
          .split('\n')
          .find((line) => line.startsWith('Stub ceilings recorded: '))
          .replace('Stub ceilings recorded: ', '')
      )

      expect(recorded['defra-id']['zero-delay'].rps).toBe(24)
    })

    test('lists a threshold that failed', () => {
      expect(defraIdText).toContain(
        `Threshold ${failingStep} rate<0.01: FAILED`
      )
    })
  })
})

describe('loadOf', () => {
  test('reports the peak and the mean a second', () => {
    expect(
      loadOf(mdmEntry({ count: 40, peakPerSecond: 7 }), 0, 100_000)
    ).toEqual({ peakPerSecond: 7, meanPerSecond: 0.4 })
  })

  test('has no peak when the stub does not report one', () => {
    expect(loadOf(mdmEntry({ count: 3 }), 0, 1000).peakPerSecond).toBeNull()
  })

  test('has a mean of 0 when no time has passed', () => {
    expect(loadOf(mdmEntry({ count: 3, peakPerSecond: 3 }), 5, 5)).toEqual({
      peakPerSecond: 3,
      meanPerSecond: 0
    })
  })
})

describe('headroomVerdict', () => {
  const load = { peakPerSecond: 3, meanPerSecond: 0.4 }
  const answered = { count: 40, peakPerSecond: 3 }

  test('has headroom when the peak is at most half the ceiling', () => {
    expect(
      headroomVerdict({ entry: mdmEntry(answered), ceiling, load })
    ).toEqual({ judged: true, verdict: 'headroom', reason: 'headroom' })
  })

  test('has no headroom when the peak is more than half the ceiling', () => {
    expect(
      headroomVerdict({
        entry: mdmEntry(answered),
        ceiling: { ...ceiling, rps: 5 },
        load
      }).verdict
    ).toBe('no headroom')
  })

  test('has no headroom when the ceiling is only a floor below twice the peak', () => {
    expect(
      headroomVerdict({
        entry: mdmEntry(answered),
        ceiling: { ...ceiling, rps: 5, atLeast: true },
        load
      }).verdict
    ).toBe('no headroom')
  })

  test('has no ceiling measured when none is recorded', () => {
    expect(
      headroomVerdict({ entry: mdmEntry(answered), ceiling: undefined, load })
        .verdict
    ).toBe('no ceiling measured')
  })

  test('has load not reported when the stub is not reporting', () => {
    expect(
      headroomVerdict({
        entry: mdmEntry(null, { profile: 'not-reported' }),
        ceiling,
        load: { peakPerSecond: null, meanPerSecond: 0 }
      }).verdict
    ).toBe('load not reported')
    expect(
      headroomVerdict({
        entry: mdmEntry({ count: 3 }),
        ceiling,
        load: { peakPerSecond: null, meanPerSecond: 0 }
      }).verdict
    ).toBe('load not reported')
  })

  test('does not judge an integration that carried nothing', () => {
    expect(
      headroomVerdict({
        entry: mdmEntry({ count: 0, peakPerSecond: 0 }),
        ceiling,
        load: { peakPerSecond: 0, meanPerSecond: 0 }
      })
    ).toMatchObject({ judged: false, reason: 'carried no load' })
  })

  test('does not judge Azure Service Bus', () => {
    expect(
      headroomVerdict({
        entry: { integration: 'azure-service-bus', stub: null, answered: null },
        ceiling: undefined,
        load: { peakPerSecond: null, meanPerSecond: 0 }
      })
    ).toMatchObject({ judged: false, reason: 'not a stub service' })
  })
})

describe('sharedStubDistortions', () => {
  const entries = [
    tokenEntry({ count: 20, peakPerSecond: 2 }),
    mdmEntry({ count: 30, peakPerSecond: 3 })
  ]
  const loads = {
    'trade-token': { peakPerSecond: 2, meanPerSecond: 0.2 },
    mdm: { peakPerSecond: 3, meanPerSecond: 0.3 }
  }

  test('names an integration that has headroom alone but not beside its neighbour', () => {
    expect(
      sharedStubDistortions({
        entries,
        ceilings: { mdm: { ...ceiling, rps: 8 } },
        loads
      })
    ).toEqual([
      {
        stub: 'trade-imports-stub',
        integration: 'mdm',
        combinedPeak: 5,
        ceilingRps: 8,
        others: ['trade-token']
      }
    ])
  })

  test('names nothing when the ceiling covers the combined peak', () => {
    expect(
      sharedStubDistortions({
        entries,
        ceilings: { mdm: { ...ceiling, rps: 40 } },
        loads
      })
    ).toEqual([])
  })

  test('names nothing when the other integration carried no load', () => {
    expect(
      sharedStubDistortions({
        entries: [tokenEntry({ count: 0, peakPerSecond: 0 }), entries[1]],
        ceilings: { mdm: { ...ceiling, rps: 8 } },
        loads: {
          ...loads,
          'trade-token': { peakPerSecond: 0, meanPerSecond: 0 }
        }
      })
    ).toEqual([])
  })
})

describe('headroomLine', () => {
  const environment = 'local'
  const load = { peakPerSecond: 3, meanPerSecond: 0.4 }
  const entry = mdmEntry({ count: 40, peakPerSecond: 3 })

  test('states a verdict with the load and the ceiling', () => {
    expect(
      headroomLine({
        entry,
        ceiling,
        load,
        environment,
        result: headroomVerdict({ entry, ceiling, load })
      })
    ).toBe(
      'Stub headroom: mdm (trade-imports-stub) peak 3 a second, mean 0.40 a second, against a ceiling of 400 a second (zero-delay, local, measured 2026-10-02): headroom'
    )
  })

  test('says when the stub does not report its load', () => {
    const unreported = mdmEntry(null, {
      integration: 'defra-id',
      stub: 'trade-imports-defra-id-stub',
      profile: 'not-reported'
    })

    expect(
      headroomLine({
        entry: unreported,
        ceiling: undefined,
        load: { peakPerSecond: null, meanPerSecond: 0 },
        environment,
        result: { judged: true, verdict: 'load not reported' }
      })
    ).toBe(
      'Stub headroom: defra-id (trade-imports-defra-id-stub) carried load not reported: the stub does not report it'
    )
  })

  test('says when there is no ceiling', () => {
    expect(
      headroomLine({
        entry,
        ceiling: undefined,
        load,
        environment,
        result: { judged: true, verdict: 'no ceiling measured' }
      })
    ).toBe(
      'Stub headroom: mdm (trade-imports-stub) peak 3 a second, mean 0.40 a second, no ceiling measured for zero-delay in local'
    )
  })

  test('says when an integration carried no load', () => {
    expect(
      headroomLine({
        entry,
        ceiling,
        load,
        environment,
        result: { judged: false, verdict: 'not judged' }
      })
    ).toBe('Stub headroom: mdm (trade-imports-stub) carried no load')
  })

  test('says Azure Service Bus is not a stub service', () => {
    expect(
      headroomLine({
        entry: { integration: 'azure-service-bus', stub: null },
        ceiling: undefined,
        load,
        environment,
        result: { judged: false, verdict: 'not judged' }
      })
    ).toBe('Stub headroom: azure-service-bus is not a stub service: not judged')
  })
})

describe('distortionLine', () => {
  test('names the integration and the evidence for splitting it', () => {
    expect(
      distortionLine({
        stub: 'trade-imports-stub',
        integration: 'mdm',
        combinedPeak: 30,
        ceilingRps: 40,
        others: ['trade-token']
      })
    ).toBe(
      "Shared stub: trade-imports-stub carried a combined peak of 30 a second across mdm and trade-token, more than half mdm's ceiling of 40: mdm's results are distorted, which is evidence for splitting mdm into its own stub service"
    )
  })
})

describe('trustLine', () => {
  test('trusts a run where every judged stub had headroom', () => {
    expect(
      trustLine(
        [
          { integration: 'mdm', judged: true, verdict: 'headroom' },
          {
            integration: 'azure-service-bus',
            judged: false,
            verdict: 'not judged'
          }
        ],
        []
      )
    ).toBe('Run trust: trusted: every stub the run went through had headroom')
  })

  test('does not trust a run, and says why', () => {
    expect(
      trustLine(
        [
          {
            integration: 'defra-id',
            judged: true,
            verdict: 'load not reported'
          },
          { integration: 'mdm', judged: true, verdict: 'no headroom' }
        ],
        [{ integration: 'mdm' }]
      )
    ).toBe(
      'Run trust: untrusted: defra-id carried load not reported; mdm no headroom; mdm shared-stub distortion'
    )
  })
})
