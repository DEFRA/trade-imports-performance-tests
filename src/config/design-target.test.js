import { describe, expect, test } from 'vitest'

import {
  DESIGN_TARGETS,
  HOUR_PHASES,
  LOAD_PROFILES,
  SCENARIO_LENGTH_PROFILES,
  SHAPES,
  averageLoadFactors,
  averageLoadProfileLine,
  designTargetScenarios,
  hourLabel,
  hourPhase,
  journeyScenariosIn,
  percentText,
  segmentOf,
  localRunLine,
  phaseSchedule,
  requiredStubProfileFor,
  resolveLoadProfile,
  resolveScenarioLength,
  runLine,
  scenarioSetFor
} from './design-target.js'
import { SCENARIOS } from './smoke.js'
import { durationSeconds, resolveTrafficModel } from './traffic.js'

const modelFor = (length) =>
  resolveTrafficModel({}, SCENARIO_LENGTH_PROFILES[length])

const scheduleFor = (shape, length, loadProfile = LOAD_PROFILES.TWO_JOURNEYS) =>
  phaseSchedule({
    shape,
    model: modelFor(length),
    scenarioNames: Object.keys(scenarioSetFor(loadProfile))
  })

const pathOf = (value, path) =>
  path.split('.').reduce((current, key) => current[key], value)

describe('resolveScenarioLength', () => {
  test.each([
    ['local', 'local'],
    ['test', 'nightly'],
    ['perf-test', 'full']
  ])('gives a blank value in %s the %s length', (environment, length) => {
    expect(resolveScenarioLength({}, environment)).toBe(length)
  })

  test('allows nightly in local', () => {
    expect(resolveScenarioLength({ SCENARIO_LENGTH: 'nightly' }, 'local')).toBe(
      'nightly'
    )
  })

  test('refuses local outside local', () => {
    expect(() =>
      resolveScenarioLength({ SCENARIO_LENGTH: 'local' }, 'test')
    ).toThrow(
      'SCENARIO_LENGTH=local runs only when ENVIRONMENT is local: a CDP run measures at full or nightly length.'
    )
  })

  test('refuses an unknown length', () => {
    expect(() =>
      resolveScenarioLength({ SCENARIO_LENGTH: 'fast' }, 'local')
    ).toThrow('SCENARIO_LENGTH must be full, nightly or local, or unset.')
  })
})

describe('resolveLoadProfile', () => {
  test.each([
    [{}, 'two-journeys'],
    [{ LOAD_PROFILE: ' ' }, 'two-journeys'],
    [{ LOAD_PROFILE: 'two-journeys' }, 'two-journeys'],
    [{ LOAD_PROFILE: 'with-iuu' }, 'with-iuu']
  ])('reads %j as %s', (env, profile) => {
    expect(resolveLoadProfile(env)).toBe(profile)
  })

  test('refuses an unknown profile', () => {
    expect(() => resolveLoadProfile({ LOAD_PROFILE: 'all' })).toThrow(
      'LOAD_PROFILE must be two-journeys or with-iuu, or unset.'
    )
  })
})

describe('requiredStubProfileFor', () => {
  test('requires what STUB_PROFILE says in local', () => {
    expect(
      requiredStubProfileFor({ STUB_PROFILE: 'zero-delay' }, 'local')
    ).toBe('zero-delay')
  })

  test('requires nothing in local when STUB_PROFILE is unset', () => {
    expect(requiredStubProfileFor({}, 'local')).toBeUndefined()
  })

  test('requires sla in test when STUB_PROFILE is unset', () => {
    expect(requiredStubProfileFor({}, 'test')).toBe('sla')
  })

  test('refuses zero-delay outside local', () => {
    expect(() =>
      requiredStubProfileFor({ STUB_PROFILE: 'zero-delay' }, 'test')
    ).toThrow(
      'A design-target run outside local requires the sla stub profile; zero-delay is for script checks in local only'
    )
  })

  test('accepts sla in perf-test', () => {
    expect(requiredStubProfileFor({ STUB_PROFILE: 'sla' }, 'perf-test')).toBe(
      'sla'
    )
  })
})

