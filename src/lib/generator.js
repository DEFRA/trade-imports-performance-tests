import { GENERATOR } from '../config/generator.js'

const BYTES_PER_KILOBYTE = 1024
const BYTES_PER_MEGABYTE = 1024 * 1024
const PERCENT = 100
const MEGABYTE_DECIMALS = 1
const DEFAULT_CLOCK_TICKS = 100

const HEADER_PATTERN = /^#\s+(\S+)\s+(\S+)\s*$/

const numberOrNull = (text) => {
  if (text === undefined || text === 'none' || text === '-') {
    return null
  }

  const value = Number(text)

  return Number.isFinite(value) ? value : null
}

const sampleFrom = (line) => {
  const fields = line.trim().split(/\s+/)

  if (fields.length !== 5) {
    return undefined
  }

  const [atSeconds, busyTicks, totalTicks, k6CpuTicks, k6RssKb] =
    fields.map(numberOrNull)

  return atSeconds === null
    ? undefined
    : { atSeconds, busyTicks, totalTicks, k6CpuTicks, k6RssKb }
}

/**
 * Reads the sampler's file: header lines of the form `# name value`, then one
 * sample a line: `epochSeconds busyTicks totalTicks k6CpuTicks k6RssKb`.
 *
 * @param {string} text - The file's contents.
 * @returns {{ cores: number | null, quotaCores: number | null, clockTicks: number, memoryLimitBytes: number | null, samples: Array<{ atSeconds: number, busyTicks: number | null, totalTicks: number | null, k6CpuTicks: number | null, k6RssKb: number | null }> }} The parsed run. `none` and `-` read as null, and a line that does not parse is skipped.
 */
export const parseGeneratorSamples = (text) => {
  const headers = {}
  const samples = []

  for (const line of text.split('\n')) {
    const header = HEADER_PATTERN.exec(line)

    if (header) {
      headers[header[1]] = numberOrNull(header[2])
      continue
    }

    const sample = line.startsWith('#') ? undefined : sampleFrom(line)

    if (sample) {
      samples.push(sample)
    }
  }

  return {
    cores: headers.cores ?? null,
    quotaCores: headers.quota_cores ?? null,
    clockTicks: headers.clock_ticks ?? DEFAULT_CLOCK_TICKS,
    memoryLimitBytes: headers.memory_limit_bytes ?? null,
    samples
  }
}

const clamped = (share) => Math.min(1, Math.max(0, share))

const idleShareOf = ({ previous, current, quotaCores, clockTicks }) => {
  const seconds = current.atSeconds - previous.atSeconds

  if (seconds <= 0) {
    return undefined
  }

  if (quotaCores !== null) {
    if (current.k6CpuTicks === null || previous.k6CpuTicks === null) {
      return undefined
    }

    return clamped(
      1 -
        (current.k6CpuTicks - previous.k6CpuTicks) /
          (clockTicks * seconds * quotaCores)
    )
  }

  const fields = [
    current.busyTicks,
    previous.busyTicks,
    current.totalTicks,
    previous.totalTicks
  ]
  const total = current.totalTicks - previous.totalTicks

  if (fields.includes(null) || total <= 0) {
    return undefined
  }

  return clamped(1 - (current.busyTicks - previous.busyTicks) / total)
}

/**
 * Works out how idle the generator was in each sampled interval, after the
 * settle period.
 *
 * With a CPU quota the share is 1 minus k6's CPU over the quota's capacity.
 * Without one it is 1 minus the machine's busy share from `/proc/stat`.
 *
 * @param {{ quotaCores: number | null, clockTicks: number, samples: Array<object> }} parsed - The parsed samples.
 * @param {number} [settleSeconds] - Seconds from the first sample to ignore. Defaults to the generator's allowance.
 * @returns {Array<{ atSeconds: number, seconds: number, idleShare: number }>} One per interval with the figures it needs.
 */
