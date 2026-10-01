const SERVER_OWNED_FIELDS = [
  'id',
  'referenceNumber',
  'concurrencyToken',
  'status',
  'created',
  'updated',
  'submittedAt'
]

const shapeFieldsOf = (listItem) =>
  Object.fromEntries(
    Object.entries(listItem).filter(
      ([name, value]) => !SERVER_OWNED_FIELDS.includes(name) && value !== null
    )
  )

/**
 * Assembles a backend replace request body from the backend's own record of a frontend save.
 *
 * Every value is copied from the two responses. None is invented, so the body
 * is a capture of what the frontend persisted and never a hand-built one.
 *
 * @param {{ referenceNumber: string, concurrencyToken: string, fulfilments: unknown }} fulfilmentsView - The backend's fulfilments read.
 * @param {Record<string, unknown>} listItem - The notification as the backend's list read returns it.
 * @returns {{ notification: Record<string, unknown> }} The replace body.
 */
export const replaceBodyFrom = (fulfilmentsView, listItem) => {
  const { referenceNumber, concurrencyToken, fulfilments } = fulfilmentsView

  if (listItem === undefined || listItem === null) {
    throw new Error('Cannot replay a save the backend list does not hold')
  }

  if (fulfilments === undefined || fulfilments === null) {
    throw new Error('Cannot replay a save that has no fulfilments')
  }

  if (concurrencyToken === undefined || concurrencyToken === null) {
    throw new Error('Cannot replay a save that has no concurrencyToken')
  }

  return {
    notification: {
      ...shapeFieldsOf(listItem),
      referenceNumber,
      concurrencyToken,
      fulfilments
    }
  }
}
