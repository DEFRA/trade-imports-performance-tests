const ADD_ADDRESS_PATH = '/address-book/add'
const SEED_ADDRESS_TYPE = 'ORIGIN_OR_CONSIGNOR'

/**
 * Opens the INS add-address form, which now starts on Choose an address type.
 *
 * Opening the form with no type chosen redirects to the type step, so this
 * chooses the first type there and returns the address form it leads to. Both
 * requests carry the add endpoint tag.
 *
 * @param {(path: string, endpoint: string) => object} open - Opens a path and follows its redirects.
 * @param {(page: object, answers: object, endpoint: string) => object} submit - Submits a page's form with the answers.
 * @param {string} endpoint - The endpoint tag for the add requests.
 * @returns {object} The address form page.
 */
export const openAddForm = (open, submit, endpoint) =>
  submit(
    open(ADD_ADDRESS_PATH, endpoint),
    { addressType: SEED_ADDRESS_TYPE },
    endpoint
  )
