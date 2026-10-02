import { describe, expect, test } from 'vitest'

import { GENERATOR } from '../config/generator.js'
import {
  generatorLines,
  generatorVerdict,
  idleShares,
  lowestWindowIdle,
  parseGeneratorSamples,
  vusMaxFrom
} from './generator.js'

const MEGABYTE = 1024 * 1024
const KILOBYTES_PER_MEGABYTE = 1024

const sampleLine = (atSeconds, busy, total, k6Cpu, rssMb) =>
  `${atSeconds} ${busy} ${total} ${k6Cpu} ${rssMb * KILOBYTES_PER_MEGABYTE}`

const parsedWith = (overrides = {}) => ({
  cores: 2,
  quotaCores: null,
  clockTicks: 100,
  memoryLimitBytes: null,
  samples: [],
  ...overrides
})

const runOf = ({ seconds, busyPerSecond, rssMb = 100, bad } = {}) => {
  const samples = []
  let busy = 0

  for (let at = 0; at <= seconds; at += 5) {
    const slowed = bad && at >= bad.from && at < bad.to

    busy += 5 * (slowed ? bad.busyPerSecond : busyPerSecond)

    samples.push({
      atSeconds: 1000 + at,
      busyTicks: busy,
      totalTicks: at * 100,
      k6CpuTicks: busy,
      k6RssKb: rssMb * KILOBYTES_PER_MEGABYTE
    })
  }

  return samples
}

describe('parseGeneratorSamples', () => {
  const parsed = parseGeneratorSamples(
    [
      '# cores 4',
      '# quota_cores 2',
      '# clock_ticks 100',
      '# memory_limit_bytes none',
      sampleLine(1000, 10, 100, 5, 100),
      '1005 20 200 - -',
      'garbage'
    ].join('\n')
  )

  test('reads the headers, none as null', () => {
    expect(parsed).toMatchObject({
      cores: 4,
      quotaCores: 2,
      clockTicks: 100,
      memoryLimitBytes: null
    })
  })

  test('reads the samples, a dash as null, and skips lines that do not parse', () => {
    expect(parsed.samples).toEqual([
      {
        atSeconds: 1000,
        busyTicks: 10,
        totalTicks: 100,
        k6CpuTicks: 5,
        k6RssKb: 100 * KILOBYTES_PER_MEGABYTE
      },
      {
        atSeconds: 1005,
        busyTicks: 20,
        totalTicks: 200,
        k6CpuTicks: null,
        k6RssKb: null
      }
    ])
  })
})

describe('idleShares', () => {
  test('is 1 minus k6 CPU over the quota capacity when there is a quota', () => {
    const parsed = parsedWith({
      quotaCores: 2,
      samples: [
        {
          atSeconds: 100,
          busyTicks: 0,
          totalTicks: 0,
          k6CpuTicks: 0,
          k6RssKb: 1
        },
        {
          atSeconds: 105,
          busyTicks: 0,
          totalTicks: 0,
          k6CpuTicks: 500,
          k6RssKb: 1
        }
      ]
    })

    expect(idleShares(parsed, 0)).toEqual([
      { atSeconds: 105, seconds: 5, idleShare: 0.5 }
    ])
  })

  test('is 1 minus the machine busy share with no quota', () => {
    const parsed = parsedWith({
      samples: [
        {
          atSeconds: 100,
          busyTicks: 0,
          totalTicks: 0,
          k6CpuTicks: null,
          k6RssKb: 1
        },
        {
          atSeconds: 105,
          busyTicks: 300,
          totalTicks: 1000,
          k6CpuTicks: null,
          k6RssKb: 1
        }
      ]
    })

    expect(idleShares(parsed, 0)[0].idleShare).toBeCloseTo(0.7)
  })

  test('drops intervals inside the first 60 seconds', () => {
    const parsed = parsedWith({
      samples: runOf({ seconds: 120, busyPerSecond: 50 })
    })
    const shares = idleShares(parsed)

    expect(shares[0].atSeconds).toBe(1000 + 65)
    expect(shares.at(-1).atSeconds).toBe(1000 + 120)
  })
})

describe('lowestWindowIdle', () => {
  const shares = (idleList) =>
    idleList.map((idleShare, index) => ({
      atSeconds: (index + 1) * 5,
      seconds: 5,
      idleShare
    }))

  test('is null with no intervals', () => {
    expect(lowestWindowIdle([], 60)).toBeNull()
  })

  test('finds the one bad minute in a run', () => {
    const list = [
      ...Array(24).fill(0.8),
      ...Array(12).fill(0.1),
      ...Array(24).fill(0.8)
    ]

    expect(lowestWindowIdle(shares(list), 60)).toBeCloseTo(0.1)
  })

  test('judges a run shorter than the window whole', () => {
    expect(lowestWindowIdle(shares([0.4, 0.6]), 60)).toBeCloseTo(0.5)
  })
})