describe('scenarioSetFor', () => {
  test('runs the four smoke scenarios for two journeys', () => {
    expect(Object.keys(scenarioSetFor('two-journeys'))).toEqual(
      Object.keys(SCENARIOS)
    )
  })

  test('adds the three IUU scenarios, with their exec names, for with-IUU', () => {
    const set = scenarioSetFor('with-iuu')

    expect(Object.keys(set)).toEqual([
      ...Object.keys(SCENARIOS),
      'iuu-journey-sessions',
      'iuu-front-door',
      'iuu-address-book'
    ])
    expect(set['iuu-journey-sessions'].exec).toBe('iuuJourneySession')
    expect(set['iuu-front-door'].exec).toBe('iuuFrontDoor')
    expect(set['iuu-address-book'].exec).toBe('iuuAddressBook')
  })
})

describe('hours of the weekday', () => {
  test('names the phase of each hour', () => {
    expect(hourPhase(0)).toBe('hour-00')
    expect(hourPhase(23)).toBe('hour-23')
    expect(HOUR_PHASES).toHaveLength(24)
  })

  test('labels each hour with two digits', () => {
    expect(hourLabel(9)).toBe('09:00')
    expect(hourLabel(23)).toBe('23:00')
  })

  test('writes a share as a percentage to one decimal place', () => {
    expect(percentText(0.25)).toBe('25%')
    expect(percentText(0.0417)).toBe('4.2%')
  })

  test('lists only the journey scenarios a scenario set runs', () => {
    expect(
      journeyScenariosIn({ 'high-risk-plants': {}, 'ins-front-door': {} })
    ).toEqual(['high-risk-plants'])
  })

  test.each([
    [0, 'overnight baseline'],
    [5, 'overnight baseline'],
    [6, 'ramp-up'],
    [9, 'sustained window'],
    [15, 'sustained window'],
    [16, 'early ramp-down'],
    [18, 'evening ramp-down'],
    [23, 'evening ramp-down']
  ])('puts hour %i in the %s row', (hour, segment) => {
    expect(segmentOf(hour)).toBe(segment)
  })
})

describe('averageLoadFactors', () => {
  test('runs the busiest hour at a quarter of the sustained peak rate', () => {
    expect(averageLoadFactors(modelFor('full'))[11]).toBe(0.25)
  })

  test('runs the overnight hour at 0.9% over the busiest 8%, over four', () => {
    expect(averageLoadFactors(modelFor('full'))[0]).toBeCloseTo(0.028125, 9)
  })

  test('averages about an eighth across the day', () => {
    const factors = averageLoadFactors(modelFor('full'))
    const mean = factors.reduce((sum, factor) => sum + factor, 0) / 24

    expect(mean).toBeCloseTo(0.1311, 4)
    expect(mean).toBeGreaterThan(0.12)
    expect(mean).toBeLessThan(0.14)
  })

  test('doubles the busiest hour when the seasonal peak factor is taken to 1', () => {
    const model = resolveTrafficModel({
      TRAFFIC_MODEL: '{"averageLoad":{"seasonalPeakFactor":1}}'
    })

    expect(averageLoadFactors(model)[11]).toBe(0.5)
  })
})

describe('averageLoadProfileLine', () => {
  test('states what the run took out and what is left', () => {
    expect(averageLoadProfileLine(modelFor('full'))).toBe(
      "Average weekday: seasonal peak factor (A1) 2 and design headroom (A3) 2 taken out, so the busiest hour runs at 25% of the sustained peak run's rate and the day averages 13.1% of it"
    )
  })
})