export const idleShares = (parsed, settleSeconds = GENERATOR.settleSeconds) => {
  const { samples, quotaCores, clockTicks } = parsed

  if (samples.length === 0) {
    return []
  }

  const settledAt = samples[0].atSeconds + settleSeconds

  return samples.slice(1).flatMap((current, index) => {
    const previous = samples[index]
    const idleShare = idleShareOf({ previous, current, quotaCores, clockTicks })

    return previous.atSeconds >= settledAt && idleShare !== undefined
      ? [
          {
            atSeconds: current.atSeconds,
            seconds: current.atSeconds - previous.atSeconds,
            idleShare
          }
        ]
      : []
  })
}

const weightedMean = (shares) => {
  const seconds = shares.reduce((sum, share) => sum + share.seconds, 0)

  return (
    shares.reduce((sum, share) => sum + share.idleShare * share.seconds, 0) /
    seconds
  )
}

/**
 * Finds the lowest time-weighted mean idle share over any window.
 *
 * @param {Array<{ atSeconds: number, seconds: number, idleShare: number }>} shares - The intervals, in time order.
 * @param {number} windowSeconds - The window's length. A run shorter than this is judged whole.
 * @returns {number | null} The lowest mean, or null with no intervals.
 */
export const lowestWindowIdle = (shares, windowSeconds) => {
  if (shares.length === 0) {
    return null
  }

  const total = shares.reduce((sum, share) => sum + share.seconds, 0)

  if (total <= windowSeconds) {
    return weightedMean(shares)
  }

  let lowest = Number.POSITIVE_INFINITY

  for (let start = 0; start < shares.length; start += 1) {
    const window = []
    let covered = 0

    for (let index = start; index < shares.length; index += 1) {
      window.push(shares[index])
      covered += shares[index].seconds

      if (covered >= windowSeconds) {
        break
      }
    }

    if (covered >= windowSeconds) {
      lowest = Math.min(lowest, weightedMean(window))
    }
  }

  return lowest
}

const megabytesText = (bytes) =>
  `${Number((bytes / BYTES_PER_MEGABYTE).toFixed(MEGABYTE_DECIMALS))}MB`

const percentText = (share) => `${Math.round(share * PERCENT)}%`

const peakRssBytesOf = (samples) => {
  const values = samples.map(({ k6RssKb }) => k6RssKb).filter((v) => v !== null)

  return values.length === 0 ? null : Math.max(...values) * BYTES_PER_KILOBYTE
}

const cpuReasonFor = ({ lowest, allowances }) =>
  lowest < allowances.minIdleShare
    ? [
        `idle CPU fell to ${percentText(lowest)} over a minute, under the ${percentText(allowances.minIdleShare)} the generator keeps`
      ]
    : []

const memoryReasonFor = ({ memory, allowances }) =>
  memory.peakRssBytes !== null &&
  memory.allowanceBytes !== null &&
  memory.peakRssBytes > memory.allowanceBytes
    ? [
        `memory peaked at ${megabytesText(memory.peakRssBytes)} for ${memory.vusMax} virtual users, over the allowance of ${megabytesText(memory.allowanceBytes)} (${megabytesText(allowances.memoryBaseBytes)} + ${megabytesText(allowances.memoryPerVuBytes)} a virtual user)`
      ]
    : []

const missingFor = ({ lowest, memory }) => [
  ...(lowest === null ? ['no CPU samples after the settle period'] : []),
  ...(memory.vusMax === null ? ['the virtual-user count (summary.json)'] : []),
  ...(memory.peakRssBytes === null ? ['no memory samples'] : [])
]

/**
 * Judges whether the load generator was the bottleneck.
 *
 * Untrusted when idle CPU fell under the minimum over any minute, or when k6's
 * peak memory passed a base plus an allowance for each virtual user. Not
 * judged, naming what is missing, when any input (CPU samples, the
 * virtual-user count or memory samples) is missing and no reason has already
 * marked the run untrusted.
 *
 * @param {object} options - The run.
 * @param {ReturnType<typeof parseGeneratorSamples>} options.parsed - The sampler's file, parsed.
 * @param {number | null} options.vusMax - The most virtual users the run used, or null when unknown.
 * @param {typeof import('../config/generator.js').GENERATOR} options.allowances - The generator's allowances.
 * @returns {{ judged: boolean, trusted: boolean, reasons: string[], cpu: object, memory: object }} The verdict.
 */
