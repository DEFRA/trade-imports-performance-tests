import { describe, expect, test } from 'vitest'

import { addressIdFrom, worstCaseSearchTerm } from './address-book.js'

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
  test('reads the id of the first address link', () => {
    expect(
      addressIdFrom([
        '/address-book/add',
        '/address-book/abc-1',
        '/address-book/xyz'
      ])
    ).toBe('abc-1')
  })

  test.each([
    [[]],
    [['/address-book/add']],
    [['/address-book/abc-1/edit', '/address-book?page=2', '/']]
  ])('returns an empty string when no address is listed: %j', (hrefs) => {
    expect(addressIdFrom(hrefs)).toBe('')
  })
})
