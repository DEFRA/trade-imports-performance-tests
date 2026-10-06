import { describe, expect, test } from 'vitest'

import {
  INITIAL_BACKLOG_STATE,
  backlogDepthFrom,
  differentInstancesLine,
  drainLine,
  eventCountLines,
  eventCountRows,
  eventingWatchLine,
  eventingWatchSummary,
  externalEventCount,
  forwardedCountFrom,
  forwardedDelta,
  hasArrived,
  isSettled,
  latestVersion,
  peakDayReport,
  peakDayText,
  readingsLine,
  settleLine,
  smoothingLine,
  trackBacklog
} from './eventing.js'

const SUBMITTED = 'uk.gov.defra.imports.notification.NotificationSubmitted'
const AMENDED =
  'uk.gov.defra.imports.notification.NotificationSubmissionAmended'
const CANCELLED =
  'uk.gov.defra.imports.notification.NotificationAmendmentCancelled'

describe('forwardedCountFrom', () => {
  test('reads the COUNT measurement', () => {
    expect(
      forwardedCountFrom({
        name: 'notification.sqs.messages',
        measurements: [{ statistic: 'COUNT', value: 12 }]
      })
    ).toBe(12)
  })

  test.each([
    [null],
    [{}],
    [{ measurements: [] }],
    [{ measurements: [{ statistic: 'VALUE', value: 3 }] }],
    [{ measurements: [{ statistic: 'COUNT', value: 'many' }] }]
  ])('is null for %j', (body) => {
    expect(forwardedCountFrom(body)).toBeNull()
  })
})

describe('backlogDepthFrom', () => {
  test('adds the visible and in-flight counts', () => {
    expect(
      backlogDepthFrom({ approximate_count: 4, approximate_in_flight_count: 3 })
    ).toBe(7)
  })

  test.each([
    [null],
    [{ approximate_count: 4 }],
    [{ approximate_count: 4, approximate_in_flight_count: '3' }],
    [{ approximate_count: 4.5, approximate_in_flight_count: 3 }]
  ])('is null for %j', (body) => {
    expect(backlogDepthFrom(body)).toBeNull()
  })
})

describe('externalEventCount and latestVersion', () => {
  const events = [
    { eventType: SUBMITTED, aggregateVersion: 2 },
    {
      eventType: 'uk.gov.defra.imports.notification.NotificationEdited',
      aggregateVersion: 3
    },
    { eventType: AMENDED, aggregateVersion: 5 },
    { eventType: CANCELLED, aggregateVersion: 4 }
  ]

  test('counts only the events the gateway forwards', () => {
    expect(externalEventCount(events)).toBe(2)
  })

  test('counts nothing for anything but a list', () => {
    expect(externalEventCount(null)).toBe(0)
    expect(externalEventCount({})).toBe(0)
  })

  test('takes the highest aggregate version', () => {
    expect(latestVersion(events)).toBe(5)
  })

  test('has no latest version without events', () => {
    expect(latestVersion([])).toBeNull()
    expect(latestVersion(null)).toBeNull()
  })
})

describe('hasArrived', () => {
  test.each([
    [5, 5, true],
    [6, 5, true],
    [4, 5, false]
  ])('stored %i against outbox %i is %s', (stored, version, arrived) => {
    expect(
      hasArrived({ content: [{ aggregateVersion: stored }] }, version)
    ).toBe(arrived)
  })

  test('has not arrived when the read model holds nothing for the reference', () => {
    expect(hasArrived({ content: [] }, 1)).toBe(false)
    expect(hasArrived(null, 1)).toBe(false)
  })

  test('cannot be proved without an outbox version', () => {
    expect(hasArrived({ content: [{ aggregateVersion: 3 }] }, null)).toBe(false)
  })
})

describe('forwardedDelta', () => {
  test.each([
    [3, 9, 6],
    [4, 4, 0]
  ])('from %i to %i is %i', (before, after, delta) => {
    expect(forwardedDelta({ before, after })).toBe(delta)
  })

  test.each([
    [null, 3],
    [3, null],
    [9, 3]
  ])('is null for %s then %s', (before, after) => {
    expect(forwardedDelta({ before, after })).toBeNull()
  })
})

