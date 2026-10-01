import { describe, expect, test } from 'vitest'

import { ENDPOINTS } from './endpoints.js'
import {
  STEP_ENDPOINTS,
  journeyEndpoints,
  sharedEndpoints
} from './journey-endpoints.js'

const namesIn = (value) =>
  typeof value === 'string' ? [value] : Object.values(value).flatMap(namesIn)

describe('STEP_ENDPOINTS', () => {
  test.each(Object.keys(STEP_ENDPOINTS))(
    'every endpoint a step of %s sends to is in the catalogue',
    (journey) => {
      for (const endpoint of namesIn(STEP_ENDPOINTS[journey])) {
        expect(Object.keys(ENDPOINTS)).toContain(endpoint)
      }
    }
  )

  test('has a step for every page of each journey the user fills in', () => {
    expect(Object.keys(STEP_ENDPOINTS['live-animals'])).toEqual([
      'origin',
      'commodities',
      'consignment-details',
      'identification',
      'import-reason',
      'additional-details',
      'documents',
      'addresses',
      'cph-number',
      'port-of-entry',
      'transit-countries',
      'transporters',
      'contact'
    ])
    expect(Object.keys(STEP_ENDPOINTS['high-risk-plants'])).toEqual([
      'commodity-type',
      'commodity-line',
      'commodities',
      'origin',
      'arrival-status',
      'arrival-details',
      'destination',
      'consignor',
      'identification-numbers',
      'contact'
    ])
  })
})

describe('sharedEndpoints', () => {
  test.each(['animals', 'plants'])(
    'every %s name is in the catalogue',
    (prefix) => {
      for (const endpoint of namesIn(sharedEndpoints(prefix))) {
        expect(Object.keys(ENDPOINTS)).toContain(endpoint)
      }
    }
  )
})

describe('journeyEndpoints', () => {
  test.each([
    ['live-animals', 'animals'],
    ['high-risk-plants', 'plants']
  ])(
    'lists %s endpoints once each, all in the catalogue',
    (journey, prefix) => {
      const endpoints = journeyEndpoints(journey, prefix)

      expect(new Set(endpoints).size).toBe(endpoints.length)
      expect(endpoints).toContain(`${prefix}-backend-replace`)

      for (const endpoint of endpoints) {
        expect(Object.keys(ENDPOINTS)).toContain(endpoint)
      }
    }
  )
})