describe('phaseSchedule', () => {
  test('gives each weekday hour a phase, then the tail', () => {
    const schedule = scheduleFor(SHAPES.AVERAGE_LOAD, 'full')

    expect(schedule).toHaveLength(25)
    expect(schedule[0]).toEqual({
      phase: 'hour-00',
      startSeconds: 0,
      endSeconds: 3600,
      paceFactor: 1
    })
    expect(schedule[11]).toMatchObject({
      phase: 'hour-11',
      startSeconds: 39_600,
      endSeconds: 43_200
    })
    expect(schedule[23]).toMatchObject({
      phase: 'hour-23',
      startSeconds: 82_800,
      endSeconds: 86_400
    })
    expect(schedule[24]).toEqual({
      phase: 'tail',
      startSeconds: 86_400,
      endSeconds: null,
      paceFactor: 1
    })
    expect(schedule.every(({ paceFactor }) => paceFactor === 1)).toBe(true)
  })

  test.each([
    ['nightly', 14_400],
    ['local', 2880]
  ])('ends the weekday at %s length after %i seconds', (length, seconds) => {
    expect(scheduleFor(SHAPES.AVERAGE_LOAD, length)[23].endSeconds).toBe(
      seconds
    )
  })

  test('ramps 3h then holds 7h at full length', () => {
    expect(scheduleFor(SHAPES.SUSTAINED_PEAK, 'full')).toEqual([
      { phase: 'ramp', startSeconds: 0, endSeconds: 10_800, paceFactor: 1 },
      {
        phase: 'hold',
        startSeconds: 10_800,
        endSeconds: 36_000,
        paceFactor: 1
      },
      { phase: 'tail', startSeconds: 36_000, endSeconds: null, paceFactor: 1 }
    ])
  })

  test('ramps 1h then holds 2h at nightly length', () => {
    const [ramp, hold] = scheduleFor(SHAPES.SUSTAINED_PEAK, 'nightly')

    expect(ramp.endSeconds).toBe(3600)
    expect(hold.endSeconds).toBe(10_800)
  })

  test('warms up for the longest iteration, then peaks 30m, then bursts 60s at 1.5 times', () => {
    expect(scheduleFor(SHAPES.P99_BURST, 'full')).toEqual([
      { phase: 'warm-up', startSeconds: 0, endSeconds: 3000, paceFactor: 1 },
      { phase: 'peak', startSeconds: 3000, endSeconds: 4800, paceFactor: 1 },
      { phase: 'burst', startSeconds: 4800, endSeconds: 4860, paceFactor: 1.5 },
      { phase: 'tail', startSeconds: 4860, endSeconds: null, paceFactor: 1 }
    ])
  })

  test('warms up for 240 seconds at local length', () => {
    const [warmUp, peak] = scheduleFor(SHAPES.P99_BURST, 'local')

    expect(warmUp.endSeconds).toBe(240)
    expect(peak.endSeconds).toBe(240 + 4 * 60)
  })
})

