import { describe, expect, test } from 'vitest'

import {
  documentBytes,
  documentFilename,
  documentSizeBytes,
  scanHasSettled,
  scanWasRejected
} from './documents.js'

const textOf = (bytes) => String.fromCharCode(...bytes)

describe('documentBytes', () => {
  test('builds a PDF of the size asked, starting and ending like one', () => {
    const bytes = documentBytes('pdf', 100_000)

    expect(bytes).toHaveLength(100_000)
    expect(textOf(bytes.slice(0, 5))).toBe('%PDF-')
    expect(textOf(bytes.slice(-6))).toBe('%%EOF\n')
  })

  test('builds a JPEG that starts and ends like one', () => {
    const bytes = documentBytes('jpeg', 5000)

    expect([...bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff])
    expect([...bytes.slice(-2)]).toEqual([0xff, 0xd9])
    expect(bytes).toHaveLength(5000)
  })

  test('raises a size smaller than the header and trailer to hold both', () => {
    expect(documentBytes('jpeg', 1)).toHaveLength(22)
    expect(documentBytes('pdf', 0).length).toBeGreaterThan(0)
  })
})

describe('documentSizeBytes', () => {
  test('starts at the minimum', () => {
    expect(documentSizeBytes({ min: 100, max: 5000 }, 0)).toBe(100_000)
  })

  test('stays under the maximum', () => {
    expect(documentSizeBytes({ min: 100, max: 5000 }, 0.9999999)).toBeLessThan(
      5_000_000
    )
  })
})

describe('documentFilename', () => {
  test.each([
    ['pdf', 'REF-1.pdf'],
    ['jpeg', 'REF-1.jpg']
  ])('names a %s file %s', (kind, expected) => {
    expect(documentFilename(kind, 'REF-1')).toBe(expected)
  })
})

describe('scanHasSettled', () => {
  test('is false while any scan is pending', () => {
    expect(
      scanHasSettled([{ scanStatus: 'COMPLETE' }, { scanStatus: 'PENDING' }])
    ).toBe(false)
  })

  test('is true once every scan is complete or rejected', () => {
    expect(
      scanHasSettled([{ scanStatus: 'COMPLETE' }, { scanStatus: 'REJECTED' }])
    ).toBe(true)
  })

  test('is false for something that is not a list', () => {
    expect(scanHasSettled(undefined)).toBe(false)
  })
})

describe('scanWasRejected', () => {
  test('is true when any document was rejected', () => {
    expect(
      scanWasRejected([{ scanStatus: 'COMPLETE' }, { scanStatus: 'REJECTED' }])
    ).toBe(true)
  })

  test('is false when none was, or for no list', () => {
    expect(scanWasRejected([{ scanStatus: 'COMPLETE' }])).toBe(false)
    expect(scanWasRejected(undefined)).toBe(false)
  })
})
