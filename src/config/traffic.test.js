import { describe, expect, test } from 'vitest'

import { SCENARIOS } from './smoke.js'
import {
  BACKGROUND_VOLUME_PROFILE,
  SMOKE_PROFILE,
  TRAFFIC_DEFAULTS,
  amendmentPlan,
  arrivalScenarios,
  durationSeconds,
  durationText,
  frontDoorThinkSecondsMean,
  gracefulStopFor,
  isChosen,
  iterationSeconds,
  iuuThinkSecondsMean,
  resolveTrafficModel,
  scenarioPagesPerHour,
  scenarioRates,
  sessionsFor,
  thinkSecondsMean,
  virtualUsersFor
} from './traffic.js'

const MAX_SMOKE_VUS = 5
const SECONDS_PER_MINUTE = 60

const pathOf = (model, path) =>
  path.split('.').reduce((value, key) => value[key], model)

describe('TRAFFIC_DEFAULTS', () => {
  test.each([
    ['liveAnimals.pagesPerNotification', 40],
    ['liveAnimals.sessionMinutes', 20],
    ['highRiskPlants.pagesPerNotification', 50],
    ['highRiskPlants.sessionMinutes', 25],
    ['liveAnimals.sessionsPerNotification', 1.5],
    ['highRiskPlants.sessionsPerNotification', 1.5],
    ['frontDoor.corePagesPerJourneySession', 6],
    ['frontDoor.dashboardOnlySessionsPerNotification', 1],
    ['frontDoor.dashboardOnlySessionMinutes', 5],
    ['frontDoor.pagesPerDashboardOnlySession', 8],
    ['frontDoor.addressBookSessionsPerNotification', 0.25],
    ['mix.dashboardReadShareTarget', 0.25],
    ['liveAnimals.notificationsPerHour', 44],
    ['highRiskPlants.notificationsPerHour', 36],
    ['liveAnimals.amendShare', 0.2],
    ['liveAnimals.cancelAmendShare', 0.05],
    ['highRiskPlants.amendShare', 0.2],
    ['highRiskPlants.cancelAmendShare', 0.05],
    ['addressBook.worstCaseSearchShare', 0.25],
    ['backgroundVolume.liveAnimalsNotifications', 42000],
    ['backgroundVolume.highRiskPlantsNotifications', 34000],
    ['backgroundVolume.addressBookEntries', 500],
    ['backgroundVolume.maxCreatedPerRun', 42000],
    ['backgroundVolume.virtualUsers', 10],
    ['backgroundVolume.maxDuration', '24h'],
    ['liveAnimals.documentKilobytes.min', 100],
    ['liveAnimals.documentKilobytes.max', 5000],
    ['iuu.notificationsPerHour', 229],
    ['iuu.sessionsPerNotification', 1.5],
    ['iuu.sessionMinutes', 30],
    ['sustainedPeak.rampDuration', '3h'],
    ['sustainedPeak.holdDuration', '7h'],
    ['p99Burst.peakDuration', '30m'],
    ['p99Burst.burstDuration', '60s'],
    ['p99Burst.burstFactor', 1.5],
    ['averageLoad.hourDuration', '1h'],
    ['averageLoad.seasonalPeakFactor', 2],
    ['averageLoad.designHeadroom', 2],
    ['spikeRecovery.baselineDuration', '5m'],
    ['spikeRecovery.spikeDuration', '10s'],
    ['spikeRecovery.recoveryDuration', '60s'],
    ['spikeRecovery.recoveredDuration', '2m'],
    ['spikeRecovery.capacityRps.ins', 5],
    ['spikeRecovery.capacityRps.animals', 5],
    ['spikeRecovery.capacityRps.plants', 5],
    ['spikeRecovery.capacityRps.iuu', 15],
    ['endurance.holdDuration', '8h'],
    ['endurance.comparisonWindow', '1h'],
    ['endurance.sessionExpiry', 'frontend'],
    ['endurance.sessionLifetime', '4h'],
    ['endurance.visitInterval', '10m'],
    ['endurance.returningUsersPerFrontend', 1]
  ])('%s is %s', (path, expected) => {
    expect(pathOf(TRAFFIC_DEFAULTS, path)).toBe(expected)
  })

  test('holds 24 weekday shares, busiest at 11:00 with 8%, adding up to 100.7%', () => {
    const shares = TRAFFIC_DEFAULTS.averageLoad.hourlyShares

    expect(shares).toHaveLength(24)
    expect(Math.max(...shares)).toBe(0.08)
    expect(shares.indexOf(0.08)).toBe(11)
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1.007, 6)
  })

  test.each([
    [
      'liveAnimals.documentsPerNotification',
      [0.3, 0.45, 0.2, 0.05],
      [0, 1, 2, 3]
    ],
    [
      'highRiskPlants.commodityLinesPerNotification',
      [0.5, 0.3, 0.15, 0.05],
      [1, 4, 11, 26]
    ]
  ])('%s has the stated shares and minimums', (path, shares, minimums) => {
    const buckets = pathOf(TRAFFIC_DEFAULTS, path)

    expect(buckets.map(({ share }) => share)).toEqual(shares)
    expect(buckets.map(({ min }) => min)).toEqual(minimums)
  })

  test('has 50 as the largest number of commodity lines', () => {
    expect(
      TRAFFIC_DEFAULTS.highRiskPlants.commodityLinesPerNotification.at(-1).max
    ).toBe(50)
  })

  test('draws documents from PDF and JPEG', () => {
    expect(
      TRAFFIC_DEFAULTS.liveAnimals.documentTypes.map(({ value }) => value)
    ).toEqual(['pdf', 'jpeg'])
  })

  test('mean documents per notification is 1', () => {
    const mean = TRAFFIC_DEFAULTS.liveAnimals.documentsPerNotification.reduce(
      (sum, { share, max }) => sum + share * max,
      0
    )

    expect(mean).toBeCloseTo(1)
  })
})

