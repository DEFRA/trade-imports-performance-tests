import { describe, expect, test } from 'vitest'

import {
  CONFORMANCE_INTERVAL_DAYS,
  SERVICE_BUS_ENTRY,
  STUBBED_INTEGRATIONS
} from '../config/stub-profiles.js'
import {
  answeredClearedBy,
  answeredLine,
  conformanceText,
  entriesFromReport,
  flaggedLine,
  flagsFor,
  notReportedEntries,
  orderEntries,
  profileLine,
  profileMismatchMessage
} from './stub-profiles.js'

const RUN_DATE = new Date('2026-10-01T12:00:00Z')
const DAYS = CONFORMANCE_INTERVAL_DAYS

const entry = (overrides = {}) => ({
  integration: 'mdm',
  stub: 'trade-imports-stub',
  interface: 'MDM reference data',
  owner: 'MDM team',
  serviceLevelSource: 'Interim (c-011 default)',
  agreed: false,
  lastConformed: null,
  profile: 'zero-delay',
  slaTargets: { p50Ms: 100, p95Ms: 400, p99Ms: 1000 },
  fitted: { p50Ms: 100, p95Ms: 470, p99Ms: 892 },
  targets: { p50Ms: 0, p95Ms: 0, p99Ms: 0 },
  answered: { count: 0, p50Ms: null, p95Ms: null, p99Ms: null },
  ...overrides
})

const slaEntry = (overrides = {}) =>
  entry({
    profile: 'sla',
    targets: { p50Ms: 100, p95Ms: 400, p99Ms: 1000 },
    ...overrides
  })

const notReported = () =>
  notReportedEntries('trade-imports-stub', STUBBED_INTEGRATIONS)[0]

describe('flagsFor', () => {
  test('has no flag for an agreed profile conformed 3 days ago', () => {
    expect(
      flagsFor(
        entry({ agreed: true, lastConformed: '2026-09-28' }),
        RUN_DATE,
        DAYS
      )
    ).toEqual([])
  })

  test('flags an unagreed profile', () => {
    expect(
      flagsFor(
        entry({ agreed: false, lastConformed: '2026-09-28' }),
        RUN_DATE,
        DAYS
      )
    ).toEqual(['unagreed'])
  })

  test('flags a profile that was never conformed as overdue', () => {
    expect(
      flagsFor(entry({ agreed: true, lastConformed: null }), RUN_DATE, DAYS)
    ).toEqual(['conformance-overdue'])
  })

  test('flags a profile conformed 8 days ago as overdue', () => {
    expect(
      flagsFor(
        entry({ agreed: true, lastConformed: '2026-09-23' }),
        RUN_DATE,
        DAYS
      )
    ).toEqual(['conformance-overdue'])
  })

  test('does not flag a profile conformed exactly 7 days ago', () => {
    expect(
      flagsFor(
        entry({ agreed: true, lastConformed: '2026-09-24' }),
        RUN_DATE,
        DAYS
      )
    ).toEqual([])
  })

  test.each(['2026-13-40', '01/10/2026'])(
    'flags a malformed conformance date %s as overdue',
    (lastConformed) => {
      expect(
        flagsFor(entry({ agreed: true, lastConformed }), RUN_DATE, DAYS)
      ).toEqual(['conformance-overdue'])
    }
  )

  test('flags a conformance date after the run date as overdue', () => {
    expect(
      flagsFor(
        entry({ agreed: true, lastConformed: '2026-10-02' }),
        RUN_DATE,
        DAYS
      )
    ).toEqual(['conformance-overdue'])
  })

  test('lists unagreed before conformance-overdue', () => {
    expect(flagsFor(entry(), RUN_DATE, DAYS)).toEqual([
      'unagreed',
      'conformance-overdue'
    ])
  })
})

describe('conformanceText', () => {
  test('says a never-conformed profile was never conformed', () => {
    expect(conformanceText(entry(), RUN_DATE, DAYS)).toBe('never conformed')
  })

  test('gives the date of a current profile', () => {
    expect(
      conformanceText(entry({ lastConformed: '2026-09-28' }), RUN_DATE, DAYS)
    ).toBe('last conformed 2026-09-28')
  })

  test('says when an old conformance is overdue', () => {
    expect(
      conformanceText(entry({ lastConformed: '2026-09-01' }), RUN_DATE, DAYS)
    ).toBe('last conformed 2026-09-01, overdue (every 7 days)')
  })
})