export const generatorVerdict = ({ parsed, vusMax, allowances }) => {
  const shares = idleShares(parsed, allowances.settleSeconds)
  const lowest = lowestWindowIdle(shares, allowances.windowSeconds)
  const peakRssBytes = peakRssBytesOf(parsed.samples)
  const allowanceBytes =
    vusMax === null
      ? null
      : allowances.memoryBaseBytes + vusMax * allowances.memoryPerVuBytes
  const memory = {
    peakRssBytes,
    vusMax,
    allowanceBytes,
    perVuBytes:
      peakRssBytes === null || vusMax === null || vusMax === 0
        ? null
        : peakRssBytes / vusMax,
    limitBytes: parsed.memoryLimitBytes
  }
  const cpu = {
    cores: parsed.cores,
    quotaCores: parsed.quotaCores,
    lowestWindowIdle: lowest,
    meanIdle: shares.length === 0 ? null : weightedMean(shares)
  }
  const reasons = [
    ...(lowest === null ? [] : cpuReasonFor({ lowest, allowances })),
    ...memoryReasonFor({ memory, allowances })
  ]
  const missing = missingFor({ lowest, memory })
  const judged = reasons.length > 0 || missing.length === 0

  return {
    judged,
    trusted: judged && reasons.length === 0,
    reasons,
    missing,
    cpu,
    memory
  }
}

/**
 * Reads the most virtual users a run used from k6's `--summary-export`.
 *
 * @param {{ metrics?: { vus_max?: { max?: number, value?: number } } } | undefined} summaryExport - The parsed summary file.
 * @returns {number | null} The count, or null when the file or the metric is missing.
 */
export const vusMaxFrom = (summaryExport) =>
  summaryExport?.metrics?.vus_max?.max ??
  summaryExport?.metrics?.vus_max?.value ??
  null

const cpuLine = ({ cpu, memory }) => {
  const quota = cpu.quotaCores === null ? '' : ` (quota ${cpu.quotaCores})`
  const cores = cpu.cores === null ? 'unknown cores' : `${cpu.cores} cores`
  const idle =
    cpu.lowestWindowIdle === null
      ? 'CPU idle not measured'
      : `CPU idle at least ${percentText(cpu.lowestWindowIdle)} over any minute (mean ${percentText(cpu.meanIdle)})`
  const perUser =
    memory.perVuBytes === null
      ? ''
      : `, ${megabytesText(memory.perVuBytes)} each`
  const peak =
    memory.peakRssBytes === null
      ? 'memory not measured'
      : `memory peaked at ${megabytesText(memory.peakRssBytes)} for ${memory.vusMax ?? 'an unknown number of'} virtual users${perUser}`
  const allowance =
    memory.allowanceBytes === null
      ? ''
      : `, against an allowance of ${megabytesText(memory.allowanceBytes)}`

  return `Generator: ${idle} on ${cores}${quota}; ${peak}${allowance}`
}

const trustLineOf = (verdict) => {
  if (!verdict.judged) {
    return `Generator trust: not judged: ${verdict.missing.join('; ')}`
  }

  return verdict.trusted
    ? 'Generator trust: trusted: the load generator was not the bottleneck'
    : `Generator trust: untrusted: ${verdict.reasons.join('; ')}`
}

/**
 * Writes the two lines that state the generator's CPU and memory and whether it
 * was trusted.
 *
 * @param {ReturnType<typeof generatorVerdict>} verdict - The verdict.
 * @returns {string[]} Two lines.
 */
export const generatorLines = (verdict) => [
  cpuLine(verdict),
  trustLineOf(verdict)
]