describe('isSettled', () => {
  const quiet = {
    startDepth: 2,
    depth: 2,
    previousForwarded: 10,
    forwarded: 10
  }

  test('is settled when the backlog is back and the count has stopped', () => {
    expect(isSettled(quiet)).toBe(true)
  })

  test.each([
    ['the backlog is above where it started', { depth: 3 }],
    ['the forwarded count is still rising', { forwarded: 11 }],
    ['the backlog could not be read', { depth: null }],
    ['the forwarded count could not be read', { forwarded: null }],
    ['there is no earlier forwarded reading', { previousForwarded: null }]
  ])('is not settled when %s', (description, change) => {
    expect(isSettled({ ...quiet, ...change })).toBe(false)
  })

  test('treats an unread start depth as an empty queue', () => {
    expect(isSettled({ ...quiet, startDepth: null, depth: 0 })).toBe(true)
    expect(isSettled({ ...quiet, startDepth: null, depth: 1 })).toBe(false)
  })
})

describe('trackBacklog', () => {
  const window = { startSeconds: 10, endSeconds: 20 }

  const fold = (series) =>
    series.reduce(
      (folded, [seconds, depth, perSecond]) => {
        const { state, gauges } = trackBacklog(
          folded.state,
          { seconds, depth, forwardedDelta: perSecond },
          window
        )

        return { state, emitted: [...folded.emitted, gauges] }
      },
      { state: INITIAL_BACKLOG_STATE, emitted: [] }
    )

  const drainingSeries = [
    [8, 2, 0],
    [9, 2, 0],
    [10, 4, 1],
    [14, 9, 3],
    [20, 8, 2],
    [30, 5, 1],
    [34, 2, 1],
    [35, 2, 0]
  ]

  test('takes the last depth before the window as the pre-burst depth', () => {
    expect(fold(drainingSeries).state.preBurstDepth).toBe(2)
  })

  test('keeps the peak depth and the peak forwarded rate', () => {
    const { state } = fold(drainingSeries)

    expect(state.peakDepth).toBe(9)
    expect(state.peakPerSecond).toBe(3)
  })

  test('gives the drain time from the window end to the first reading at the pre-burst depth', () => {
    expect(fold(drainingSeries).state.drainSeconds).toBe(14)
  })

  test('stops tracking once drained', () => {
    const { state } = fold([...drainingSeries, [36, 50, 40]])

    expect(state.peakDepth).toBe(9)
    expect(state.drainSeconds).toBe(14)
  })

  test('emits the pre-burst depth once, when the window opens', () => {
    const { emitted } = fold(drainingSeries)

    expect(emitted.filter((gauges) => 'preBurstDepth' in gauges)).toEqual([
      { preBurstDepth: 2, peakDepth: 4, peakPerSecond: 1 }
    ])
  })

  test('emits the drain time once', () => {
    const { emitted } = fold([...drainingSeries, [36, 2, 0]])

    expect(emitted.filter((gauges) => 'drainSeconds' in gauges)).toEqual([
      { drainSeconds: 14 }
    ])
  })

  test('gives no drain time for a backlog that never drains', () => {
    const { state } = fold([
      [9, 2, 0],
      [10, 5, 1],
      [20, 7, 1],
      [60, 6, 1],
      [200, 6, 1]
    ])

    expect(state.drainSeconds).toBeNull()
    expect(state.peakDepth).toBe(7)
  })

  test('gives no drain time when no depth was read before the window', () => {
    const { state } = fold([
      [9, null, 0],
      [25, 0, 0]
    ])

    expect(state.drainSeconds).toBeNull()
  })

  test('skips a reading that could not be taken', () => {
    const { state } = fold([
      [9, 2, 0],
      [12, null, null],
      [14, 6, 2]
    ])

    expect(state.peakDepth).toBe(6)
    expect(state.peakPerSecond).toBe(2)
  })
})

