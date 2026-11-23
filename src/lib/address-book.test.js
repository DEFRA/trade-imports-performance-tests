import { describe, expect, test } from 'vitest'

import { ENDPOINTS } from '../config/endpoints.js'
import {
  ADDRESS_BOOK_SESSION_ENDPOINTS,
  ADDRESS_TYPE_START_PATH,
  ADDRESS_TYPES,
  DECLARED_ROLES_BY_ADDRESS_TYPE,
  addAddressAnswers,
  addressBookListPath,
  addressIdFrom,
  worstCaseSearchTerm
} from './address-book.js'

describe('ADDRESS_BOOK_SESSION_ENDPOINTS', () => {
  test.each(Object.entries(ADDRESS_BOOK_SESSION_ENDPOINTS))(
    'the %s request names %s, an endpoint in the catalogue',
    (_request, endpoint) => {
      expect(Object.keys(ENDPOINTS)).toContain(endpoint)
    }
  )
})

describe('addAddressAnswers', () => {
  test('gives the address fields under the name, ticking every role declared for the Origin or Consignor type', () => {
    expect(
      addAddressAnswers(
        { name: 'Old name', postcode: 'SW1A 1AA' },
        'New name',
        ADDRESS_TYPES.ORIGIN_OR_CONSIGNOR
      )
    ).toEqual({
      name: 'New name',
      postcode: 'SW1A 1AA',
      roles: ['PLACE_OF_ORIGIN', 'CONSIGNOR']
    })
  })

  test('gives the address fields under the name, ticking every role declared for the Destination, Consignee or Importer type', () => {
    expect(
      addAddressAnswers(
        { name: 'Old name', postcode: 'SW1A 1AA' },
        'New name',
        ADDRESS_TYPES.DESTINATION_CONSIGNEE_OR_IMPORTER
      )
    ).toEqual({
      name: 'New name',
      postcode: 'SW1A 1AA',
      roles: ['CONSIGNEE', 'IMPORTER', 'PLACE_OF_DESTINATION']
    })
  })
})

describe('DECLARED_ROLES_BY_ADDRESS_TYPE', () => {
  test.each(Object.keys(DECLARED_ROLES_BY_ADDRESS_TYPE))(
    'declares roles for %s, one of ADDRESS_TYPES',
    (addressType) => {
      expect(Object.values(ADDRESS_TYPES)).toContain(addressType)
    }
  )

  test.each(Object.values(ADDRESS_TYPES))(
    'declares the roles %s carries, so a setup adding under every declared type reaches it',
    (addressType) => {
      expect(
        DECLARED_ROLES_BY_ADDRESS_TYPE[addressType]?.length ?? 0
      ).toBeGreaterThan(0)
    }
  )
})

describe('worstCaseSearchTerm', () => {
  test('is exactly the length asked and starts with the fixed words', () => {
    const term = worstCaseSearchTerm(255)

    expect(term).toHaveLength(255)
    expect(term.startsWith('Worst case search ')).toBe(true)
  })

  test('matches no address name the suite adds', () => {
    const term = worstCaseSearchTerm(255)

    expect(term).not.toContain('Perf Test Holding')
    expect(term).not.toContain('Address Book Load')
  })
})

describe('addressIdFrom', () => {
  test('reads the id of the first address link, passing the start link by', () => {
    expect(
      addressIdFrom([
        ADDRESS_TYPE_START_PATH,
        '/address-book/abc-1',
        '/address-book/xyz'
      ])
    ).toBe('abc-1')
  })

  test.each([
    [[]],
    [[ADDRESS_TYPE_START_PATH]],
    [['/address-book/abc-1/edit', '/address-book?page=2', '/']]
  ])('returns an empty string when no address is listed: %j', (hrefs) => {
    expect(addressIdFrom(hrefs)).toBe('')
  })
})

describe('addressBookListPath', () => {
  test.each([
    ['ORIGIN_OR_CONSIGNOR', '/address-book?addressType=ORIGIN_OR_CONSIGNOR'],
    [
      'DESTINATION_CONSIGNEE_OR_IMPORTER',
      '/address-book?addressType=DESTINATION_CONSIGNEE_OR_IMPORTER'
    ]
  ])('gives the bare path of the %s tab', (addressType, path) => {
    expect(addressBookListPath(addressType)).toBe(path)
  })

  test('adds the encoded search term after the tab', () => {
    expect(
      addressBookListPath(ADDRESS_TYPES.ORIGIN_OR_CONSIGNOR, {
        searchTerm: 'Perf & Co'
      })
    ).toBe('/address-book?addressType=ORIGIN_OR_CONSIGNOR&q=Perf%20%26%20Co')
  })

  test('adds the role between the tab and the encoded search term', () => {
    expect(
      addressBookListPath(ADDRESS_TYPES.ORIGIN_OR_CONSIGNOR, {
        role: 'CONSIGNOR',
        searchTerm: 'Perf & Co'
      })
    ).toBe(
      '/address-book?addressType=ORIGIN_OR_CONSIGNOR&role=CONSIGNOR&q=Perf%20%26%20Co'
    )
  })

  test('adds the role after the bare tab when no search term is given', () => {
    expect(
      addressBookListPath(ADDRESS_TYPES.ORIGIN_OR_CONSIGNOR, {
        role: 'CONSIGNOR'
      })
    ).toBe('/address-book?addressType=ORIGIN_OR_CONSIGNOR&role=CONSIGNOR')
  })
})