describe('designTargetScenarios', () => {
  const build = (
    shape,
    loadProfile = LOAD_PROFILES.TWO_JOURNEYS,
    model = modelFor('full')
  ) => {
    const scenarioSet = scenarioSetFor(loadProfile)

    return designTargetScenarios({
      shape,
      model,
      scenarioSet,
      schedule: phaseSchedule({
        shape,
        model,
        scenarioNames: Object.keys(scenarioSet)
      })
    })
  }

  test.each([SHAPES.SUSTAINED_PEAK, SHAPES.P99_BURST])(
    'is an open model per hour with a journey tag for %s',
    (shape) => {
      for (const scenario of Object.values(build(shape))) {
        expect(scenario).toMatchObject({
          executor: 'ramping-arrival-rate',
          timeUnit: '1h'
        })
        expect(scenario).not.toHaveProperty('vus')
        expect(scenario.tags.journey).toBeTypeOf('string')
      }
    }
  )

  test('ramps live animals from 0 to 44 an hour over 3h, then holds 7h', () => {
    expect(build(SHAPES.SUSTAINED_PEAK)['live-animals']).toMatchObject({
      startRate: 0,
      stages: [
        { duration: '3h', target: 44 },
        { duration: '7h', target: 44 }
      ],
      preAllocatedVUs: 30,
      maxVUs: 60,
      gracefulStop: '4800s'
    })
  })

  test('holds live animals at 44 an hour for 4800s, then 66 for the burst minute', () => {
    expect(build(SHAPES.P99_BURST)['live-animals']).toMatchObject({
      startRate: 44,
      stages: [
        { duration: '4800s', target: 44 },
        { duration: '1s', target: 66 },
        { duration: '59s', target: 66 }
      ]
    })
  })

  test('builds a burst stage of 1s for the shortest burst the model allows', () => {
    const model = resolveTrafficModel({
      TRAFFIC_MODEL: '{"p99Burst":{"burstDuration":"2s"}}'
    })
    const scenarioSet = scenarioSetFor(LOAD_PROFILES.TWO_JOURNEYS)
    const scenarios = designTargetScenarios({
      shape: SHAPES.P99_BURST,
      model,
      scenarioSet,
      schedule: phaseSchedule({
        shape: SHAPES.P99_BURST,
        model,
        scenarioNames: Object.keys(scenarioSet)
      })
    })

    expect(scenarios['live-animals'].stages.slice(1)).toEqual([
      { duration: '1s', target: 66 },
      { duration: '1s', target: 66 }
    ])
  })

  describe('for average load', () => {
    test('counts every scenario per day, as an open model with a journey tag', () => {
      for (const scenario of Object.values(build(SHAPES.AVERAGE_LOAD))) {
        expect(scenario).toMatchObject({
          executor: 'ramping-arrival-rate',
          timeUnit: '24h'
        })
        expect(scenario).not.toHaveProperty('vus')
        expect(scenario.tags.journey).toBeTypeOf('string')
      }
    })

    test('steps live animals through 24 hours of paces, 30 overnight and 264 at 11:00', () => {
      const scenario = build(SHAPES.AVERAGE_LOAD)['live-animals']

      expect(scenario).toMatchObject({
        startRate: 30,
        preAllocatedVUs: 8,
        maxVUs: 16,
        gracefulStop: '4800s'
      })
      expect(scenario.stages).toHaveLength(47)
      expect(scenario.stages[0]).toEqual({ duration: '3600s', target: 30 })
      expect(scenario.stages.slice(21, 23)).toEqual([
        { duration: '1s', target: 264 },
        { duration: '3599s', target: 264 }
      ])
    })

    test('paces the other scenarios at a quarter of their peak rate at 11:00', () => {
      const scenarios = build(SHAPES.AVERAGE_LOAD)
      const hourEleven = (name) => scenarios[name].stages[21].target

      expect(hourEleven('high-risk-plants')).toBe(216)
      expect(hourEleven('ins-front-door')).toBe(480)
      expect(hourEleven('ins-address-book')).toBe(120)
    })

    test.each(['full', 'nightly', 'local'])(
      'fits 24 hours into the %s hour length, with each hour stepped in at its window start',
      (length) => {
        const model = modelFor(length)
        const hourSeconds = durationSeconds(model.averageLoad.hourDuration)
        const scenarios = build(
          SHAPES.AVERAGE_LOAD,
          LOAD_PROFILES.TWO_JOURNEYS,
          model
        )
        const schedule = phaseSchedule({
          shape: SHAPES.AVERAGE_LOAD,
          model,
          scenarioNames: Object.keys(scenarios)
        })

        for (const { stages } of Object.values(scenarios)) {
          const startOf = (index) =>
            stages
              .slice(0, index)
              .reduce((sum, { duration }) => sum + durationSeconds(duration), 0)
          const total = startOf(stages.length)

          expect(total).toBe(24 * hourSeconds)

          for (let hour = 1; hour < 24; hour++) {
            expect(stages[2 * hour - 1].duration).toBe('1s')
            expect(startOf(2 * hour - 1)).toBe(schedule[hour].startSeconds)
            expect(startOf(2 * hour - 1) + 1).toBe(startOf(2 * hour))
            expect(startOf(2 * hour + 1)).toBe(schedule[hour].endSeconds)
          }
        }
      }
    )

    test('steps in 1s and holds 1s for the shortest hour the model allows', () => {
      const model = resolveTrafficModel({
        TRAFFIC_MODEL: JSON.stringify({ averageLoad: { hourDuration: '2s' } })
      })
      const { stages } = build(
        SHAPES.AVERAGE_LOAD,
        LOAD_PROFILES.TWO_JOURNEYS,
        model
      )['live-animals']

      expect(stages[0].duration).toBe('2s')
      expect(stages.slice(1).every(({ duration }) => duration === '1s')).toBe(
        true
      )
      expect(stages).toHaveLength(47)
    })

    test('paces the IUU journey sessions at 2,064 a day at 11:00', () => {
      expect(
        build(SHAPES.AVERAGE_LOAD, 'with-iuu')['iuu-journey-sessions']
          .stages[21].target
      ).toBe(2064)
    })
  })

  test('sizes the IUU journey sessions at 344 an hour and 172 users', () => {
    const scenario = build(SHAPES.SUSTAINED_PEAK, 'with-iuu')[
      'iuu-journey-sessions'
    ]

    expect(scenario.stages[0].target).toBe(344)
    expect(scenario.preAllocatedVUs).toBe(172)
    expect(scenario.tags.journey).toBe('iuu-synthetic')
  })
})