describe('profileLine', () => {
  test('states a sla profile, its targets, its fit, its metadata and its flags', () => {
    expect(profileLine(slaEntry(), RUN_DATE, DAYS)).toBe(
      'Stub profile: mdm (trade-imports-stub) runs sla, targets p50 100ms, p95 400ms, p99 1000ms (lognormal fit p95 470ms, p99 892ms); MDM reference data; owner MDM team; from Interim (c-011 default); never conformed; flags: UNAGREED, CONFORMANCE OVERDUE'
    )
  })

  test('states a zero-delay profile with zero targets and no fit', () => {
    expect(profileLine(entry(), RUN_DATE, DAYS)).toBe(
      'Stub profile: mdm (trade-imports-stub) runs zero-delay, targets p50 0ms, p95 0ms, p99 0ms; MDM reference data; owner MDM team; from Interim (c-011 default); never conformed; flags: UNAGREED, CONFORMANCE OVERDUE'
    )
  })

  test('says none when a profile carries no flag', () => {
    expect(
      profileLine(
        entry({ agreed: true, lastConformed: '2026-09-28' }),
        RUN_DATE,
        DAYS
      )
    ).toContain('flags: none')
  })

  test('says a stub that does not report profiles adds no delay', () => {
    expect(profileLine(notReported(), RUN_DATE, DAYS)).toBe(
      'Stub profile: trade-token (trade-imports-stub) runs zero-delay: the stub does not report latency profiles, so it adds no delay; flags: NOT REPORTED, UNAGREED, CONFORMANCE OVERDUE'
    )
  })

  test('states Azure Service Bus as not a stub service', () => {
    expect(profileLine(SERVICE_BUS_ENTRY, RUN_DATE, DAYS)).toBe(
      "Stub profile: azure-service-bus (not a stub service: locally the workspace stack's toxiproxy in front of the Service Bus emulator; in CDP, CDP configuration) runs zero-delay, targets p50 0ms, p95 0ms, p99 0ms; Azure Service Bus, the only route to Dynamics and PIMS; owner TBC: no §9.5 row; from None: §9.5 gives no Service Bus figure, so zero added delay until one is agreed; never conformed; flags: UNAGREED, CONFORMANCE OVERDUE"
    )
  })
})

describe('answeredLine', () => {
  test('states the answered latency beside the targets', () => {
    expect(
      answeredLine(
        slaEntry({
          answered: { count: 12, p50Ms: 98, p95Ms: 460, p99Ms: 880 }
        })
      )
    ).toBe(
      'Stub latency answered: mdm (trade-imports-stub) p50 98ms, p95 460ms, p99 880ms over 12 calls, beside targets p50 100ms, p95 400ms, p99 1000ms'
    )
  })

  test('adds the peak a second when the stub reports one', () => {
    expect(
      answeredLine(
        slaEntry({
          answered: {
            count: 12,
            peakPerSecond: 5,
            p50Ms: 98,
            p95Ms: 460,
            p99Ms: 880
          }
        })
      )
    ).toBe(
      'Stub latency answered: mdm (trade-imports-stub) p50 98ms, p95 460ms, p99 880ms over 12 calls, peak 5 a second, beside targets p50 100ms, p95 400ms, p99 1000ms'
    )
  })

  test('says when no calls were recorded', () => {
    expect(answeredLine(entry())).toBe(
      'Stub latency answered: mdm (trade-imports-stub) no calls recorded, beside targets p50 0ms, p95 0ms, p99 0ms'
    )
  })

  test('says when the stub does not report', () => {
    expect(answeredLine(notReported())).toBe(
      'Stub latency answered: trade-token (trade-imports-stub) not reported'
    )
  })

  test('says Azure Service Bus is not measured by a stub', () => {
    expect(answeredLine(SERVICE_BUS_ENTRY)).toBe(
      "Stub latency answered: azure-service-bus is not measured by a stub: locally the workspace stack's toxiproxy in front of the Service Bus emulator; in CDP, CDP configuration"
    )
  })
})

describe('flaggedLine', () => {
  test('names each flagged integration and its flags', () => {
    expect(
      flaggedLine(
        [
          entry({ integration: 'defra-id' }),
          entry({
            integration: 'mdm',
            agreed: true,
            lastConformed: '2026-09-28'
          })
        ],
        RUN_DATE,
        DAYS
      )
    ).toBe('Stub profiles flagged: defra-id unagreed, conformance-overdue')
  })

  test('says none when nothing is flagged', () => {
    expect(
      flaggedLine(
        [entry({ agreed: true, lastConformed: '2026-09-28' })],
        RUN_DATE,
        DAYS
      )
    ).toBe('Stub profiles flagged: none')
  })
})

