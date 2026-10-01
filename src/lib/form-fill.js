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

const selectAnswerEntries = (input, chooseOption) =>
  input.value ? [] : [[input.name, chooseOption(input.options)]]

const answerEntries = (input, identity, chooseOption) => {
  if (input.type === 'select') {
    return selectAnswerEntries(input, chooseOption)
  }

  return isBlankTextField(input)
    ? [[input.name, answerFor(input.name, identity)]]
    : []
}

/**
 * Answers every field of a form the user has left empty.
 *
 * Text fields get a value that passes validation, chosen by field name.
 * Selects with nothing chosen get the option the chooser picks, by default the
 * first real one. Search boxes and fields that already hold a value are left
 * alone.
 *
 * @param {Array<{ name: string, type: string, value: string, options?: string[] }>} formInputs - The form's inputs, as read off the page.
 * @param {{ vu: number, iteration: number }} identity - The virtual user and iteration, for unique values.
 * @param {(options: string[]) => string} [chooseOption] - Picks a select's answer from its option values.
 * @returns {Record<string, string>} Answers by field name.
 */
export const blankFieldAnswers = (
  formInputs,
  identity,
  chooseOption = firstOption
) =>
  Object.fromEntries(
    formInputs.flatMap((input) => answerEntries(input, identity, chooseOption))
  )

/**
 * Reads the option values of the select with a given name.
 *
 * @param {Array<{ name: string, options?: string[] }>} formInputs - The form's inputs, as read off the page.
 * @param {string} name - The select's name.
 * @returns {string[]} Its option values, or an empty list when the form has no such select.
 */
export const selectOptions = (formInputs, name) =>
  formInputs.find((input) => input.name === name && input.options)?.options ??
  []

/**
 * Tells whether a form has an input with a given name.
 *
 * @param {Array<{ name: string }>} formInputs - The form's inputs, as read off the page.
 * @param {string} name - The input's name.
 * @returns {boolean} True when the form has it.
 */
export const hasField = (formInputs, name) =>
  formInputs.some((input) => input.name === name)

/**
 * Writes a date the way the frontends render one, in UTC.
 *
 * @param {Date} now - The starting moment.
 * @param {number} dayOffset - Whole days to add; negative for a past date.
 * @returns {string} A date as `d/m/yyyy`, with no zero padding.
 */
export const slashDateText = (now, dayOffset) => {
  const date = new Date(now.getTime() + dayOffset * MS_PER_DAY)

  return `${date.getUTCDate()}/${date.getUTCMonth() + 1}/${date.getUTCFullYear()}`
}
