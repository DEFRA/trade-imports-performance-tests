import { describe, expect, test } from 'vitest'

import { ENDPOINT_KINDS, ENDPOINTS, kindOf } from './endpoints.js'

describe('ENDPOINTS', () => {
  test.each(Object.entries(ENDPOINTS))(
    '%s is a page or an api call',
    (_name, kind) => {
      expect(Object.values(ENDPOINT_KINDS)).toContain(kind)
    }
  )
})

describe('kindOf', () => {
  test('returns page for a frontend page', () => {
    expect(kindOf('ins-dashboard')).toBe('page')
  })

  test('returns page for an address-book form save', () => {
    expect(kindOf('ins-address-add-save')).toBe('page')
  })

  test('returns upload for the document upload and page for its status poll', () => {
    expect(kindOf('animals-documents-upload')).toBe('upload')
    expect(kindOf('animals-documents-status')).toBe('page')
  })

  test('returns api for a backend call', () => {
    expect(kindOf('animals-backend-replace')).toBe('api')
  })

  test('throws for a name outside the catalogue', () => {
    expect(() => kindOf('ins-dashbord')).toThrow(
      'Unknown endpoint "ins-dashbord"'
    )
  })
})