describe('SMOKE_PROFILE', () => {
  test('amends every notification and runs a worst-case search every time', () => {
    const model = resolveTrafficModel({}, SMOKE_PROFILE)

    expect(model.liveAnimals.amendShare).toBe(1)
    expect(model.highRiskPlants.amendShare).toBe(1)
    expect(model.addressBook.worstCaseSearchShare).toBe(1)
  })
})

describe('BACKGROUND_VOLUME_PROFILE', () => {
  const model = resolveTrafficModel({}, BACKGROUND_VOLUME_PROFILE)

  test('resolves, with no documents, one session and one page for each notification', () => {
    expect(model.liveAnimals.documentsPerNotification).toEqual([
      { share: 1, min: 0, max: 0 }
    ])
    expect(model.liveAnimals.sessionsPerNotification).toBe(1)
    expect(model.highRiskPlants.sessionsPerNotification).toBe(1)
    expect(model.liveAnimals.pagesPerNotification).toBe(1)
    expect(model.highRiskPlants.pagesPerNotification).toBe(1)
  })

  test('runs no worst-case search and no extra INS status check', () => {
    expect(model.addressBook.worstCaseSearchShare).toBe(0)
    expect(model.frontDoor.corePagesPerJourneySession).toBe(2)
  })

  test('leaves amendments, commodity types and commodity lines as journey traffic has them', () => {
    expect(model.liveAnimals.amendShare).toBe(0.2)
    expect(model.liveAnimals.cancelAmendShare).toBe(0.05)
    expect(model.highRiskPlants.amendShare).toBe(0.2)
    expect(model.highRiskPlants.commodityTypes).toEqual(
      TRAFFIC_DEFAULTS.highRiskPlants.commodityTypes
    )
    expect(model.highRiskPlants.commodityLinesPerNotification).toEqual(
      TRAFFIC_DEFAULTS.highRiskPlants.commodityLinesPerNotification
    )
  })

  test.each([
    [
      '{"backgroundVolume":{"maxDuration":"1 day"}}',
      'Traffic model value "backgroundVolume.maxDuration" must be a duration such as 2m'
    ],
    [
      '{"backgroundVolume":{"virtualUsers":2.5}}',
      'Traffic model value "backgroundVolume.virtualUsers" must be a whole number'
    ],
    [
      '{"backgroundVolume":{"maxCreatedPerRun":0}}',
      'Traffic model value "backgroundVolume.maxCreatedPerRun" must be a positive number'
    ],
    [
      '{"backgroundVolume":{"addressBookEntries":-1}}',
      'Traffic model value "backgroundVolume.addressBookEntries" must be a positive number'
    ]
  ])('rejects %s', (text, message) => {
    expect(() =>
      resolveTrafficModel({ TRAFFIC_MODEL: text }, BACKGROUND_VOLUME_PROFILE)
    ).toThrow(message)
  })
})

