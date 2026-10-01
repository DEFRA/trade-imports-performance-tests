export const ENDPOINT_KINDS = Object.freeze({ PAGE: 'page', API: 'api' })

const { PAGE, API } = ENDPOINT_KINDS

export const ENDPOINTS = Object.freeze({
  'sign-in': PAGE,
  'ins-dashboard': PAGE,
  'animals-dashboard': PAGE,
  'animals-create': PAGE,
  'animals-origin': PAGE,
  'animals-origin-save': PAGE,
  'plants-dashboard': PAGE,
  'plants-create': PAGE,
  'plants-commodity-type': PAGE,
  'plants-commodity-type-save': PAGE,
  'animals-backend-fulfilments': API,
  'animals-backend-list': API,
  'animals-backend-replace': API,
  'plants-backend-fulfilments': API,
  'plants-backend-list': API,
  'plants-backend-replace': API
})

/**
 * Looks up whether an endpoint is a frontend page or a backend API call.
 *
 * Throws for a name outside the catalogue, so a typo cannot leave a request
 * without a threshold.
 *
 * @param {string} endpoint - An endpoint name from `ENDPOINTS`.
 * @returns {string} `page` or `api`.
 */
export const kindOf = (endpoint) => {
  const kind = ENDPOINTS[endpoint]

  if (!kind) {
    throw new Error(`Unknown endpoint "${endpoint}"`)
  }

  return kind
}
