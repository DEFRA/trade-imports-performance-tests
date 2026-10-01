import { describe, expect, test } from 'vitest'

import { encodeForm, formFields } from './forms.js'

describe('encodeForm', () => {
  test('joins fields with ampersands', () => {
    expect(encodeForm({ a: '1', b: '2' })).toBe('a=1&b=2')
  })

  test('repeats the key for an array value', () => {
    expect(encodeForm({ colour: ['red', 'blue'] })).toBe(
      'colour=red&colour=blue'
    )
  })

  test('escapes spaces, ampersands and equals signs in names and values', () => {
    expect(encodeForm({ 'a b': 'x&y=z' })).toBe('a%20b=x%26y%3Dz')
  })
})

describe('formFields', () => {
  test('puts the answers over the hidden fields', () => {
    expect(
      formFields({ crumb: 'c', answer: 'old' }, { answer: 'new' })
    ).toEqual({ crumb: 'c', answer: 'new' })
  })

  test('keeps hidden fields the answers do not mention', () => {
    expect(formFields({ crumb: 'c' }, { answer: 'a' })).toEqual({
      crumb: 'c',
      answer: 'a'
    })
  })
})