describe('profileMismatchMessage', () => {
  const entries = [
    entry({ integration: 'defra-id', stub: 'trade-imports-defra-id-stub' }),
    slaEntry({ integration: 'mdm' }),
    SERVICE_BUS_ENTRY
  ]

  test('is undefined when nothing is required', () => {
    expect(profileMismatchMessage(entries, undefined)).toBeUndefined()
  })

  test('is undefined when every stub-hosted integration matches', () => {
    expect(
      profileMismatchMessage([slaEntry(), slaEntry(), SERVICE_BUS_ENTRY], 'sla')
    ).toBeUndefined()
  })

  test('names each mismatch and ignores Azure Service Bus', () => {
    expect(profileMismatchMessage(entries, 'sla')).toBe(
      'Stub profiles do not match STUB_PROFILE=sla: defra-id runs zero-delay'
    )
  })

  test('treats a not-reported stub as zero-delay', () => {
    expect(
      profileMismatchMessage([notReported()], 'zero-delay')
    ).toBeUndefined()
    expect(profileMismatchMessage([notReported()], 'sla')).toBe(
      'Stub profiles do not match STUB_PROFILE=sla: trade-token runs zero-delay'
    )
  })
})

describe('entriesFromReport', () => {
  test('adds the stub to each integration the report lists', () => {
    expect(
      entriesFromReport(
        { integrations: [{ integration: 'mdm' }] },
        'trade-imports-stub'
      )
    ).toEqual([{ integration: 'mdm', stub: 'trade-imports-stub' }])
  })

  test('throws when the report has no integrations list', () => {
    expect(() => entriesFromReport({}, 'trade-imports-stub')).toThrow(
      'trade-imports-stub answered /latency-profiles without an integrations list'
    )
  })
})

describe('notReportedEntries', () => {
  test('gives the trade token and MDM for the Java stub, and nothing else', () => {
    const entries = notReportedEntries(
      'trade-imports-stub',
      STUBBED_INTEGRATIONS
    )

    expect(entries.map(({ integration }) => integration)).toEqual([
      'trade-token',
      'mdm'
    ])
    expect(entries[0]).toMatchObject({
      profile: 'not-reported',
      agreed: false,
      lastConformed: null,
      answered: null,
      targets: { p50Ms: 0, p95Ms: 0, p99Ms: 0 }
    })
  })
})

describe('orderEntries', () => {
  const integrations = [
    { integration: 'defra-id', stub: 'trade-imports-defra-id-stub' },
    { integration: 'trade-token', stub: 'trade-imports-stub' },
    { integration: 'mdm', stub: 'trade-imports-stub' }
  ]

  test('puts a complete list in the order of the integrations', () => {
    const entries = [
      entry({ integration: 'mdm' }),
      entry({ integration: 'defra-id' }),
      entry({ integration: 'trade-token' })
    ]

    expect(
      orderEntries(entries, integrations).map(({ integration }) => integration)
    ).toEqual(['defra-id', 'trade-token', 'mdm'])
  })

  test('names the integration and its stub when one is missing', () => {
    const entries = [
      entry({ integration: 'defra-id' }),
      entry({ integration: 'mdm' })
    ]

    expect(() => orderEntries(entries, integrations)).toThrow(
      'trade-imports-stub did not report a latency profile for trade-token'
    )
  })

  test('says the stubs when the missing integration has no stub', () => {
    expect(() =>
      orderEntries([], [{ integration: 'azure-service-bus', stub: null }])
    ).toThrow(
      'the stubs did not report a latency profile for azure-service-bus'
    )
  })
})

describe('answeredClearedBy', () => {
  test('says the stub cleared its answers on 204', () => {
    expect(answeredClearedBy('trade-imports-stub', 204)).toBe(true)
  })

  test.each([404, 405])(
    'says a stub that answers %s predates profiles',
    (status) => {
      expect(answeredClearedBy('trade-imports-stub', status)).toBe(false)
    }
  )

  test('throws naming the stub and status for anything else', () => {
    expect(() => answeredClearedBy('trade-imports-stub', 500)).toThrow(
      'Could not clear the answered latencies of trade-imports-stub: status 500'
    )
  })
})