describe('eventingWatchSummary', () => {
  const gauge = (value) => ({ values: { value } })
  const metrics = {
    eventing_backlog_pre_burst_depth: gauge(2),
    eventing_backlog_peak_depth: gauge(9),
    service_bus_peak_per_second: gauge(3),
    eventing_backlog_drain_seconds: gauge(14),
    eventing_backlog_drained: { values: { rate: 1 } },
    'notifications_submitted{phase:burst}': { values: { count: 12 } }
  }

  test('reads the figures and the notifications submitted in the window', () => {
    expect(eventingWatchSummary(metrics, 'burst')).toEqual({
      preBurstDepth: 2,
      peakDepth: 9,
      peakPerSecond: 3,
      drainSeconds: 14,
      submittedInWindow: 12
    })
  })

  test('has no drain time when the backlog never drained', () => {
    const undrained = {
      ...metrics,
      eventing_backlog_drained: { values: { rate: 0 } }
    }

    expect(eventingWatchSummary(undrained, 'burst').drainSeconds).toBeNull()
  })

  test('reads zeros from a summary with no figures', () => {
    expect(eventingWatchSummary({}, 'spike')).toEqual({
      preBurstDepth: 0,
      peakDepth: 0,
      peakPerSecond: 0,
      drainSeconds: null,
      submittedInWindow: 0
    })
  })
})

