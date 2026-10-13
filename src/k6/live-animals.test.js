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

describe('LIVE_ANIMALS_STEPS', () => {
  const names = LIVE_ANIMALS_STEPS.draft.map((step) => step.name)

  test('walks the main reason for import between the commodity page and Commodity details, as Design Release 2.1 orders them', () => {
    expect(names.slice(0, 6)).toEqual([
      'origin',
      'commodities',
      'import-reason',
      'consignment-details',
      'identification',
      'additional-details'
    ])
  })

  test('names every draft step once', () => {
    expect(new Set(names).size).toBe(names.length)
  })
})
