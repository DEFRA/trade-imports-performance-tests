import { describe, expect, test } from 'vitest'

import {
  TRAFFIC_CLASSES,
  isDashboardRead,
  mixTargetLine
} from './request-mix.js'
import { resolveTrafficModel } from './traffic.js'

describe('TRAFFIC_CLASSES', () => {
  test('has the six classes of a page request', () => {
    expect(Object.values(TRAFFIC_CLASSES)).toEqual([
      'sign-in',
      'dashboard-read',
      'journey',
      'post-submission-read',
      'amendment',
      'address-book'
    ])
  })
})

describe('isDashboardRead', () => {
  test.each(Object.values(TRAFFIC_CLASSES))('%s', (trafficClass) => {
    expect(isDashboardRead(trafficClass)).toBe(
      trafficClass === 'dashboard-read'
    )
  })
})

describe('mixTargetLine', () => {
  test('names the target share and the volumetrics row it comes from', () => {
    expect(mixTargetLine(resolveTrafficModel({}))).toBe(
      'Request mix target: dashboard reads 25% of page requests (D7)'
    )
  })
})