describe('distribution overrides', () => {
  test('replaces a distribution whole', () => {
    const model = resolveTrafficModel({
      TRAFFIC_MODEL:
        '{"highRiskPlants":{"commodityLinesPerNotification":[{"share":1,"min":50,"max":50}]}}'
    })

    expect(model.highRiskPlants.commodityLinesPerNotification).toEqual([
      { share: 1, min: 50, max: 50 }
    ])
  })

  test('accepts live animals with no documents', () => {
    const model = resolveTrafficModel({
      TRAFFIC_MODEL:
        '{"liveAnimals":{"documentsPerNotification":[{"share":1,"min":0,"max":0}]}}'
    })

    expect(model.liveAnimals.documentsPerNotification).toEqual([
      { share: 1, min: 0, max: 0 }
    ])
  })

  test.each([
    [
      '{"highRiskPlants":{"commodityLinesPerNotification":[{"share":0.5,"min":1,"max":3}]}}',
      'Traffic model value "highRiskPlants.commodityLinesPerNotification" must be buckets whose shares add up to 1'
    ],
    [
      '{"highRiskPlants":{"commodityLinesPerNotification":[{"share":1,"min":5,"max":3}]}}',
      'Traffic model value "highRiskPlants.commodityLinesPerNotification" must be buckets of whole numbers from min to max, with min at least 1'
    ],
    [
      '{"highRiskPlants":{"commodityLinesPerNotification":[{"share":1,"min":0,"max":0}]}}',
      'Traffic model value "highRiskPlants.commodityLinesPerNotification" must be buckets of whole numbers from min to max, with min at least 1'
    ],
    [
      '{"liveAnimals":{"documentsPerNotification":[{"share":1,"min":0.5,"max":2}]}}',
      'Traffic model value "liveAnimals.documentsPerNotification" must be buckets of whole numbers from min to max, with min at least 0'
    ],
    [
      '{"liveAnimals":{"documentTypes":[{"share":1,"value":"gif"}]}}',
      'Traffic model value "liveAnimals.documentTypes" must be buckets of pdf, jpeg'
    ],
    [
      '{"highRiskPlants":{"commodityTypes":[{"share":1,"value":"seeds"}]}}',
      'Traffic model value "highRiskPlants.commodityTypes" must be buckets of plants-for-planting, potatoes, wood-and-cut-trees'
    ],
    [
      '{"liveAnimals":{"documentsPerNotification":3}}',
      'Traffic model value "liveAnimals.documentsPerNotification" must be a list of buckets'
    ],
    [
      '{"liveAnimals":{"documentsPerNotification":[]}}',
      'Traffic model value "liveAnimals.documentsPerNotification" must be a list of buckets'
    ],
    [
      '{"liveAnimals":{"documentKilobytes":{"min":100,"max":10001}}}',
      'Traffic model value "liveAnimals.documentKilobytes" must be a range from min to max of at most 10000'
    ],
    [
      '{"liveAnimals":{"documentKilobytes":{"min":600,"max":500}}}',
      'Traffic model value "liveAnimals.documentKilobytes" must be a range from min to max of at most 10000'
    ],
    [
      '{"addressBook":{"worstCaseSearchShare":2}}',
      'Traffic model value "addressBook.worstCaseSearchShare" must be between 0 and 1'
    ]
  ])('rejects %s', (text, message) => {
    expect(() => resolveTrafficModel({ TRAFFIC_MODEL: text })).toThrow(message)
  })
})

