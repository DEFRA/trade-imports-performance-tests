import { describe, expect, test } from 'vitest'

import {
  addressCountFrom,
  DATASTORES,
  backgroundAddressName,
  createdLine,
  shortfallMessage,
  toCreate,
  volumeLine
} from './background-volume.js'

const TARGETS = {
  'live-animals': 42000,
  'high-risk-plants': 34000,
  'address-book': 500
}

const VOLUME = {
  'live-animals': 12,
  'high-risk-plants': 9,
  'dashboard-read-model': 12,
  'address-book': 3
}

describe('volumeLine', () => {
  test('names the datastores in DATASTORES order', () => {
    const line = volumeLine('start', VOLUME, {})
    const positions = DATASTORES.map((datastore) => line.indexOf(datastore))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })
})

describe('toCreate', () => {
  test('creates the difference when under target', () => {
    expect(toCreate(100, 40, 1000)).toBe(60)
  })

  test.each([
    [100, 100],
    [100, 250]
  ])(
    'creates nothing for a target of %s with %s present',
    (target, existing) => {
      expect(toCreate(target, existing, 1000)).toBe(0)
    }
  )

  test('is limited by the cap', () => {
    expect(toCreate(42000, 0, 5000)).toBe(5000)
  })
})

describe('addressCountFrom', () => {
  const listPage = (labelText) => ({ heading: 'Address book', labelText })

  test('reads the total from a results label', () => {
    expect(addressCountFrom(listPage('Showing 1-25 of 530'))).toBe(530)
    expect(addressCountFrom(listPage('Showing 1-20 of 57'))).toBe(57)
  })

  test('reads the total from a label with surrounding whitespace', () => {
    expect(addressCountFrom(listPage('\n  Showing 26-30 of 30\n'))).toBe(30)
  })

  test.each(['', '   \n '])(
    'is 0 for the blank label %j on the address-book list',
    (text) => {
      expect(addressCountFrom(listPage(text))).toBe(0)
    }
  )

  test('is undefined for any other text on the address-book list', () => {
    expect(addressCountFrom(listPage('Address book'))).toBeUndefined()
  })

  test.each(['Sign in', 'Sorry, there is a problem', undefined])(
    'is undefined for a blank label on the page headed %j',
    (heading) => {
      expect(addressCountFrom({ heading, labelText: '' })).toBeUndefined()
    }
  )
})

describe('backgroundAddressName', () => {
  test('numbers from 1', () => {
    expect(backgroundAddressName(0)).toBe('Background Address 1')
    expect(backgroundAddressName(499)).toBe('Background Address 500')
  })

  test('never matches the performance-test address or the address-book sessions', () => {
    const name = backgroundAddressName(7)

    expect(name).not.toContain('Perf Test Holding')
    expect(name).not.toContain('Address Book Load')
  })
})

describe('volumeLine', () => {
  test('prints the target for targeted datastores and the bare count for the read model', () => {
    expect(volumeLine('start', VOLUME, TARGETS)).toBe(
      'Background volume at start: live-animals 12 of 42000, high-risk-plants 9 of 34000, dashboard-read-model 12, address-book 3 of 500'
    )
  })

  test('states the moment', () => {
    expect(volumeLine('end', VOLUME, TARGETS)).toContain(
      'Background volume at end:'
    )
  })
})

describe('createdLine', () => {
  test('differences the journey backends and the address book only', () => {
    const after = {
      'live-animals': 14,
      'high-risk-plants': 11,
      'dashboard-read-model': 99,
      'address-book': 5
    }

    expect(createdLine(VOLUME, after)).toBe(
      'Created this run: live-animals 2, high-risk-plants 2, address-book 2'
    )
  })
})

describe('shortfallMessage', () => {
  test('is undefined when every target is met', () => {
    expect(
      shortfallMessage(
        {
          'live-animals': 42000,
          'high-risk-plants': 40000,
          'dashboard-read-model': 0,
          'address-book': 500
        },
        TARGETS
      )
    ).toBeUndefined()
  })

  test('names every short datastore with its count and target', () => {
    expect(shortfallMessage(VOLUME, TARGETS)).toBe(
      'Background volume is below target: live-animals 12 of 42000, high-risk-plants 9 of 34000, address-book 3 of 500'
    )
  })

  test('leaves out a datastore that is at target', () => {
    expect(
      shortfallMessage({ ...VOLUME, 'live-animals': 42000 }, TARGETS)
    ).not.toContain('live-animals')
  })
})