describe('generatorVerdict', () => {
  const verdictFor = (parsed, vusMax = 40) =>
    generatorVerdict({ parsed, vusMax, allowances: GENERATOR })

  test('is trusted with idle CPU and memory inside the allowance', () => {
    const verdict = verdictFor(
      parsedWith({ samples: runOf({ seconds: 300, busyPerSecond: 40 }) })
    )

    expect(verdict).toMatchObject({ judged: true, trusted: true, reasons: [] })
  })

  test('is untrusted when idle CPU falls under 20% over a minute', () => {
    const verdict = verdictFor(
      parsedWith({
        samples: runOf({
          seconds: 300,
          busyPerSecond: 40,
          bad: { from: 150, to: 230, busyPerSecond: 95 }
        })
      })
    )

    expect(verdict.trusted).toBe(false)
    expect(verdict.reasons[0]).toMatch(
      /^idle CPU fell to \d+% over a minute, under the 20% the generator keeps$/
    )
  })

  test('is untrusted when memory passes the allowance', () => {
    const verdict = verdictFor(
      parsedWith({
        samples: runOf({ seconds: 300, busyPerSecond: 40, rssMb: 1000 })
      })
    )

    expect(verdict.reasons).toEqual([
      'memory peaked at 1000MB for 40 virtual users, over the allowance of 928MB (128MB + 20MB a virtual user)'
    ])
  })

  test('names both reasons when both rules break', () => {
    const verdict = verdictFor(
      parsedWith({
        samples: runOf({ seconds: 300, busyPerSecond: 95, rssMb: 1000 })
      })
    )

    expect(verdict.reasons).toHaveLength(2)
  })

  test('is not judged with no samples', () => {
    const verdict = verdictFor(parsedWith())

    expect(verdict.judged).toBe(false)
    expect(generatorLines(verdict)[1]).toMatch(/^Generator trust: not judged: /)
  })

  test('is not judged when no sample carries memory, however healthy the CPU', () => {
    const samples = runOf({ seconds: 300, busyPerSecond: 40 }).map(
      (sample) => ({ ...sample, k6RssKb: null })
    )
    const verdict = verdictFor(parsedWith({ samples }), 40)

    expect(verdict.judged).toBe(false)
    expect(verdict.trusted).toBe(false)
    expect(verdict.missing).toContain('no memory samples')
    expect(generatorLines(verdict)[1]).toBe(
      'Generator trust: not judged: no memory samples'
    )
  })

  test('is untrusted, not unjudged, when idle CPU is low and memory is missing', () => {
    const samples = runOf({ seconds: 300, busyPerSecond: 95 }).map(
      (sample) => ({ ...sample, k6RssKb: null })
    )
    const verdict = verdictFor(parsedWith({ samples }), 40)

    expect(verdict.judged).toBe(true)
    expect(verdict.trusted).toBe(false)
    expect(verdict.reasons).toHaveLength(1)
  })

  test('trusts idle CPU just above 20% and distrusts it just below', () => {
    const trustedAt = (busyPerSecond) =>
      verdictFor(
        parsedWith({ samples: runOf({ seconds: 300, busyPerSecond }) })
      ).trusted

    expect(trustedAt(79)).toBe(true)
    expect(trustedAt(81)).toBe(false)
  })

  test('trusts memory at 128MB + 20MB a virtual user and distrusts it a megabyte over', () => {
    const trustedAt = (rssMb) =>
      verdictFor(
        parsedWith({
          samples: runOf({ seconds: 300, busyPerSecond: 40, rssMb })
        })
      ).trusted

    expect(trustedAt(928)).toBe(true)
    expect(trustedAt(929)).toBe(false)
  })

  test('does not judge memory without the virtual-user count', () => {
    const verdict = verdictFor(
      parsedWith({
        samples: runOf({ seconds: 300, busyPerSecond: 40, rssMb: 1000 })
      }),
      null
    )

    expect(verdict.judged).toBe(false)
    expect(verdict.reasons).toEqual([])
    expect(verdict.missing).toContain('the virtual-user count (summary.json)')
  })
})

describe('vusMaxFrom', () => {
  test.each([
    [{ metrics: { vus_max: { max: 60 } } }, 60],
    [{ metrics: { vus_max: { value: 40 } } }, 40],
    [{ metrics: {} }, null],
    [undefined, null]
  ])('reads %j as %s', (summary, expected) => {
    expect(vusMaxFrom(summary)).toBe(expected)
  })
})

describe('generatorLines', () => {
  const trusted = {
    judged: true,
    trusted: true,
    reasons: [],
    missing: [],
    cpu: { cores: 2, quotaCores: 2, lowestWindowIdle: 0.41, meanIdle: 0.63 },
    memory: {
      peakRssBytes: 412 * MEGABYTE,
      vusMax: 40,
      allowanceBytes: 928 * MEGABYTE,
      perVuBytes: (412 * MEGABYTE) / 40,
      limitBytes: null
    }
  }

  test('states the CPU and memory, and a trusted verdict', () => {
    expect(generatorLines(trusted)).toEqual([
      'Generator: CPU idle at least 41% over any minute (mean 63%) on 2 cores (quota 2); memory peaked at 412MB for 40 virtual users, 10.3MB each, against an allowance of 928MB',
      'Generator trust: trusted: the load generator was not the bottleneck'
    ])
  })

  test('states an untrusted verdict with its reasons', () => {
    expect(
      generatorLines({
        ...trusted,
        trusted: false,
        reasons: [
          'idle CPU fell to 12% over a minute, under the 20% the generator keeps'
        ]
      })[1]
    ).toBe(
      'Generator trust: untrusted: idle CPU fell to 12% over a minute, under the 20% the generator keeps'
    )
  })

  test('states what is missing when not judged', () => {
    expect(
      generatorLines({
        ...trusted,
        judged: false,
        trusted: false,
        missing: ['no memory samples']
      })[1]
    ).toBe('Generator trust: not judged: no memory samples')
  })
})