describe('resolveTrafficModel', () => {
  test('returns the defaults laid under the profile when nothing overrides them', () => {
    const model = resolveTrafficModel({}, SMOKE_PROFILE)

    expect(model.liveAnimals.pagesPerNotification).toBe(40)
    expect(model.liveAnimals.notificationsPerHour).toBe(20)
    expect(model.liveAnimals.sessionMinutes).toBe(1)
    expect(model.highRiskPlants.cancelAmendShare).toBe(0)
    expect(model.frontDoor.dashboardOnlySessionMinutes).toBe(0.25)
  })

  test('lets TRAFFIC_MODEL win over the profile and keeps untouched keys', () => {
    const model = resolveTrafficModel(
      {
        TRAFFIC_MODEL:
          '{"liveAnimals":{"notificationsPerHour":7,"pagesPerNotification":45}}'
      },
      SMOKE_PROFILE
    )

    expect(model.liveAnimals.notificationsPerHour).toBe(7)
    expect(model.liveAnimals.pagesPerNotification).toBe(45)
    expect(model.liveAnimals.sessionMinutes).toBe(1)
    expect(model.highRiskPlants.pagesPerNotification).toBe(50)
  })

  test('ignores a blank TRAFFIC_MODEL', () => {
    expect(resolveTrafficModel({ TRAFFIC_MODEL: '  ' })).toEqual(
      TRAFFIC_DEFAULTS
    )
  })

  test('returns a frozen model', () => {
    expect(Object.isFrozen(resolveTrafficModel({}).liveAnimals)).toBe(true)
  })

  test.each([
    ['{not json', 'TRAFFIC_MODEL is not valid JSON'],
    ['[1]', 'TRAFFIC_MODEL is not valid JSON'],
    [
      '{"liveAnimals":{"bogus":1}}',
      'Unknown traffic model key "liveAnimals.bogus"'
    ],
    ['{"bogus":1}', 'Unknown traffic model key "bogus"'],
    [
      '{"liveAnimals":{"pagesPerNotification":0}}',
      'Traffic model value "liveAnimals.pagesPerNotification" must be a positive number'
    ],
    [
      '{"liveAnimals":{"pagesPerNotification":-3}}',
      'Traffic model value "liveAnimals.pagesPerNotification" must be a positive number'
    ],
    [
      '{"liveAnimals":{"pagesPerNotification":"forty"}}',
      'Traffic model value "liveAnimals.pagesPerNotification" must be a positive number'
    ],
    [
      '{"liveAnimals":{"notificationsPerHour":2.5}}',
      'Traffic model value "liveAnimals.notificationsPerHour" must be a whole number'
    ],
    [
      '{"liveAnimals":{"amendShare":1.5}}',
      'Traffic model value "liveAnimals.amendShare" must be between 0 and 1'
    ],
    [
      '{"liveAnimals":3}',
      'Traffic model value "liveAnimals" must be an object'
    ],
    [
      '{"duration":"soon"}',
      'Traffic model value "duration" must be a duration such as 2m'
    ],
    [
      '{"p99Burst":{"burstDuration":"1 minute"}}',
      'Traffic model value "p99Burst.burstDuration" must be a duration such as 2m'
    ],
    [
      '{"iuu":{"notificationsPerHour":228.6}}',
      'Traffic model value "iuu.notificationsPerHour" must be a whole number'
    ]
  ])('rejects %s', (text, message) => {
    expect(() => resolveTrafficModel({ TRAFFIC_MODEL: text })).toThrow(message)
  })

  test('rejects a spike shorter than two seconds', () => {
    expect(() =>
      resolveTrafficModel({
        TRAFFIC_MODEL: '{"spikeRecovery":{"spikeDuration":"1s"}}'
      })
    ).toThrow(
      "TRAFFIC_MODEL spikeRecovery.spikeDuration must be at least 2s, got '1s'"
    )
  })

  test('rejects comparison windows that overlap', () => {
    expect(() =>
      resolveTrafficModel({
        TRAFFIC_MODEL: '{"endurance":{"comparisonWindow":"5h"}}'
      })
    ).toThrow(
      "TRAFFIC_MODEL endurance.comparisonWindow must be at most half of endurance.holdDuration, got '5h' and '8h'"
    )
  })

  test('rejects a session expiry that is neither frontend nor client', () => {
    expect(() =>
      resolveTrafficModel({
        TRAFFIC_MODEL: '{"endurance":{"sessionExpiry":"never"}}'
      })
    ).toThrow(
      'Traffic model value "endurance.sessionExpiry" must be one of frontend, client'
    )
  })

  test('rejects a fractional number of returning users', () => {
    expect(() =>
      resolveTrafficModel({
        TRAFFIC_MODEL: '{"endurance":{"returningUsersPerFrontend":1.5}}'
      })
    ).toThrow(
      'Traffic model value "endurance.returningUsersPerFrontend" must be a whole number'
    )
  })

  test.each(['0s', '1s'])('rejects a burst duration of %s', (duration) => {
    expect(() =>
      resolveTrafficModel({
        TRAFFIC_MODEL: JSON.stringify({ p99Burst: { burstDuration: duration } })
      })
    ).toThrow(
      `TRAFFIC_MODEL p99Burst.burstDuration must be at least 2s, got '${duration}'`
    )
  })

  test('accepts a burst duration of 2s', () => {
    expect(
      resolveTrafficModel({
        TRAFFIC_MODEL: '{"p99Burst":{"burstDuration":"2s"}}'
      }).p99Burst.burstDuration
    ).toBe('2s')
  })

  test.each([
    JSON.stringify({ averageLoad: { hourlyShares: [0.5] } }),
    JSON.stringify({
      averageLoad: { hourlyShares: [...Array(23).fill(0.04), 1.5] }
    }),
    JSON.stringify({ averageLoad: { hourlyShares: Array(24).fill(0) } }),
    JSON.stringify({
      averageLoad: { hourlyShares: [...Array(23).fill(0.04), -0.1] }
    }),
    JSON.stringify({ averageLoad: { hourlyShares: 0.04 } }),
    JSON.stringify({ averageLoad: { hourlyShares: 'flat' } })
  ])('rejects the weekday shares in %s', (text) => {
    expect(() => resolveTrafficModel({ TRAFFIC_MODEL: text })).toThrow(
      'Traffic model value "averageLoad.hourlyShares" must be 24 shares from 0 to 1, at least one above 0'
    )
  })

  test('accepts a whole replacement list of 24 weekday shares', () => {
    const hourlyShares = Array(24).fill(0.04)

    expect(
      resolveTrafficModel({
        TRAFFIC_MODEL: JSON.stringify({ averageLoad: { hourlyShares } })
      }).averageLoad.hourlyShares
    ).toEqual(hourlyShares)
  })

  test('rejects an hour that is not a duration', () => {
    expect(() =>
      resolveTrafficModel({
        TRAFFIC_MODEL: '{"averageLoad":{"hourDuration":"an hour"}}'
      })
    ).toThrow(
      'Traffic model value "averageLoad.hourDuration" must be a duration such as 2m'
    )
  })

  test('rejects an hour of 1s', () => {
    expect(() =>
      resolveTrafficModel({
        TRAFFIC_MODEL: '{"averageLoad":{"hourDuration":"1s"}}'
      })
    ).toThrow(
      "TRAFFIC_MODEL averageLoad.hourDuration must be at least 2s, got '1s'"
    )
  })

  test('accepts a share of 0', () => {
    expect(
      resolveTrafficModel({
        TRAFFIC_MODEL: '{"highRiskPlants":{"cancelAmendShare":0}}'
      }).highRiskPlants.cancelAmendShare
    ).toBe(0)
  })
})

