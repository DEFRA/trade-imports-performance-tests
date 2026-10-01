import { describe, expect, test } from 'vitest'

import { encodeForm, formFields, prefilledFields } from './forms.js'

describe('prefilledFields', () => {
  test('sends filled text fields and selected options, and leaves empty ones out', () => {
    expect(
      prefilledFields([
        { name: 'supplier', type: 'text', value: 'ABC' },
        { name: 'crop', type: 'text', value: '' },
        { name: 'genus', type: 'select', value: 'Picea' }
      ])
    ).toEqual({ supplier: 'ABC', genus: 'Picea' })
  })

  test('sends a radio only when it is ticked', () => {
    expect(
      prefilledFields([
        { name: 'status', type: 'radio', value: 'a', checked: false },
        { name: 'status', type: 'radio', value: 'b', checked: true }
      ])
    ).toEqual({ status: 'b' })
  })

  test('repeats a name for several ticked checkboxes', () => {
    expect(
      prefilledFields([
        { name: 'species', type: 'checkbox', value: 'a', checked: true },
        { name: 'species', type: 'checkbox', value: 'b', checked: true }
      ])
    ).toEqual({ species: ['a', 'b'] })
  })
})

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

  test('leaves out an answer that is undefined', () => {
    expect(formFields({ crumb: 'c' }, { choice: undefined, a: 'b' })).toEqual({
      crumb: 'c',
      a: 'b'
    })
  })

  test('keeps hidden fields the answers do not mention', () => {
    expect(formFields({ crumb: 'c' }, { answer: 'a' })).toEqual({
      crumb: 'c',
      answer: 'a'
    })
  })
})
