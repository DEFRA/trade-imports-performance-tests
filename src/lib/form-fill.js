const MS_PER_DAY = 86_400_000

const TEXT_LIKE_TYPES = new Set([
  'text',
  'search',
  'number',
  'tel',
  'email',
  '',
  'textarea'
])
const SEARCH_FIELDS = new Set([
  'q',
  'commoditySearch',
  'search',
  'referenceNumber'
])

const FIELD_RULES = Object.freeze([
  [/^numberOfAnimalsQuantity/, '1'],
  [/^numberOfPackages/, '5'],
  [/tag/i, 'UK123456789012'],
  [/quantity/i, '5'],
  [/commodityCode/, '0602 20 20'],
  [/eppoCode/, 'PIEAB'],
  [/species/, 'Picea abies']
])

const isBlankTextField = ({ type, value, name }) =>
  TEXT_LIKE_TYPES.has(type ?? '') && !value && !SEARCH_FIELDS.has(name)

const answerFor = (name, { vu, iteration }) =>
  FIELD_RULES.find(([pattern]) => pattern.test(name))?.[1] ??
  `PERF${vu}${iteration}`

/**
 * Picks the first option that is not the empty placeholder.
 *
 * @param {string[]} values - Option values in page order.
 * @returns {string} The first non-empty value, or an empty string.
 */
export const firstOption = (values) => values.find((value) => value) ?? ''

const selectAnswerEntries = (input) =>
  input.value ? [] : [[input.name, firstOption(input.options)]]

const answerEntries = (input, identity) => {
  if (input.type === 'select') {
    return selectAnswerEntries(input)
  }

  return isBlankTextField(input)
    ? [[input.name, answerFor(input.name, identity)]]
    : []
}

/**
 * Answers every field of a form the user has left empty.
 *
 * Text fields get a value that passes validation, chosen by field name.
 * Selects with nothing chosen get their first real option. Search boxes and
 * fields that already hold a value are left alone.
 *
 * @param {Array<{ name: string, type: string, value: string, options?: string[] }>} formInputs - The form's inputs, as read off the page.
 * @param {{ vu: number, iteration: number }} identity - The virtual user and iteration, for unique values.
 * @returns {Record<string, string>} Answers by field name.
 */
export const blankFieldAnswers = (formInputs, identity) =>
  Object.fromEntries(
    formInputs.flatMap((input) => answerEntries(input, identity))
  )

/**
 * Writes a date the way the frontends render one, in UTC.
 *
 * @param {Date} now - The starting moment.
 * @param {number} daysAhead - Whole days to add.
 * @returns {string} A date as `d/m/yyyy`, with no zero padding.
 */
export const arrivalDateText = (now, daysAhead) => {
  const date = new Date(now.getTime() + daysAhead * MS_PER_DAY)

  return `${date.getUTCDate()}/${date.getUTCMonth() + 1}/${date.getUTCFullYear()}`
}