describe('think time', () => {
  test('spreads the session over its journey pages and the INS core pages', () => {
    const { liveAnimals, highRiskPlants, frontDoor } = TRAFFIC_DEFAULTS

    expect(thinkSecondsMean(liveAnimals, frontDoor)).toBeCloseTo(
      1200 / (40 / 1.5 + 5)
    )
    expect(thinkSecondsMean(highRiskPlants, frontDoor)).toBeCloseTo(
      1500 / (50 / 1.5 + 5)
    )
  })

  test.each([
    ['live animals', TRAFFIC_DEFAULTS.liveAnimals],
    ['high-risk plants', TRAFFIC_DEFAULTS.highRiskPlants]
  ])('adds up to the session length for %s', (_name, journey) => {
    const { frontDoor } = TRAFFIC_DEFAULTS
    const pagesWithWait =
      journey.pagesPerNotification / journey.sessionsPerNotification +
      frontDoor.corePagesPerJourneySession -
      1

    expect(thinkSecondsMean(journey, frontDoor) * pagesWithWait).toBeCloseTo(
      journey.sessionMinutes * SECONDS_PER_MINUTE
    )
  })

  test('spreads a dashboard-only session over its pages', () => {
    expect(frontDoorThinkSecondsMean(TRAFFIC_DEFAULTS.frontDoor)).toBeCloseTo(
      37.5
    )
  })
})

