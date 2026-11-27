import { freezeDeep } from './traffic.js'

/**
 * The CloudWatch metric and dimension names of each way of publishing, `pascal`
 * or `dotted`: the names of its external calls and, for `dotted`, of its page
 * requests.
 */
export const METRIC_SCHEMES = freezeDeep({
  pascal: {
    externalCalls: {
      duration: 'ExternalCallDuration',
      failure: 'ExternalCallFailure',
      dependency: 'Dependency',
      operation: 'Operation'
    }
  },
  dotted: {
    externalCalls: {
      duration: 'external.call.duration',
      failure: 'external.call.failure',
      dependency: 'dependency',
      operation: 'operation'
    },
    pageRequests: {
      dimension: { Name: 'request.kind', Value: 'page' },
      backendCalls: 'page.request.backend.calls',
      sessionResolutions: 'page.request.session.resolutions'
    }
  }
})

/**
 * Each external call statistic: its result key, the scheme metric it comes
 * from (`duration` or `failure`) and the CloudWatch statistic.
 * `SampleCount` of the duration is the call count, and `Average` of the
 * failure metric is the error rate.
 */
export const EXTERNAL_CALL_STATISTICS = Object.freeze([
  { key: 'p50Ms', metric: 'duration', stat: 'p50' },
  { key: 'p95Ms', metric: 'duration', stat: 'p95' },
  { key: 'p99Ms', metric: 'duration', stat: 'p99' },
  { key: 'calls', metric: 'duration', stat: 'SampleCount' },
  { key: 'errorRate', metric: 'failure', stat: 'Average' }
])

const FRONTENDS = Object.freeze([
  'trade-imports-ins-frontend',
  'trade-imports-animals-frontend',
  'trade-imports-plants-frontend'
])

/**
 * The metric scheme, `pascal` or `dotted`, each service publishes its external
 * calls with, and a journey frontend its page requests with, keyed by its CDP
 * service name.
 */
export const SCHEME_BY_SERVICE = freezeDeep({
  'trade-imports-ins-frontend': { externalCalls: 'pascal' },
  'trade-imports-animals-frontend': {
    externalCalls: 'dotted',
    pageRequests: 'dotted'
  },
  'trade-imports-plants-frontend': {
    externalCalls: 'dotted',
    pageRequests: 'dotted'
  },
  'trade-imports-reference-data': { externalCalls: 'dotted' },
  'trade-imports-dynamics-gateway': { externalCalls: 'dotted' }
})

const DEFRA_ID_OPERATIONS = Object.freeze([
  { operation: 'openid-configuration', interfaceId: null },
  { operation: 'jwks', interfaceId: 'SYN-12' },
  { operation: 'token-exchange', interfaceId: 'SYN-11' },
  { operation: 'token-refresh', interfaceId: 'SYN-13' }
])

const defraIdCalls = FRONTENDS.flatMap((service) =>
  DEFRA_ID_OPERATIONS.map(({ operation, interfaceId }) => ({
    service,
    dependency: 'defra-id',
    operation,
    interfaceId
  }))
)

/**
 * Calls to systems outside the INS boundary. `service` is the CDP service name
 * and CloudWatch namespace of the caller, `dependency` is the integration id of
 * its stub profile, and `interfaceId` is the interface id of the call, or null.
 */
export const EXTERNAL_CALLS = freezeDeep([
  ...defraIdCalls,
  {
    service: 'trade-imports-reference-data',
    dependency: 'trade-token',
    operation: 'client-credentials-token',
    interfaceId: 'SYN-19'
  },
  {
    service: 'trade-imports-reference-data',
    dependency: 'mdm',
    operation: 'get-countries',
    interfaceId: 'SYN-19'
  },
  {
    service: 'trade-imports-reference-data',
    dependency: 'mdm',
    operation: 'get-ports-of-entry',
    interfaceId: 'SYN-19'
  },
  {
    service: 'trade-imports-dynamics-gateway',
    dependency: 'azure-service-bus',
    operation: 'send-message',
    interfaceId: null
  }
])
