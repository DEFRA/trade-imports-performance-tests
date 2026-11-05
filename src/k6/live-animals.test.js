import { describe, expect, test, vi } from 'vitest'

vi.mock('k6', () => ({ check: vi.fn(), sleep: vi.fn() }))
vi.mock('k6/http', () => ({ default: {} }))
vi.mock('k6/metrics', () => ({
  Counter: class {
    add() {}
  },
  Trend: class {
    add() {}
  }
}))

const { LIVE_ANIMALS_STEPS } = await import('./live-animals.js')

describe('LIVE_ANIMALS_STEPS.draft', () => {
  test('visits the commodity page, the main import reason, Commodity details, identification and additional details in the order the journey offers them', () => {
    const JOURNEY_ORDER = [
      'commodities',
      'import-reason',
      'consignment-details',
      'identification',
      'additional-details'
    ]
    const stepNames = LIVE_ANIMALS_STEPS.draft.map((step) => step.name)

    expect(stepNames.filter((name) => JOURNEY_ORDER.includes(name))).toEqual(
      JOURNEY_ORDER
    )
  })
})

describe('LIVE_ANIMALS_STEPS.reEdit', () => {
  test('names consignment-details, so the re-edit padding reopens the page the walker would otherwise skip straight past', () => {
    expect(LIVE_ANIMALS_STEPS.reEdit).toContain('consignment-details')
  })
})