describe('sessionsFor', () => {
  test('gives 2, 1, 2, 1 at 1.5 sessions and averages exactly 1.5', () => {
    const sessions = [0, 1, 2, 3].map((iteration) =>
      sessionsFor(iteration, 1.5)
    )

    expect(sessions).toEqual([2, 1, 2, 1])
    expect(sessions.reduce((sum, count) => sum + count, 0) / 4).toBe(1.5)
  })

  test.each([1, 2])(
    'gives every notification %s sessions',
    (perNotification) => {
      for (const iteration of [0, 1, 2, 3]) {
        expect(sessionsFor(iteration, perNotification)).toBe(perNotification)
      }
    }
  )
})

describe('isChosen', () => {
  test('picks iterations 1 and 3 at a share of 0.5', () => {
    expect(
      [0, 1, 2, 3].filter((iteration) => isChosen(iteration, 0.5))
    ).toEqual([1, 3])
  })

  test('picks every iteration at 1 and none at 0', () => {
    expect([0, 1, 2, 3].every((iteration) => isChosen(iteration, 1))).toBe(true)
    expect([0, 1, 2, 3].some((iteration) => isChosen(iteration, 0))).toBe(false)
  })
})

describe('amendmentPlan', () => {
  const iterations = [0, 1, 2, 3, 4, 5, 6, 7]
  const plansFor = (shares) =>
    iterations.map((iteration) => amendmentPlan(iteration, shares))

  test('cancels half of the amended notifications, not all of them', () => {
    const plans = plansFor({ amendShare: 0.5, cancelAmendShare: 0.5 })

    expect(plans.filter((plan) => plan.amends)).toHaveLength(4)
    expect(plans.filter((plan) => plan.cancelsAmendment)).toHaveLength(2)
  })

  test('only cancels notifications that are amended', () => {
    const plans = plansFor({ amendShare: 0.5, cancelAmendShare: 1 })

    expect(plans.every((plan) => plan.amends || !plan.cancelsAmendment)).toBe(
      true
    )
  })

  test('matches the plain cancel share when every notification is amended', () => {
    const plans = plansFor({ amendShare: 1, cancelAmendShare: 0.5 })

    expect(plans.map((plan) => plan.cancelsAmendment)).toEqual(
      iterations.map((iteration) => isChosen(iteration, 0.5))
    )
  })

  test('amends 20 and cancels 1 of 100 notifications at the c-012 defaults', () => {
    const plans = Array.from({ length: 100 }, (_, iteration) =>
      amendmentPlan(iteration, TRAFFIC_DEFAULTS.liveAnimals)
    )

    expect(plans.filter((plan) => plan.amends)).toHaveLength(20)
    expect(plans.filter((plan) => plan.cancelsAmendment)).toHaveLength(1)
  })

  test('amends and cancels nothing at an amend share of 0', () => {
    const plans = plansFor({ amendShare: 0, cancelAmendShare: 1 })

    expect(plans.some((plan) => plan.amends || plan.cancelsAmendment)).toBe(
      false
    )
  })
})

describe('scenarioRates', () => {
  test('follows the journeys at the design figures', () => {
    expect(scenarioRates(resolveTrafficModel({}))).toEqual({
      'live-animals': 44,
      'high-risk-plants': 36,
      'ins-front-door': 80,
      'ins-address-book': 20,
      'iuu-journey-sessions': 344,
      'iuu-front-door': 229,
      'iuu-address-book': 57
    })
  })

  test('never drops below one an hour', () => {
    const model = resolveTrafficModel({
      TRAFFIC_MODEL:
        '{"frontDoor":{"addressBookSessionsPerNotification":0.001},"liveAnimals":{"notificationsPerHour":1},"highRiskPlants":{"notificationsPerHour":1}}'
    })

    expect(scenarioRates(model)['ins-address-book']).toBe(1)
  })
})

describe('scenarioPagesPerHour', () => {
  test('counts the page requests each scenario puts on each frontend at the design rates', () => {
    expect(scenarioPagesPerHour(resolveTrafficModel({}))).toEqual({
      'live-animals': { animals: 1760, ins: 396 },
      'high-risk-plants': { plants: 1800, ins: 324 },
      'ins-front-door': { ins: 640 },
      'ins-address-book': { ins: 240 },
      'iuu-journey-sessions': { iuu: 2064 },
      'iuu-front-door': { iuu: 1832 },
      'iuu-address-book': { iuu: 684 }
    })
  })
})

