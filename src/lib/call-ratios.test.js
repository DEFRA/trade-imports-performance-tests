import { describe, expect, test } from 'vitest'

import {
  callCountsFromCloudWatch,
  callCountsFromSummary,
  callRatioLine,
  callRatioLinesFor,
  callRatios,
  journeyCallCounts,
  notMeasuredLine,
  parseCallCounts,
  unreadableCountsLine
} from './call-ratios.js'

const ANIMALS = 'trade-imports-animals-frontend'
const COUNTS = { pageRequests: 412, backendCalls: 569, sessionResolutions: 812 }

const gauge = (value) => ({ value, min: value, max: value })

const summaryFor = (journey, counts, measured = 1) => ({
  metrics: {
    [`call_counts_measured{journey:${journey}}`]: gauge(measured),
    [`call_count{journey:${journey},measure:page-requests}`]: gauge(
      counts.pageRequests
    ),
    [`call_count{journey:${journey},measure:backend-calls}`]: gauge(
      counts.backendCalls
    ),
    [`call_count{journey:${journey},measure:session-resolutions}`]: gauge(
      counts.sessionResolutions
    ),
    [`call_count_external{journey:${journey},dependency:defra-id,operation:jwks}`]:
      gauge(12),
    [`call_count_external{journey:${journey},dependency:defra-id,operation:token-exchange}`]:
      gauge(0)
  }
})

describe('journeyCallCounts', () => {
  test('reads the totals of the endpoint body', () => {
    expect(
      journeyCallCounts({
        service: ANIMALS,
        totals: { ...COUNTS, externalCalls: { 'defra-id': { jwks: 3 } } },
        routes: []
      })
    ).toEqual({ ...COUNTS, externalCalls: { 'defra-id': { jwks: 3 } } })
  })

  test('defaults to no external calls', () => {
    expect(journeyCallCounts({ totals: COUNTS }).externalCalls).toEqual({})
  })
})

describe('parseCallCounts', () => {
  test('returns the counts of a body with totals', () => {
    expect(parseCallCounts({ json: () => ({ totals: COUNTS }) })).toEqual({
      counts: { ...COUNTS, externalCalls: {} }
    })
  })

  test('gives a reason when the body is not JSON', () => {
    const response = {
      json: () => {
        throw new SyntaxError('Unexpected token <')
      }
    }

    expect(parseCallCounts(response)).toEqual({
      reason: 'the body was not JSON (Unexpected token <)'
    })
  })

  test.each([
    [null],
    [{}],
    [{ totals: {} }],
    [{ totals: { pageRequests: 'x' } }]
  ])('gives a reason when the body is %j', (body) => {
    expect(parseCallCounts({ json: () => body })).toEqual({
      reason: 'the body has no call count totals'
    })
  })
})

describe('unreadableCountsLine', () => {
  test('names the journey, the frontend and the reason', () => {
    expect(
      unreadableCountsLine({
        journey: 'live-animals',
        service: ANIMALS,
        reason: 'the body has no call count totals'
      })
    ).toBe(
      'Call ratio live-animals: could not read /call-counts from trade-imports-animals-frontend: the body has no call count totals'
    )
  })
})

describe('callRatios', () => {
  test('divides each count by the page requests and sets them beside the derived figures', () => {
    const ratios = callRatios(COUNTS)

    expect(ratios.backendCallsPerPage).toBeCloseTo(1.381, 3)
    expect(ratios.frontendSessionResolutionsPerPage).toBeCloseTo(1.971, 3)
    expect(ratios.sessionResolutionsPerPage).toBeCloseTo(1.971, 3)
    expect(ratios.backendSessionResolutionsPerPage).toBe(0)
    expect(ratios.permissionChecksPerPage).toBe(0)
    expect(ratios.derived.backendCallsPerPage).toBe(1)
    expect(ratios.derived.sessionResolutionsPerPage).toBe(2)
    expect(ratios.derived.permissionChecksPerPage).toBe(2)
    expect(ratios.derived.sessionResolutionsAtMeasuredD1).toBeCloseTo(2.381, 3)
  })

  test('is null throughout when no page request was carried', () => {
    const ratios = callRatios({
      pageRequests: 0,
      backendCalls: 0,
      sessionResolutions: 0
    })

    expect(ratios.backendCallsPerPage).toBeNull()
    expect(ratios.derived.sessionResolutionsPerPage).toBeNull()
    expect(ratios.permissionChecksPerPage).toBeNull()
  })
})