describe('eventCountRows and eventCountLines', () => {
  const count = (value) => ({ values: { count: value } })
  const metrics = {
    'notifications_submitted{scenario:live-animals,submission:first}':
      count(546),
    'notifications_submitted{scenario:live-animals,submission:amendment}':
      count(98),
    'notifications_submitted{scenario:high-risk-plants,submission:first}':
      count(442),
    'notifications_submitted{scenario:high-risk-plants,submission:amendment}':
      count(88),
    'external_events_published{scenario:live-animals}': count(644),
    'event_arrivals{scenario:live-animals}': {
      values: { passes: 546, fails: 0, rate: 1 }
    },
    'service_bus_forwarded{schema_version:0.1.0}': { values: { value: 644 } },
    'service_bus_forwarded{schema_version:0.2.0}': { values: { value: 644 } }
  }

  test('collects a row for each journey', () => {
    expect(eventCountRows(metrics)).toEqual([
      {
        scenario: 'live-animals',
        label: 'Live animals',
        publishes: true,
        submitted: 546,
        amendments: 98,
        published: 644,
        arrived: 546,
        checked: 546,
        forwarded: { '0.1.0': 644, '0.2.0': 644 }
      },
      {
        scenario: 'high-risk-plants',
        label: 'High-risk plants',
        publishes: false,
        submitted: 442,
        amendments: 88
      }
    ])
  })

  test('states live animals against what was submitted, in local', () => {
    expect(
      eventCountLines({
        rows: eventCountRows(metrics),
        environment: 'local'
      })[0]
    ).toBe(
      'Live animals: 546 submitted and 98 amendments resubmitted; 644 events published; dashboard read model: 546 of 546 notifications arrived; Service Bus stand-in: 644 of 644 events forwarded, each sent as v0.1.0 and v0.2.0, so 1288 messages'
    )
  })

  test('says high-risk plants publishes no events, and never counts zero against zero', () => {
    const [, plants] = eventCountLines({
      rows: eventCountRows(metrics),
      environment: 'local'
    })

    expect(plants).toBe(
      'High-risk plants: 442 submitted and 88 amendments resubmitted; publishes no events today (pbe-022), so nothing is expected at the dashboard read model or the Service Bus stand-in and nothing is counted'
    )
    expect(plants).not.toContain('0 of 0')
  })

  test('says high-risk plants publishes no events even with nothing submitted', () => {
    const [, plants] = eventCountLines({
      rows: eventCountRows({}),
      environment: 'local'
    })

    expect(plants).toContain('publishes no events today')
    expect(plants).not.toContain('0 of 0')
  })

  test('flags a shortfall at the read model and at the stand-in', () => {
    const short = {
      ...metrics,
      'event_arrivals{scenario:live-animals}': {
        values: { passes: 5, fails: 1, rate: 0.83 }
      },
      'external_events_published{scenario:live-animals}': count(6),
      'service_bus_forwarded{schema_version:0.1.0}': { values: { value: 4 } },
      'service_bus_forwarded{schema_version:0.2.0}': { values: { value: 4 } }
    }
    const [animals] = eventCountLines({
      rows: eventCountRows(short),
      environment: 'local'
    })

    expect(animals).toContain(
      'dashboard read model: 5 of 6 notifications arrived: SHORT, 1 missing'
    )
    expect(animals).toContain(
      'Service Bus stand-in: 4 of 6 events forwarded: SHORT, 2 missing, each sent as v0.1.0 and v0.2.0, so 8 messages'
    )
  })

  test('adds the one-instance note outside local', () => {
    const [animals] = eventCountLines({
      rows: eventCountRows(metrics),
      environment: 'test'
    })

    expect(animals).toContain(
      '; note: the forwarded count is read from one gateway instance, so a second instance would hold the rest'
    )
  })

  test('names the version that was not measured, and states no total', () => {
    const partial = { ...metrics }

    delete partial['service_bus_forwarded{schema_version:0.2.0}']
    partial['service_bus_forwarded{schema_version:0.1.0}'] = {
      values: { value: 600 }
    }
    partial['external_events_published{scenario:live-animals}'] = count(600)

    const [animals] = eventCountLines({
      rows: eventCountRows(partial),
      environment: 'local'
    })

    expect(animals).toContain('v0.2.0 not measured')
    expect(animals).not.toContain('so 600 messages')
  })

  test('flags more forwarded than published as a mismatch', () => {
    const over = {
      ...metrics,
      'external_events_published{scenario:live-animals}': count(600),
      'service_bus_forwarded{schema_version:0.1.0}': { values: { value: 644 } },
      'service_bus_forwarded{schema_version:0.2.0}': { values: { value: 644 } }
    }
    const [animals] = eventCountLines({
      rows: eventCountRows(over),
      environment: 'local'
    })

    expect(animals).toContain('MISMATCH, 44 more than published')
  })

  test('says the stand-in was not measured when no forwarded count was recorded', () => {
    const unread = { ...metrics }

    delete unread['service_bus_forwarded{schema_version:0.1.0}']

    const [animals] = eventCountLines({
      rows: eventCountRows(unread),
      environment: 'local'
    })

    expect(animals).toContain(
      "Service Bus stand-in: not measured, the gateway's forwarded count could not be read"
    )
  })
})

describe('smoothingLine', () => {
  test('states the peak outbound rate and the backlog peak over the window', () => {
    expect(
      smoothingLine({
        phase: 'burst',
        windowSeconds: 60,
        eventing: {
          preBurstDepth: 2,
          peakDepth: 9,
          peakPerSecond: 3,
          drainSeconds: 14,
          submittedInWindow: 12
        }
      })
    ).toBe(
      'Smoothing over the burst (1m): 12 notifications submitted; the Service Bus stand-in received at most 3 events in any one second, and the SQS backlog peaked at 9 messages'
    )
  })
})

describe('drainLine', () => {
  const eventing = {
    preBurstDepth: 2,
    peakDepth: 9,
    peakPerSecond: 3,
    drainSeconds: 14,
    submittedInWindow: 12
  }

  test('states how long the backlog took to drain', () => {
    expect(drainLine({ phase: 'burst', watchSeconds: 180, eventing })).toBe(
      'SQS backlog after the burst: drained to its pre-burst depth of 2 in 14 seconds'
    )
  })

  test('uses the singular for one second', () => {
    expect(
      drainLine({
        phase: 'spike',
        watchSeconds: 180,
        eventing: { ...eventing, drainSeconds: 1 }
      })
    ).toBe(
      'SQS backlog after the spike: drained to its pre-spike depth of 2 in 1 second'
    )
  })

  test('says it did not drain within the watch', () => {
    expect(
      drainLine({
        phase: 'burst',
        watchSeconds: 180,
        eventing: { ...eventing, drainSeconds: null }
      })
    ).toBe(
      'SQS backlog after the burst: did not drain within 180s (pre-burst depth 2, peak 9)'
    )
  })
})