describe('iterationSeconds', () => {
  test('lasts as many sessions as the journey can have', () => {
    const seconds = iterationSeconds(resolveTrafficModel({}))

    expect(seconds['live-animals']).toBe(2 * 20 * SECONDS_PER_MINUTE)
    expect(seconds['high-risk-plants']).toBe(2 * 25 * SECONDS_PER_MINUTE)
    expect(seconds['ins-front-door']).toBe(5 * SECONDS_PER_MINUTE)
    expect(seconds['iuu-journey-sessions']).toBe(1800)
  })
})

describe('durationSeconds', () => {
  test.each([
    ['60s', 60],
    ['2m', 120],
    ['3h', 10_800]
  ])('reads %s as %s seconds', (duration, seconds) => {
    expect(durationSeconds(duration)).toBe(seconds)
  })

  test('throws for a value that is not a duration', () => {
    expect(() => durationSeconds('soon')).toThrow(
      '"soon" is not a duration such as 2m'
    )
  })
})

describe('durationText', () => {
  test.each([
    [7200, '2h'],
    [1800, '30m'],
    [90, '90s']
  ])('writes %d seconds as %s', (seconds, text) => {
    expect(durationText(seconds)).toBe(text)
  })
})

describe('iuuThinkSecondsMean', () => {
  test('spreads the IUU session over its status checks, the sign-in having no wait', () => {
    expect(iuuThinkSecondsMean(resolveTrafficModel({}))).toBe(360)
  })
})

describe('virtualUsersFor and gracefulStopFor', () => {
  test('sizes the users from the rate and the longest iteration', () => {
    expect(virtualUsersFor(44, 2400)).toEqual({
      preAllocatedVUs: 30,
      maxVUs: 60
    })
  })

  test('allows twice the longest iteration to finish', () => {
    expect(gracefulStopFor(2400)).toBe('4800s')
  })
})

describe('arrivalScenarios', () => {
  const model = resolveTrafficModel({})
  const scenarios = arrivalScenarios(model, SCENARIOS)

  test('has one scenario per entry, with its exec function', () => {
    expect(Object.keys(scenarios)).toEqual(Object.keys(SCENARIOS))

    for (const [name, scenario] of Object.entries(scenarios)) {
      expect(scenario.exec).toBe(SCENARIOS[name].exec)
    }
  })

  test('is an open model: arrival-rate executors per hour, never a fixed number of users', () => {
    for (const scenario of Object.values(scenarios)) {
      expect(scenario).toMatchObject({
        executor: 'constant-arrival-rate',
        timeUnit: '1h'
      })
      expect(scenario).not.toHaveProperty('vus')
    }
  })

  test('states the rate in whole iterations an hour', () => {
    expect(scenarios['live-animals'].rate).toBe(44)
    expect(scenarios['ins-front-door'].rate).toBe(80)
  })

  test('allows twice the pre-allocated virtual users and twice the longest iteration to finish', () => {
    const seconds = iterationSeconds(model)

    for (const [name, scenario] of Object.entries(scenarios)) {
      expect(scenario.maxVUs).toBe(2 * scenario.preAllocatedVUs)
      expect(scenario.gracefulStop).toBe(`${Math.ceil(2 * seconds[name])}s`)
    }
  })

  test('sizes the virtual users by the rate and the longest iteration', () => {
    expect(scenarios['live-animals'].preAllocatedVUs).toBe(
      Math.ceil((44 / 3600) * 2400)
    )
  })

  test('uses the run duration', () => {
    expect(scenarios['live-animals'].duration).toBe('2m')
  })

  test('takes the rate from a value override', () => {
    const overridden = arrivalScenarios(
      resolveTrafficModel({
        TRAFFIC_MODEL: '{"liveAnimals":{"notificationsPerHour":7}}'
      }),
      SCENARIOS
    )

    expect(overridden['live-animals'].rate).toBe(7)
  })

  test('pre-allocates at most 5 virtual users in total for the smoke profile', () => {
    const smoke = arrivalScenarios(
      resolveTrafficModel({}, SMOKE_PROFILE),
      SCENARIOS
    )
    const total = Object.values(smoke).reduce(
      (sum, { preAllocatedVUs }) => sum + preAllocatedVUs,
      0
    )

    expect(total).toBeLessThanOrEqual(MAX_SMOKE_VUS)
  })
})
