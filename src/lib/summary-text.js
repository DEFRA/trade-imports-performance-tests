/**
 * Walks every threshold k6 evaluated into one result each.
 *
 * @param {Record<string, { thresholds?: Record<string, { ok: boolean }> }>} metrics - k6's summary metrics.
 * @returns {Array<{ metric: string, expression: string, ok: boolean }>} One result per threshold, in metric order.
 */
export const thresholdResults = (metrics) =>
  Object.entries(metrics).flatMap(([metric, { thresholds }]) =>
    Object.entries(thresholds ?? {}).map(([expression, { ok }]) => ({
      metric,
      expression,
      ok
    }))
  )

/**
 * Lists every threshold k6 evaluated, with its result.
 *
 * @param {Record<string, { thresholds?: Record<string, { ok: boolean }> }>} metrics - k6's summary metrics.
 * @returns {string[]} One line per threshold, in metric order.
 */
export const thresholdLines = (metrics) =>
  thresholdResults(metrics).map(
    ({ metric, expression, ok }) =>
      `Threshold ${metric} ${expression}: ${ok ? 'passed' : 'FAILED'}`
  )
