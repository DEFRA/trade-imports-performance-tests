import { describe, expect, test } from 'vitest'

import { DATASTORES as LIB_DATASTORES } from '../lib/background-volume.js'
import {
  BACKGROUND_SCENARIOS,
  DATASTORES,
  backgroundScenarios,
  indexesBuiltLine,
  targetsFrom
} from './background-volume.js'
import {
  BACKGROUND_VOLUME_PROFILE,
  TRAFFIC_DEFAULTS,
  resolveTrafficModel
} from './traffic.js'

describe('DATASTORES', () => {
  test('is the very list the lib names datastores from', () => {
    expect(DATASTORES).toBe(LIB_DATASTORES)
  })
})

describe('targetsFrom', () => {
  test('is a year of each journey and the address-book entries, with no read-model target', () => {
    expect(targetsFrom(TRAFFIC_DEFAULTS.backgroundVolume)).toEqual({
      'live-animals': 42000,
      'high-risk-plants': 34000,
      'address-book': 500
    })
  })
})

describe('backgroundScenarios', () => {
  const scenarios = backgroundScenarios(
    resolveTrafficModel({}, BACKGROUND_VOLUME_PROFILE)
  )

  test('shares each target out over ten virtual users for up to 24h', () => {
    expect(scenarios).toEqual({
      'seed-live-animals': {
        executor: 'shared-iterations',
        iterations: 42000,
        vus: 10,
        maxDuration: '24h',
        exec: 'seedLiveAnimals'
      },
      'seed-high-risk-plants': {
        executor: 'shared-iterations',
        iterations: 34000,
        vus: 10,
        maxDuration: '24h',
        exec: 'seedHighRiskPlants'
      },
      'seed-address-book': {
        executor: 'shared-iterations',
        iterations: 500,
        vus: 10,
        maxDuration: '24h',
        exec: 'seedAddressBook'
      }
    })
  })

  test('caps iterations at maxCreatedPerRun', () => {
    const capped = backgroundScenarios(
      resolveTrafficModel({
        TRAFFIC_MODEL: '{"backgroundVolume":{"maxCreatedPerRun":2}}'
      })
    )

    for (const scenario of Object.values(capped)) {
      expect(scenario.iterations).toBe(2)
      expect(scenario.vus).toBe(2)
    }
  })

  test('gives one iteration and one virtual user for targets of 1', () => {
    const one = backgroundScenarios(
      resolveTrafficModel({
        TRAFFIC_MODEL:
          '{"backgroundVolume":{"liveAnimalsNotifications":1,"highRiskPlantsNotifications":1,"addressBookEntries":1}}'
      })
    )

    for (const scenario of Object.values(one)) {
      expect(scenario.iterations).toBe(1)
      expect(scenario.vus).toBe(1)
    }
  })

  test('gives each scenario its own exec', () => {
    const execs = Object.values(BACKGROUND_SCENARIOS).map(({ exec }) => exec)

    expect(new Set(execs).size).toBe(execs.length)
  })
})

describe('indexesBuiltLine', () => {
  test('names all four owning services', () => {
    const line = indexesBuiltLine()

    for (const service of [
      'animals backend',
      'plants backend',
      'INS backend',
      'address book'
    ]) {
      expect(line).toContain(service)
    }
  })

  test('starts with the text the gate looks for', () => {
    expect(indexesBuiltLine()).toMatch(/^Indexes: built in the /)
  })
})
