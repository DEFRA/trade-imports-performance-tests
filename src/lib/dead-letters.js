const NOT_MEASURED =
  "Service Bus stand-in: not measured, the gateway's dead-letter queue could not be read"

/**
 * Works out how many messages the gateway's dead-letter queue gained over a run.
 *
 * A message the gateway could not publish to Azure Service Bus is retried, then
 * moved to the dead-letter queue, so growth there is a failure cascading to the
 * Service Bus stand-in.
 *
 * @param {object} options - The two readings.
 * @param {number | null} options.before - The queue's depth at the start, or null when it could not be read.
 * @param {number | null} options.after - The queue's depth at the end, or null when it could not be read.
 * @returns {number | null} The growth, never below 0; null when either reading is missing.
 */
export const deadLetterGrowth = ({ before, after }) =>
  before === null || after === null ? null : Math.max(0, after - before)

const messagesText = (count) =>
  `${count} ${count === 1 ? 'message' : 'messages'}`

/**
 * States what the dead-letter queue held at each end of a run.
 *
 * @param {object} options - The two readings.
 * @param {number | null} options.before - The queue's depth at the start, or null when it could not be read.
 * @param {number | null} options.after - The queue's depth at the end, or null when it could not be read.
 * @returns {string} The line.
 */
export const deadLetterLine = ({ before, after }) => {
  const growth = deadLetterGrowth({ before, after })

  if (growth === null) {
    return NOT_MEASURED
  }

  const held = `Service Bus stand-in: the gateway's dead-letter queue held ${messagesText(before)} at the start and ${after} at the end`

  return growth > 0
    ? `${held}: CASCADED, ${growth} more`
    : `${held}: no cascade`
}