describe('log lines', () => {
  test('eventingWatchLine names the window and the drain watch', () => {
    expect(
      eventingWatchLine({
        phase: 'burst',
        window: { startSeconds: 330, endSeconds: 390 }
      })
    ).toBe(
      "Eventing watch: every second the run reads the gateway's forwarded count and the SQS backlog; the burst runs from 330s to 390s, and the watch goes on for 180s after the traffic phases end"
    )
  })

  test('settleLine says when it settled and when it did not', () => {
    expect(settleLine({ settledSeconds: 8, timeoutSeconds: 120 })).toBe(
      'Eventing: settled in 8s'
    )
    expect(settleLine({ settledSeconds: null, timeoutSeconds: 120 })).toBe(
      'Eventing: not settled within 120s'
    )
  })

  test('readingsLine states both ends', () => {
    expect(
      readingsLine({
        start: { forwarded: { '0.1.0': 4, '0.2.0': 4 }, depth: 0 },
        end: { forwarded: { '0.1.0': 10, '0.2.0': 10 }, depth: 0 }
      })
    ).toBe(
      'Eventing readings: forwarded v0.1.0 4, v0.2.0 4, backlog 0 at the start; forwarded v0.1.0 10, v0.2.0 10, backlog 0 at the end'
    )
  })

  test('differentInstancesLine says the count was not measured', () => {
    expect(differentInstancesLine()).toBe(
      'Service Bus stand-in: not measured: the readings came from different gateway instances'
    )
  })
})

describe('peakDayReport and peakDayText', () => {
  const metrics = {
    'notifications_submitted{scenario:live-animals,submission:first}': {
      values: { count: 6 }
    },
    'notifications_submitted{scenario:high-risk-plants,submission:first}': {
      values: { count: 5 }
    },
    'external_events_published{scenario:live-animals}': {
      values: { count: 6 }
    },
    'event_arrivals{scenario:live-animals}': {
      values: { passes: 6, fails: 0, rate: 1 },
      thresholds: { 'rate==1': { ok: true } }
    },
    'service_bus_forwarded{schema_version:0.1.0}': { values: { value: 6 } },
    'service_bus_forwarded{schema_version:0.2.0}': { values: { value: 6 } },
    'dropped_iterations{scenario:live-animals}': { values: { count: 1 } }
  }
  const run = {
    line: 'Peak-day run: a line',
    environment: 'local',
    stubProfile: 'zero-delay',
    scenarioLength: 'local'
  }
  const report = peakDayReport({
    metrics,
    run,
    scenarios: ['live-animals', 'high-risk-plants']
  })

  test('carries the run, a row per journey and the dropped iterations', () => {
    expect(report.run).toBe(run)
    expect(report.journeys.map(({ scenario }) => scenario)).toEqual([
      'live-animals',
      'high-risk-plants'
    ])
    expect(report.droppedIterations).toEqual({
      'live-animals': 1,
      'high-risk-plants': 0
    })
  })

  test('writes the run line, each journey line and the thresholds', () => {
    const lines = peakDayText({ report, metrics }).split('\n')

    expect(lines[0]).toBe('Peak-day run: a line')
    expect(lines[1]).toContain('Live animals: 6 submitted')
    expect(lines[1]).toContain(
      'dashboard read model: 6 of 6 notifications arrived'
    )
    expect(lines[2]).toContain('High-risk plants: 5 submitted')
    expect(lines[2]).toContain('publishes no events today')
    expect(lines[3]).toBe(
      'Threshold event_arrivals{scenario:live-animals} rate==1: passed'
    )
    expect(lines.at(-1)).toBe('')
  })
})
