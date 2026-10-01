import { describe, expect, test } from 'vitest'

import { arrivalDateText, blankFieldAnswers, firstOption } from './form-fill.js'

const IDENTITY = { vu: 3, iteration: 7 }

const text = (name, value = '', type = 'text') => ({ name, type, value })

describe('firstOption', () => {
  test('skips the empty placeholder', () => {
    expect(firstOption(['', 'FR', 'DE'])).toBe('FR')
  })

  test('returns an empty string when there is no real option', () => {
    expect(firstOption(['', ''])).toBe('')
  })
})

describe('blankFieldAnswers', () => {
  test('fills only empty text-like fields', () => {
    const answers = blankFieldAnswers(
      [
        text('free', ''),
        text('filled', 'already'),
        text('phone', '', 'tel'),
        { name: 'notes', type: 'textarea', value: '' },
        { name: 'choice', type: 'radio', value: 'x', checked: false },
        { name: 'agree', type: 'checkbox', value: 'yes', checked: false }
      ],
      IDENTITY
    )

    expect(Object.keys(answers)).toEqual(['free', 'phone', 'notes'])
  })

  test('leaves search fields alone', () => {
    expect(
      blankFieldAnswers(
        [
          text('q'),
          text('commoditySearch', '', 'search'),
          text('referenceNumber')
        ],
        IDENTITY
      )
    ).toEqual({})
  })

  test('fills an empty select with its first real option and leaves a chosen one', () => {
    expect(
      blankFieldAnswers(
        [
          { name: 'genus', type: 'select', value: '', options: ['A', 'B'] },
          { name: 'kept', type: 'select', value: 'B', options: ['A', 'B'] }
        ],
        IDENTITY
      )
    ).toEqual({ genus: 'A' })
  })

  test.each([
    ['numberOfAnimalsQuantity-0', '1'],
    ['numberOfPackages-0', '5'],
    ['earTag-0', 'UK123456789012'],
    ['quantity', '5'],
    ['commodityCode', '0602 20 20'],
    ['eppoCode', 'PIEAB'],
    ['species', 'Picea abies'],
    ['consignmentNumber', 'PERF37']
  ])('answers %s with %s', (name, expected) => {
    expect(blankFieldAnswers([text(name)], IDENTITY)).toEqual({
      [name]: expected
    })
  })
})

describe('arrivalDateText', () => {
  test('writes d/m/yyyy with no zero padding', () => {
    expect(arrivalDateText(new Date('2026-03-04T10:00:00Z'), 1)).toBe(
      '5/3/2026'
    )
  })

  test('crosses a month end', () => {
    expect(arrivalDateText(new Date('2026-01-30T10:00:00Z'), 7)).toBe(
      '6/2/2026'
    )
  })

  test('crosses a year end', () => {
    expect(arrivalDateText(new Date('2026-12-28T10:00:00Z'), 7)).toBe(
      '4/1/2027'
    )
  })
})
