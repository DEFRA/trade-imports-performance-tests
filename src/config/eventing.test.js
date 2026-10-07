import { describe, expect, test } from 'vitest'

import { publishesEvents } from './eventing.js'
import { JOURNEYS } from './smoke.js'

describe('publishesEvents', () => {
  test('live animals publishes events', () => {
    expect(publishesEvents(JOURNEYS['live-animals'])).toBe(true)
  })

  test('high-risk plants publishes none today', () => {
    expect(publishesEvents(JOURNEYS['high-risk-plants'])).toBe(false)
  })
})
