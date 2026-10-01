const SHARE_PRECISION = 1e9

const shortfallOf = ({ share }, drawn, position) =>
  Math.round((share * (position + 1) - drawn) * SHARE_PRECISION)

const rarestWithLargestShortfall = (buckets, drawn, position) =>
  buckets.reduce(
    (chosen, bucket, index) => {
      const shortfall = shortfallOf(bucket, drawn[index], position)

      return shortfall >= chosen.shortfall ? { index, shortfall } : chosen
    },
    { index: 0, shortfall: Number.NEGATIVE_INFINITY }
  ).index

/**
 * Draws the bucket a notification falls in, spreading buckets over
 * notifications so each bucket gets exactly its share.
 *
 * Each notification takes the bucket whose running shortfall against its share
 * is largest. A tie goes to the later, rarer bucket, so a small bucket is
 * reached as early as its share allows. The draw is repeatable: the same
 * notification number always gets the same bucket.
 *
 * @param {number} index - The notification's number across the whole test, from 0.
 * @param {Array<{ share: number }>} buckets - Buckets whose shares add up to 1.
 * @returns {{ bucket: object, indexInBucket: number }} The bucket and how many notifications it had before this one.
 */
export const bucketAt = (index, buckets) => {
  const drawn = buckets.map(() => 0)
  let chosen = 0

  for (let position = 0; position <= index; position += 1) {
    chosen = rarestWithLargestShortfall(buckets, drawn, position)

    if (position < index) {
      drawn[chosen] += 1
    }
  }

  return { bucket: buckets[chosen], indexInBucket: drawn[chosen] }
}

/**
 * Works out a notification's count (commodity lines, documents) from count buckets.
 *
 * Counts step down from the bucket's maximum, so the first notification drawn
 * into a bucket has exactly its maximum.
 *
 * @param {number} index - The notification's number across the whole test, from 0.
 * @param {Array<{ share: number, min: number, max: number }>} buckets - Count buckets whose shares add up to 1.
 * @returns {number} The count.
 */
export const countAt = (index, buckets) => {
  const {
    bucket: { min, max },
    indexInBucket
  } = bucketAt(index, buckets)

  return max - (indexInBucket % (max - min + 1))
}

/**
 * Works out a notification's value (its type) from value buckets.
 *
 * @param {number} index - The notification's number across the whole test, from 0.
 * @param {Array<{ share: number, value: string }>} buckets - Value buckets whose shares add up to 1.
 * @returns {string} The value.
 */
export const valueAt = (index, buckets) => bucketAt(index, buckets).bucket.value

/**
 * Picks the value whose cumulative share range holds a random number.
 *
 * @param {Array<{ share: number, value: string }>} buckets - Value buckets whose shares add up to 1.
 * @param {number} random - A number from 0 up to, not including, 1.
 * @returns {string} The value.
 */
export const valueAtRandom = (buckets, random) => {
  let cumulative = 0

  for (const { share, value } of buckets) {
    cumulative += share

    if (random < cumulative) {
      return value
    }
  }

  return buckets.at(-1).value
}

/**
 * Picks one of a list of values.
 *
 * @param {Array} values - The values to choose from.
 * @param {number} random - A number from 0 up to, not including, 1.
 * @returns {*} The chosen value, or undefined for an empty list.
 */
export const pickOne = (values, random) =>
  values[Math.floor(random * values.length)]
