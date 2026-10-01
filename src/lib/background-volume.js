export const DATASTORES = Object.freeze([
  'live-animals',
  'high-risk-plants',
  'dashboard-read-model',
  'address-book'
])
const CREATED_DATASTORES = DATASTORES.filter(
  (datastore) => datastore !== 'dashboard-read-model'
)
const ADDRESS_LABEL = /^Showing \d+-\d+ of (\d+)$/

/**
 * Works out how many notifications or addresses a run still has to create.
 *
 * @param {number} target - The volume the environment should hold.
 * @param {number} existing - The volume it holds now.
 * @param {number} cap - The most one run may create.
 * @returns {number} Whole items to create, never below 0.
 */
export const toCreate = (target, existing, cap) =>
  Math.min(Math.max(0, target - existing), cap)

/**
 * Reads the number of addresses from the address-book list's results label.
 *
 * A blank label counts as empty only on the address-book list page, so a
 * sign-in or error page is never read as an empty book.
 *
 * @param {object} page - What the page shows.
 * @param {string | undefined} page.heading - The page's heading.
 * @param {string} page.labelText - The text of the label, empty when the book is empty.
 * @returns {number | undefined} The total, 0 for a blank label on the list page, or undefined when the page is not the list or the text is not a results label.
 */
export const addressCountFrom = ({ heading, labelText }) => {
  if (heading !== 'Address book') {
    return undefined
  }

  const text = labelText.trim()

  if (text === '') {
    return 0
  }

  const total = ADDRESS_LABEL.exec(text)?.[1]

  return total === undefined ? undefined : Number(total)
}

/**
 * Names a background address, which never matches the pickers' performance-test
 * address or the address-book sessions' addresses.
 *
 * @param {number} index - The address's number across the background volume, from 0.
 * @returns {string} The name.
 */
export const backgroundAddressName = (index) =>
  `Background Address ${index + 1}`

const countOf = (volume, targets, datastore) =>
  targets[datastore] === undefined
    ? `${volume[datastore]}`
    : `${volume[datastore]} of ${targets[datastore]}`

/**
 * States the background volume each datastore holds.
 *
 * @param {string} moment - When it was read, `start` or `end`.
 * @param {Record<string, number>} volume - The count in each datastore.
 * @param {Record<string, number>} targets - The target of each datastore that has one.
 * @returns {string} The line to log.
 */
export const volumeLine = (moment, volume, targets) =>
  `Background volume at ${moment}: ${DATASTORES.map(
    (datastore) => `${datastore} ${countOf(volume, targets, datastore)}`
  ).join(', ')}`

/**
 * States how much a run created. The read model is left out because it fills
 * from events, after the run.
 *
 * @param {Record<string, number>} before - The volume when the run started.
 * @param {Record<string, number>} after - The volume when it finished.
 * @returns {string} The line to log.
 */
export const createdLine = (before, after) =>
  `Created this run: ${CREATED_DATASTORES.map(
    (datastore) => `${datastore} ${after[datastore] - before[datastore]}`
  ).join(', ')}`

/**
 * Names every datastore that holds less than its target.
 *
 * @param {Record<string, number>} volume - The count in each datastore.
 * @param {Record<string, number>} targets - The target of each datastore that has one.
 * @returns {string | undefined} The message, or undefined when every target is met.
 */
export const shortfallMessage = (volume, targets) => {
  const short = DATASTORES.filter(
    (datastore) =>
      targets[datastore] !== undefined && volume[datastore] < targets[datastore]
  )

  return short.length === 0
    ? undefined
    : `Background volume is below target: ${short
        .map(
          (datastore) =>
            `${datastore} ${volume[datastore]} of ${targets[datastore]}`
        )
        .join(', ')}`
}
