/**
 * Encodes form fields as an `application/x-www-form-urlencoded` body.
 *
 * k6 has no `URLSearchParams`. An array value repeats its key.
 *
 * @param {Record<string, string | string[]>} fields - Field names and values.
 * @returns {string} The encoded body.
 */
export const encodeForm = (fields) =>
  Object.entries(fields)
    .flatMap(([name, value]) =>
      [value]
        .flat()
        .map((one) => `${encodeURIComponent(name)}=${encodeURIComponent(one)}`)
    )
    .join('&')

/**
 * Builds the fields a browser would post: the page's hidden fields, then the answers.
 *
 * @param {Record<string, string>} hiddenFields - Hidden inputs read off the rendered form.
 * @param {Record<string, string | string[]>} answers - The values to submit.
 * @returns {Record<string, string | string[]>} The fields, answers winning. An answer that is `undefined`, such as a choice the page did not offer, is left out.
 */
export const formFields = (hiddenFields, answers) => ({
  ...hiddenFields,
  ...Object.fromEntries(
    Object.entries(answers).filter(([, value]) => value !== undefined)
  )
})

const CHOICE_TYPES = new Set(['radio', 'checkbox'])

const isSubmitted = ({ name, type, value, checked }) =>
  Boolean(name) && Boolean(value) && (!CHOICE_TYPES.has(type) || checked)

const collectValue = (fields, { name, value }) => ({
  ...fields,
  [name]: name in fields ? [fields[name], value].flat() : value
})

/**
 * Reads the values a browser would send for a form the user has not touched.
 *
 * Text fields and selects that hold a value are sent as they stand, and a
 * radio or checkbox is sent only when it is ticked. Empty fields are left out.
 *
 * @param {Array<{ name: string, type: string, value: string, checked?: boolean }>} formInputs - The form's inputs, as read off the page.
 * @returns {Record<string, string | string[]>} The prefilled values by field name.
 */
export const prefilledFields = (formInputs) =>
  formInputs.filter(isSubmitted).reduce(collectValue, {})
