import { describe, expect, test } from 'vitest'

import { ENDPOINTS } from './endpoints.js'
import {
  SCENARIOS,
  notificationSplits,
  resolvePassword,
  smokeScenarios
} from './smoke.js'
import {
  SMOKE_PROFILE,
  TRAFFIC_DEFAULTS,
  resolveTrafficModel
} from './traffic.js'

describe('notificationSplits', () => {
  test('is live animals plus each high-risk plants commodity type', () => {
    expect(notificationSplits(TRAFFIC_DEFAULTS)).toEqual([
      ['live-animals', 'live-animals'],
      ['high-risk-plants', 'plants-for-planting'],
      ['high-risk-plants', 'potatoes'],
      ['high-risk-plants', 'wood-and-cut-trees']
    ])
  })
})

const JOURNEY_SCENARIOS = [
  ['live-animals', 'animals'],
  ['high-risk-plants', 'plants']
]
const SHARED_ROLES = [
  'dashboard',
  'dashboard-search',
  'create',
  'hub',
  'notification-view',
  'declaration',
  'declaration-save',
  'amend',
  'cancel-amend',
  'cancel-amend-save'
]
const ADDRESS_BOOK_ENDPOINTS = [
  'ins-address-book',
  'ins-address-book-search',
  'ins-address-add',
  'ins-address-add-save',
  'ins-address-view',
  'ins-address-edit',
  'ins-address-edit-save',
  'ins-address-delete',
  'ins-address-delete-save'
]

describe('SCENARIOS', () => {
  test('has the front door, the address book and both journeys', () => {
    expect(Object.keys(SCENARIOS)).toEqual([
      'ins-front-door',
      'ins-address-book',
      'live-animals',
      'high-risk-plants'
    ])
  })

  test('only lists endpoints that are in the catalogue', () => {
    for (const { endpoints } of Object.values(SCENARIOS)) {
      for (const endpoint of endpoints) {
        expect(Object.keys(ENDPOINTS)).toContain(endpoint)
      }
    }
  })

  test.each(JOURNEY_SCENARIOS)(
    '%s follows the whole journey: dashboard, create, hub, review, declaration, amend and cancel amend',
    (scenario, prefix) => {
      const { endpoints } = SCENARIOS[scenario]

      expect(endpoints).toEqual(
        expect.arrayContaining([
          'sign-in',
          'ins-dashboard',
          ...SHARED_ROLES.map((role) => `${prefix}-${role}`)
        ])
      )
    }
  )

  test("includes a sample of each journey's draft page endpoints", () => {
    expect(SCENARIOS['live-animals'].endpoints).toEqual(
      expect.arrayContaining([
        'animals-origin',
        'animals-commodities',
        'animals-identification',
        'animals-party-picker-save',
        'animals-port-of-entry-save',
        'animals-contact-save'
      ])
    )
    expect(SCENARIOS['high-risk-plants'].endpoints).toEqual(
      expect.arrayContaining([
        'plants-commodity-type',
        'plants-commodity-line-save',
        'plants-arrival-details',
        'plants-destination-save',
        'plants-identification-numbers-save',
        'plants-contact-save'
      ])
    )
  })

  test('has the address book list, add, view, edit and delete pages', () => {
    expect(SCENARIOS['ins-address-book'].endpoints).toEqual(
      expect.arrayContaining(ADDRESS_BOOK_ENDPOINTS)
    )
  })
})

describe('smokeScenarios', () => {
  test('gives every scenario an arrival-rate executor and its exec function', () => {
    const scenarios = smokeScenarios(resolveTrafficModel({}, SMOKE_PROFILE))

    expect(Object.keys(scenarios)).toEqual(Object.keys(SCENARIOS))

    for (const [name, scenario] of Object.entries(scenarios)) {
      expect(scenario).toMatchObject({
        executor: 'constant-arrival-rate',
        duration: '2m',
        exec: SCENARIOS[name].exec
      })
    }
  })
})

describe('resolvePassword', () => {
  test('uses AUTH_PASSWORD when set', () => {
    expect(resolvePassword({ AUTH_PASSWORD: ' secret ' })).toBe('secret')
  })

  test.each([{}, { AUTH_PASSWORD: '' }, { AUTH_PASSWORD: '  ' }])(
    'falls back to the stub default: %o',
    (env) => {
      expect(resolvePassword(env)).toBe('Password123')
    }
  )
})