describe('callRatioLine', () => {
  test('words the measured ratios against D1, D2 and D3', () => {
    expect(
      callRatioLine({
        journey: 'live-animals',
        service: ANIMALS,
        counts: COUNTS
      })
    ).toBe(
      'Call ratio live-animals (trade-imports-animals-frontend, 412 page requests): backend calls 1.38 a page against 1 (D1, T8); session resolutions 1.97 a page against 2 (D2: 1 a page plus 1 a backend call; 2.38 at the measured backend calls), the frontend 1.97 and the journey backend 0 (no backend resolves a session today, c-008); permission checks 0 a page against 2 (D3): no permission check exists today (c-008; open items 17, 28)'
    )
  })

  test('says so when the frontend carried no page requests', () => {
    expect(
      callRatioLine({
        journey: 'live-animals',
        service: ANIMALS,
        counts: { pageRequests: 0, backendCalls: 0, sessionResolutions: 0 }
      })
    ).toBe(
      'Call ratio live-animals (trade-imports-animals-frontend): carried no page requests'
    )
  })
})

describe('notMeasuredLine', () => {
  test('says the frontend does not expose the endpoint on a 404', () => {
    expect(
      notMeasuredLine({
        journey: 'live-animals',
        service: ANIMALS,
        status: 404
      })
    ).toBe(
      'Call ratio live-animals: not measured here: trade-imports-animals-frontend does not expose /call-counts. On the platform the external call report reads its BackendCalls and SessionResolutions from CloudWatch'
    )
  })

  test('names the status of any other answer', () => {
    expect(
      notMeasuredLine({
        journey: 'live-animals',
        service: ANIMALS,
        status: 502
      })
    ).toBe(
      'Call ratio live-animals: not measured here: could not read /call-counts: status 502'
    )
  })
})

describe('callCountsFromSummary', () => {
  test('reads the journeys whose counters were read back', () => {
    const counts = callCountsFromSummary(summaryFor('live-animals', COUNTS))

    expect(counts.source).toBe('call-counts')
    expect(Object.keys(counts.journeys)).toEqual(['live-animals'])
    expect(counts.journeys['live-animals']).toEqual({
      ...COUNTS,
      externalCalls: { 'defra-id': { jwks: 12 } }
    })
  })

  test('is null when no journey was measured', () => {
    expect(
      callCountsFromSummary(summaryFor('live-animals', COUNTS, 0))
    ).toBeNull()
    expect(callCountsFromSummary(undefined)).toBeNull()
  })
})

describe('callCountsFromCloudWatch', () => {
  const rows = [
    { service: ANIMALS, dependency: 'defra-id', operation: 'jwks', calls: 7 },
    {
      service: ANIMALS,
      dependency: 'defra-id',
      operation: 'token-refresh',
      calls: null
    },
    {
      service: 'trade-imports-plants-frontend',
      dependency: 'defra-id',
      operation: 'jwks',
      calls: 5
    }
  ]

  test('joins the page request counts to the frontend own external calls', () => {
    const counts = callCountsFromCloudWatch({
      pageRequestCounts: { 'live-animals': COUNTS, 'high-risk-plants': null },
      externalCallRows: rows
    })

    expect(counts).toEqual({
      source: 'cloudwatch',
      journeys: {
        'live-animals': {
          ...COUNTS,
          externalCalls: { 'defra-id': { jwks: 7 } }
        }
      }
    })
  })

  test('is null when no frontend published', () => {
    expect(
      callCountsFromCloudWatch({
        pageRequestCounts: { 'live-animals': null, 'high-risk-plants': null },
        externalCallRows: rows
      })
    ).toBeNull()
  })
})

describe('callRatioLinesFor', () => {
  test('gives one line for each measured journey', () => {
    const lines = callRatioLinesFor(
      callCountsFromSummary(summaryFor('live-animals', COUNTS))
    )

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Call ratio live-animals')
  })

  test('gives none when nothing was measured', () => {
    expect(callRatioLinesFor(null)).toEqual([])
  })
})
