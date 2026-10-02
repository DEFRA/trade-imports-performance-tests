import { describe, expect, test } from 'vitest'

import {
  DESIGN_TARGETS,
  LOAD_PROFILES,
  SCENARIO_LENGTH_PROFILES,
  SHAPES,
  designTargetScenarios,
  localRunLine,
  phaseSchedule,
  requiredStubProfileFor,
  resolveLoadProfile,
  resolveScenarioLength,
  runLine,
  scenarioSetFor
} from './design-target.js'
import { SCENARIOS } from './smoke.js'
import { resolveTrafficModel } from './traffic.js'

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

describe('phaseSchedule', () => {
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
  const build = (shape, loadProfile = LOAD_PROFILES.TWO_JOURNEYS) => {
    const model = modelFor('full')
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

  test('states that a local run is a script check', () => {
    expect(localRunLine({ stubProfile: 'zero-delay' })).toBe(
      'Local run: a script check, not a measurement at design conditions: stubs zero-delay, background volume reported, not required, sessions compressed to the local length'
    )
  })
})
