import { freezeDeep } from './traffic.js'

export const DURATION_METRIC = 'ExternalCallDuration'
export const FAILURE_METRIC = 'ExternalCallFailure'

/**
 * The statistics the report reads for each external call, and the CloudWatch
 * metric and statistic each comes from. `SampleCount` of the duration is the
 * call count, and `Average` of the failure metric is the error rate.
 */
export const EXTERNAL_CALL_STATISTICS = Object.freeze([
  { key: 'p50Ms', metric: DURATION_METRIC, stat: 'p50' },
  { key: 'p95Ms', metric: DURATION_METRIC, stat: 'p95' },
  { key: 'p99Ms', metric: DURATION_METRIC, stat: 'p99' },
  { key: 'calls', metric: DURATION_METRIC, stat: 'SampleCount' },
  { key: 'errorRate', metric: FAILURE_METRIC, stat: 'Average' }
])

const FRONTENDS = Object.freeze([
  'trade-imports-ins-frontend',
  'trade-imports-animals-frontend',
  'trade-imports-plants-frontend'
])

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
 * Every call an INS service makes to a system outside the boundary, and so
 * every call the services measure. `service` is the CDP service name, which is
 * also the CloudWatch namespace it publishes to. The strings are the services'
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
