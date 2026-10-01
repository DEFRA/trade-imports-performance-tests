const MIN_THINK_FACTOR = 0.5
const PAGES_PER_RE_EDIT = 2

/**
 * Splits a list in order into chunks whose sizes differ by at most one.
 *
 * @param {Array} items - The items to split.
 * @param {number} count - How many chunks.
 * @returns {Array[]} The chunks, earlier ones larger.
 */
export const chunkEvenly = (items, count) => {
  const base = Math.floor(items.length / count)
  const larger = items.length % count
  let start = 0

  return Array.from({ length: count }, (_, index) => {
    const end = start + base + (index < larger ? 1 : 0)
    const chunk = items.slice(start, end)

    start = end

    return chunk
  })
}

/**
 * Draws a wait from half to one and a half times its mean.
 *
 * @param {number} mean - The mean wait in seconds.
 * @param {number} random - A number from 0 up to, not including, 1.
 * @returns {number} Seconds.
 */
export const thinkSeconds = (mean, random) => mean * (MIN_THINK_FACTOR + random)

/**
 * Plans the re-edits that bring a notification up to its page target.
 *
 * @param {string[]} stepNames - The steps that are safe to open and save again.
 * @param {number} pagesSoFar - The pages requested so far.
 * @param {number} pagesTarget - The pages a notification should reach.
 * @param {number} [pagesPerReEdit] - Page requests one re-edit makes.
 * @returns {string[]} Step names to re-edit, round-robin. Empty when the target is met.
 */
export const reEditPlan = (
  stepNames,
  pagesSoFar,
  pagesTarget,
  pagesPerReEdit = PAGES_PER_RE_EDIT
) => {
  const reEdits = Math.max(
    0,
    Math.ceil((pagesTarget - pagesSoFar) / pagesPerReEdit)
  )

  return Array.from(
    { length: reEdits },
    (_, index) => stepNames[index % stepNames.length]
  )
}
