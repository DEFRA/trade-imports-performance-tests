import { describe, expect, test } from 'vitest'

import {
  ADDRESS_TYPE_START_PATH,
  ADDRESS_TYPES,
  addressBookListPath,
  addressIdFrom,
  worstCaseSearchTerm
} from './address-book.js'

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
    ],
    ['BRANCH', '/address-book?addressType=BRANCH']
  ])('gives the bare path of the %s tab', (addressType, path) => {
    expect(addressBookListPath(addressType)).toBe(path)
  })

  test('adds the encoded search term after the tab', () => {
    expect(
      addressBookListPath(ADDRESS_TYPES.BRANCH, { searchTerm: 'Perf & Co' })
    ).toBe('/address-book?addressType=BRANCH&q=Perf%20%26%20Co')
  })
})
