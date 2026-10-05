import http from 'k6/http'

import { gatewayHeaders } from '../config/target.js'

const withGatewayKey = (url, params = {}) => ({
  ...params,
  headers: { ...params.headers, ...gatewayHeaders(__ENV, url) }
})

/**
 * k6's HTTP calls for backend services. A call to an address under CDP's
 * protected gateway carries the developer API key as `x-api-key`; any other
 * call is sent unchanged.
 */
export const serviceHttp = Object.freeze({
  get: (url, params) => http.get(url, withGatewayKey(url, params)),
  post: (url, body, params) =>
    http.post(url, body, withGatewayKey(url, params)),
  put: (url, body, params) => http.put(url, body, withGatewayKey(url, params)),
  del: (url, body, params) => http.del(url, body, withGatewayKey(url, params))
})