describe('DESIGN_TARGETS', () => {
  test.each([
    ['live-animals.notificationsPerHour', 44],
    ['live-animals.frontendRps', 0.5],
    ['live-animals.backendRps', 0.5],
    ['live-animals.concurrentUsers', 22],
    ['live-animals.burstRps', 0.7],
    ['high-risk-plants.notificationsPerHour', 36],
    ['high-risk-plants.frontendRps', 0.5],
    ['high-risk-plants.concurrentUsers', 22],
    ['high-risk-plants.burstRps', 0.7],
    ['frontDoor.two-journeys.signInsPerHour', 200],
    ['frontDoor.two-journeys.coreRps', 0.4],
    ['frontDoor.two-journeys.concurrentUsers', 51],
    ['frontDoor.two-journeys.burstRps', 0.6],
    ['frontDoor.with-iuu.signInsPerHour', 770],
    ['frontDoor.with-iuu.coreRps', 1.5],
    ['frontDoor.with-iuu.concurrentUsers', 241],
    ['frontDoor.with-iuu.burstRps', 2.2],
    ['dashboardReadShare', 0.25],
    ['backendCallsPerPage', 1]
  ])('%s is %s', (path, expected) => {
    expect(pathOf(DESIGN_TARGETS, path)).toBe(expected)
  })
})

describe('run lines', () => {
  test('names a nightly sustained-peak run', () => {
    expect(
      runLine({
        shape: 'sustained-peak',
        loadProfile: 'two-journeys',
        scenarioLength: 'nightly',
        environment: 'test',
        stubProfile: 'sla',
        model: modelFor('nightly')
      })
    ).toBe(
      'Design-target run: sustained-peak, two-journeys profile, nightly length (ramp 1h, hold 2h), in test, requiring stub profile sla'
    )
  })

  test('names a burst run with its warm-up', () => {
    expect(
      runLine({
        shape: 'p99-burst',
        loadProfile: 'two-journeys',
        scenarioLength: 'full',
        environment: 'test',
        stubProfile: 'sla',
        model: modelFor('full')
      })
    ).toBe(
      'Design-target run: p99-burst, two-journeys profile, full length (warm-up 50m, peak 30m, burst 60s at 1.5x), in test, requiring stub profile sla'
    )
  })

  test.each([
    ['nightly', 'test', '10m each, 4h in all'],
    ['local', 'local', '2m each, 48m in all']
  ])('names an average-load run at %s length', (length, environment, text) => {
    expect(
      runLine({
        shape: 'average-load',
        loadProfile: 'two-journeys',
        scenarioLength: length,
        environment,
        stubProfile: 'sla',
        model: modelFor(length)
      })
    ).toBe(
      `Design-target run: average-load, two-journeys profile, ${length} length (24 weekday hours of ${text}), in ${environment}, requiring stub profile sla`
    )
  })

  test('states that a local run is a script check', () => {
    expect(localRunLine({ stubProfile: 'zero-delay' })).toBe(
      'Local run: a script check, not a measurement at design conditions: stubs zero-delay, background volume reported, not required, sessions compressed to the local length'
    )
  })
})
