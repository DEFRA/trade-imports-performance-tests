import { describe, expect, test } from 'vitest'

import {
  blankFieldAnswers,
  firstOption,
  hasField,
  selectOptions,
  slashDateText
} from './form-fill.js'

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

describe('blankFieldAnswers with an option chooser', () => {
  test('answers an empty select with the option the chooser picks', () => {
    expect(
      blankFieldAnswers(
        [{ name: 'genus', type: 'select', value: '', options: ['', 'A', 'B'] }],
        IDENTITY,
        (options) => options.at(-1)
      )
    ).toEqual({ genus: 'B' })
  })
})

describe('selectOptions', () => {
  const inputs = [
    text('free'),
    { name: 'port', type: 'select', value: '', options: ['GB ABD', 'GB LHR'] }
  ]

  test('reads the options of the named select', () => {
    expect(selectOptions(inputs, 'port')).toEqual(['GB ABD', 'GB LHR'])
  })

  test('returns an empty list for a field that is not a select or is missing', () => {
    expect(selectOptions(inputs, 'free')).toEqual([])
    expect(selectOptions(inputs, 'nothing')).toEqual([])
  })
})

describe('hasField', () => {
  test('tells whether the form has the input', () => {
    expect(hasField([text('arrivalTime')], 'arrivalTime')).toBe(true)
    expect(hasField([text('arrivalTime')], 'arrivalDate')).toBe(false)
  })
})

describe('slashDateText', () => {
  test('writes a past date for a negative offset', () => {
    expect(slashDateText(new Date('2026-03-04T10:00:00Z'), -30)).toBe(
      '2/2/2026'
    )
  })

  test('writes d/m/yyyy with no zero padding', () => {
    expect(slashDateText(new Date('2026-03-04T10:00:00Z'), 1)).toBe('5/3/2026')
  })

  test('crosses a month end', () => {
    expect(slashDateText(new Date('2026-01-30T10:00:00Z'), 7)).toBe('6/2/2026')
  })

  test('crosses a year end', () => {
    expect(slashDateText(new Date('2026-12-28T10:00:00Z'), 7)).toBe('4/1/2027')
  })
})
