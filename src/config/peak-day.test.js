import { describe, expect, test } from 'vitest'

import {
  PEAK_DAY_LENGTH_PROFILES,
  PEAK_DAY_SCENARIOS,
  peakDayLine,
  peakDayScenarios
} from './peak-day.js'
import { iterationSeconds, resolveTrafficModel } from './traffic.js'

const modelFor = (length, override) =>
  resolveTrafficModel(
    override === undefined ? {} : { TRAFFIC_MODEL: override },
    PEAK_DAY_LENGTH_PROFILES[length]
  )

describe('peakDayScenarios at full length', () => {
  const scenarios = peakDayScenarios(modelFor('full'))

  test('starts the peak-day volume of each journey over 12 hours', () => {
    expect(scenarios['live-animals']).toMatchObject({
      executor: 'constant-arrival-rate',
      rate: 546,
      timeUnit: '43200s',
      duration: '43200s',
      exec: 'liveAnimals',
      tags: { journey: 'live-animals' }
    })
    expect(scenarios['high-risk-plants']).toMatchObject({
      executor: 'constant-arrival-rate',
      rate: 442,
      timeUnit: '43200s',
      duration: '43200s',
      exec: 'highRiskPlants',
      tags: { journey: 'high-risk-plants' }
    })
  })

  test('holds only the two journeys', () => {
    expect(Object.keys(scenarios)).toEqual(Object.keys(PEAK_DAY_SCENARIOS))
  })

  test('sizes virtual users by Little law, including the arrival timeout', () => {
    const model = modelFor('full')
    const seconds = iterationSeconds(model)['live-animals'] + 60
    const preAllocatedVUs = Math.ceil((546 / 43200) * seconds)

    expect(scenarios['live-animals'].preAllocatedVUs).toBe(preAllocatedVUs)
    expect(scenarios['live-animals'].maxVUs).toBe(2 * preAllocatedVUs)
    expect(scenarios['live-animals'].gracefulStop).toBe(`${2 * seconds}s`)
  })
})

describe('peakDayScenarios at local length', () => {
  const scenarios = peakDayScenarios(modelFor('local'))

  test('starts 6 and 5 notifications over six minutes', () => {
    expect(scenarios['live-animals']).toMatchObject({
      rate: 6,
      timeUnit: '360s',
      duration: '360s'
    })
    expect(scenarios['high-risk-plants']).toMatchObject({
      rate: 5,
      timeUnit: '360s',
      duration: '360s'
    })
  })

  test('sizes virtual users for two-minute sessions plus the arrival timeout', () => {
    const model = modelFor('local')
    const seconds = iterationSeconds(model)['high-risk-plants'] + 60

    expect(scenarios['high-risk-plants'].preAllocatedVUs).toBe(
      Math.ceil(((5 * 3600) / 360 / 3600) * seconds)
    )
  })
})

describe('peakDayScenarios with an override', () => {
  test('a TRAFFIC_MODEL override changes the rate', () => {
    const scenarios = peakDayScenarios(
      modelFor('full', '{"peakDay":{"liveAnimalsNotifications":100}}')
    )

    expect(scenarios['live-animals'].rate).toBe(100)
    expect(scenarios['high-risk-plants'].rate).toBe(442)
  })
})

describe('peakDayLine', () => {
  test('names the figures, environment and stub profile', () => {
    expect(
      peakDayLine({
        model: modelFor('nightly'),
        scenarioLength: 'nightly',
        environment: 'test',
        stubProfile: 'sla'
      })
    ).toBe(
      'Peak-day run: 546 live-animals and 442 high-risk-plants notifications over 12h, in test, requiring stub profile sla'
    )
  })

  test('says a local run is a script check', () => {
    expect(
      peakDayLine({
        model: modelFor('local'),
        scenarioLength: 'local',
        environment: 'local',
        stubProfile: undefined
      })
    ).toBe(
      'Peak-day run: 6 live-animals and 5 high-risk-plants notifications over 6m, in local, requiring stub profile none, a script check, not the peak-day volume'
    )
  })
})
