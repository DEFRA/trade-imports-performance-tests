import { check } from 'k6'

import { WORST_CASE_SEARCH_LENGTH } from '../config/test-data.js'
import { worstCaseSearchTerm } from '../lib/address-book.js'
import { pickOne } from '../lib/distributions.js'

const HTTP_OK = 200

/**
 * Tells whether a save landed on a page that rendered, with no stale-save redirect.
 *
 * @param {{ status: number, tooManyRedirects: boolean, staleActionHandled: boolean }} page - A page from a browser session.
 * @returns {boolean} True when the save succeeded.
 */
export const isSaved = (page) =>
  page.status === HTTP_OK && !page.tooManyRedirects && !page.staleActionHandled

/**
 * Checks that a step's last save landed, and hands the landing page on.
 *
 * @param {string} name - The step's name, which names the check.
 * @param {object} page - The page the save landed on.
 * @returns {object} The same page.
 */
export const saved = (name, page) => {
  check(page, { [`${name} saved`]: isSaved })

  return page
}

const labelOf = (page, input) =>
  page.html.find(`label[for="${input.attr('id')}"]`).text()

const choiceInputs = (page, name) =>
  page.html?.find(`input[name="${name}"]`).toArray() ?? []

/**
 * Reads the values of a radio group or a checkbox group, in page order.
 *
 * @param {{ html?: object }} page - A page from a browser session.
 * @param {string} name - The inputs' name.
 * @returns {string[]} Their values.
 */
export const choiceValues = (page, name) =>
  choiceInputs(page, name).map((input) => input.attr('value'))

/**
 * Finds the value of the choice whose label names a given text.
 *
 * Falls back to the first choice, so a page that lists something else still
 * gets an answer and the next check says what went wrong.
 *
 * @param {{ html?: object }} page - A page from a browser session.
 * @param {string} name - The inputs' name.
 * @param {string} text - Text the wanted choice's label contains.
 * @returns {string | undefined} The value, or undefined when the page has no such input.
 */
export const choiceLabelled = (page, name, text) => {
  const inputs = choiceInputs(page, name)
  const wanted = inputs.find((input) => labelOf(page, input).includes(text))

  return (wanted ?? inputs[0])?.attr('value')
}

/**
 * Builds the path of one page of a notification.
 *
 * @param {{ base: string }} context - The step context.
 * @param {string} slug - The page's slug.
 * @returns {string} The path.
 */
export const pagePath = ({ base }, slug) => `${base}/${slug}`

const searchWorstCase = (context, opened, endpoints) => {
  const { walker, worstCaseSearch } = context

  worstCaseSearch.pending = false

  const answered = walker.submit(
    opened,
    { q: worstCaseSearchTerm(WORST_CASE_SEARCH_LENGTH), action: 'search' },
    endpoints.search
  )

  check(answered, {
    'worst-case address search answered': (page) => page.status === HTTP_OK
  })

  return answered
}

/**
 * Picks the performance-test address on a picker page.
 *
 * Opens the picker, searches for the address by name, then saves the radio
 * whose label names it. The picker's own save lands on the page it came from.
 * When the notification's worst-case search is still pending, the first picker
 * runs it before the real search.
 *
 * @param {object} context - The step context.
 * @param {object} options - Picker settings.
 * @param {object} options.landed - The page the previous step landed on.
 * @param {string} options.slug - The picker's slug.
 * @param {string} options.field - The radio group's name.
 * @param {{ open: string, search: string, save: string }} options.endpoints - The picker's endpoint names.
 * @returns {object} The page the picker's save landed on.
 */
export const pickAddress = (context, { landed, slug, field, endpoints }) => {
  const { walker, addressName } = context
  const opened = walker.reach(landed, pagePath(context, slug), endpoints.open)
  const searchFrom = context.worstCaseSearch?.pending
    ? searchWorstCase(context, opened, endpoints)
    : opened
  const searched = walker.submit(
    searchFrom,
    { q: addressName, action: 'search' },
    endpoints.search
  )

  return walker.submit(
    searched,
    { [field]: choiceLabelled(searched, field, addressName), action: 'save' },
    endpoints.save
  )
}

/**
 * Draws one of the values a page offers.
 *
 * @param {{ random: () => number }} context - The step context.
 * @param {Array} values - The values to choose from.
 * @returns {*} The chosen value, or undefined for an empty list.
 */
export const pickFrom = (context, values) => pickOne(values, context.random())

/**
 * Picks the parts of a step context that identify one notification's run.
 *
 * @param {{ vu: number, iteration: number }} context - The step context.
 * @returns {{ vu: number, iteration: number }} The virtual user and iteration.
 */
export const identityOf = ({ vu, iteration }) => ({ vu, iteration })

/**
 * Builds a step that reaches a page, answers it and checks the save landed.
 *
 * @param {string} name - The step's name, which names the check.
 * @param {string} slug - The page's slug.
 * @param {{ open: string, save: string }} endpoints - The page's endpoint names.
 * @param {(context: object, page: object) => object} answersFor - Works out the answers from the step context and the opened page.
 * @returns {{ name: string, run: (context: object, landed: object) => object }} The step.
 */
export const reachAndSubmit = (name, slug, endpoints, answersFor) => ({
  name,
  run: (context, landed) => {
    const page = context.walker.reach(
      landed,
      pagePath(context, slug),
      endpoints.open
    )

    return saved(
      name,
      context.walker.submit(page, answersFor(context, page), endpoints.save)
    )
  }
})
