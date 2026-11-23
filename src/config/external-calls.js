import { freezeDeep } from './traffic.js'

/**
 * The CloudWatch metric and dimension names each way of publishing external
 * calls uses: `pascal` or `dotted`. `SCHEME_BY_SERVICE` gives each service's.
 */
export const METRIC_SCHEMES = freezeDeep({
  pascal: {
    duration: 'ExternalCallDuration',
    failure: 'ExternalCallFailure',
    dependency: 'Dependency',
    operation: 'Operation'
  },
  dotted: {
    duration: 'external.call.duration',
    failure: 'external.call.failure',
    dependency: 'dependency',
    operation: 'operation'
  }
})

/**
 * The statistics the report reads for each external call, and the metric of
 * the call's scheme and the statistic each comes from. `SampleCount` of the
 * duration is the call count, and `Average` of the failure metric is the error
 * rate.
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
 * The `METRIC_SCHEMES` entry each service publishes its external calls with,
 * keyed by its CDP service name.
 */
export const SCHEME_BY_SERVICE = Object.freeze({
  'trade-imports-ins-frontend': 'pascal',
  'trade-imports-animals-frontend': 'dotted',
  'trade-imports-plants-frontend': 'pascal',
  'trade-imports-reference-data': 'dotted',
  'trade-imports-dynamics-gateway': 'dotted'
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
 * The calls to systems outside the INS boundary that the report reads.
 * `service` is the CDP service name, which is
 * also the CloudWatch namespace it publishes to, and its `SCHEME_BY_SERVICE`
 * entry gives the metric names. The strings are the services'
 * contract: each service emits exactly these dependency and operation names, and
 * `dependency` is the integration id of its stub profile.
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
