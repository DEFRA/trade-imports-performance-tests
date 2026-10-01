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
 * @returns {Record<string, string | string[]>} The fields, answers winning.
 */
export const formFields = (hiddenFields, answers) => ({
  ...hiddenFields,
  ...answers
})
