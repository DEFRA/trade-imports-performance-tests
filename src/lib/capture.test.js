import { describe, expect, test } from 'vitest'

import { replaceBodyFrom } from './capture.js'

const view = {
  referenceNumber: 'DRAFT.GB.2026.1',
  concurrencyToken: 7,
  status: 'DRAFT',
  fulfilments: { origin: { country: 'FR' } }
}

describe('replaceBodyFrom', () => {
  test('copies the reference, token and fulfilments from the view', () => {
    expect(replaceBodyFrom(view).notification).toEqual({
      referenceNumber: 'DRAFT.GB.2026.1',
      concurrencyToken: 7,
      fulfilments: { origin: { country: 'FR' } }
    })
  })

  test('copies the shape fields from the list item', () => {
    const body = replaceBodyFrom(view, { origin: { countryCode: 'FR' } })

    expect(body.notification.origin).toEqual({ countryCode: 'FR' })
  })

  test('drops server-owned fields and nulls from the list item', () => {
    const body = replaceBodyFrom(view, {
      id: 'x',
      referenceNumber: 'other',
      concurrencyToken: 99,
      status: 'DRAFT',
      created: '2026-01-01T00:00:00',
      updated: '2026-01-01T00:00:00',
      submittedAt: null,
      commodity: null,
      origin: { countryCode: 'FR' }
    })

    expect(Object.keys(body.notification).sort()).toEqual([
      'concurrencyToken',
      'fulfilments',
      'origin',
      'referenceNumber'
    ])
    expect(body.notification.referenceNumber).toBe('DRAFT.GB.2026.1')
    expect(body.notification.concurrencyToken).toBe(7)
  })

  test('adds no field that was not in an input', () => {
    const body = replaceBodyFrom(view, { origin: { countryCode: 'FR' } })
    const inputs = new Set([...Object.keys(view), 'origin'])

    for (const name of Object.keys(body.notification)) {
      expect(inputs).toContain(name)
    }
  })

  test('throws when the view has no fulfilments', () => {
    expect(() =>
      replaceBodyFrom({ referenceNumber: 'r', concurrencyToken: 1 })
    ).toThrow('no fulfilments')
  })

  test('accepts a concurrency token of 0', () => {
    const body = replaceBodyFrom({ ...view, concurrencyToken: 0 })

    expect(body.notification.concurrencyToken).toBe(0)
  })

  test('throws when the view has no concurrency token', () => {
    expect(() =>
      replaceBodyFrom({ referenceNumber: 'r', fulfilments: {} })
    ).toThrow('no concurrencyToken')
  })
})
