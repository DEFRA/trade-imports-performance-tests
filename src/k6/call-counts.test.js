import { beforeEach, describe, expect, test, vi } from 'vitest'

const gauges = vi.hoisted(() => ({}))
const httpMock = vi.hoisted(() => ({ get: vi.fn(), del: vi.fn() }))

vi.mock('k6/metrics', () => ({
  Gauge: class {
    constructor(name) {
      gauges[name] = vi.fn()
      this.add = gauges[name]
    }
  }
}))
vi.mock('./service-http.js', () => ({ serviceHttp: httpMock }))
vi.mock('./readiness.js', () => ({ READINESS_TAGS: { readiness: 'true' } }))

const { reportCallCounts } = await import('./call-counts.js')

const URLS = {
  animalsFrontend: 'http://animals.test',
  plantsFrontend: 'http://plants.test'
}
const PLANTS_URL = 'http://plants.test/call-counts'

const COUNTS_BODY = {
  totals: {
    pageRequests: 10,
    backendCalls: 12,
    sessionResolutions: 15,
    externalCalls: {}
  }
}

const jsonAnswer = (body) => ({ status: 200, json: () => body })

const htmlAnswer = () => ({
  status: 200,
  json: () => {
    throw new SyntaxError('Unexpected token <')
  }
})

const answerPlantsWith = (plantsAnswer) => {
  httpMock.get.mockImplementation((url) =>
    url === PLANTS_URL ? plantsAnswer : jsonAnswer(COUNTS_BODY)
  )
}

const measuredCalls = () => gauges.call_counts_measured.mock.calls

describe('reportCallCounts', () => {
  beforeEach(() => {
    httpMock.get.mockReset()
    Object.values(gauges).forEach((gauge) => gauge.mockClear())
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  test('records every journey as measured when each answers with call counts', () => {
    answerPlantsWith(jsonAnswer(COUNTS_BODY))

    reportCallCounts({ urls: URLS })

    expect(measuredCalls()).toEqual([
      [1, { journey: 'live-animals' }],
      [1, { journey: 'high-risk-plants' }]
    ])
  })

  test('records a journey as not measured when a 200 body is HTML, and still reports the other', () => {
    answerPlantsWith(htmlAnswer())

    expect(() => reportCallCounts({ urls: URLS })).not.toThrow()

    expect(measuredCalls()).toEqual([
      [1, { journey: 'live-animals' }],
      [0, { journey: 'high-risk-plants' }]
    ])
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(
        'could not read /call-counts from trade-imports-plants-frontend'
      )
    )
  })

  test('records a journey as not measured when a 200 body has no totals, and still reports the other', () => {
    answerPlantsWith(jsonAnswer({ message: 'not the counts' }))

    expect(() => reportCallCounts({ urls: URLS })).not.toThrow()

    expect(measuredCalls()).toEqual([
      [1, { journey: 'live-animals' }],
      [0, { journey: 'high-risk-plants' }]
    ])
    expect(gauges.call_count).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ journey: 'high-risk-plants' })
    )
  })
})
