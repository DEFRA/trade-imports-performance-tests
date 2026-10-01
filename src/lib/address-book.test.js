import { describe, expect, test } from 'vitest'

import { addressIdFrom } from './address-book.js'

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
