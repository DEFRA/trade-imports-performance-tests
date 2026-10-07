import { freezeDeep } from './traffic.js'

/**
 * The latency INS asks of a dependency until its owner publishes a service
 * level: the targets every `sla` stub profile is fitted to.
 */
export const INTERIM_REQUIRED_LATENCY = Object.freeze({
  p50Ms: 100,
  p95Ms: 400,
  p99Ms: 1000,
  source:
    'Interim (c-011 default): §9.5 latency TBC; the targets the sla stub profiles are fitted to'
})

/**
 * What the volumetrics page derives for Address Lookup (§9.4, vol-259). The
 * figures are TBC: D4 and D5 are assumptions and the spike (D6) is unknown.
 */
export const ADDRESS_LOOKUP_DERIVED = Object.freeze({
  addressesPerNotification: 3,
  callsPerAddress: 2,
  section94PerHour: 240,
  section94SustainedPerSecond: 0.07,
  section94BurstPerSecond: 0.1,
  source: '§9.4 Address Lookup row (vol-259); D4, D5 TBC; spike TBC (D6)'
})

export const PUBLISHED_SLA_SOURCE = '§9.5: every service level is TBC (vol-265)'

/**
 * The service level each owner has published, as `{ throughputPerSecond,
 * p95Ms, p99Ms, source }`, or null while none has. Recording an owner's figure
 * here changes the risk verdict without changing any script.
 */
export const PUBLISHED_SLAS = Object.freeze({
  'address-lookup': null,
  'defra-id': null,
  'trade-token': null,
  mdm: null,
  'azure-service-bus': null
})

/**
 * Every system outside the boundary INS needs a service level from, in the
 * order the statement lists them, with Address Lookup first. `basis` says how
 * the calls are known: `measured` from the frontends' own counts, `shared`
 * from the stub's answered count over both journeys, `event-driven` from the
 * events forwarded for each notification, or `no-caller` where nothing calls
 * the dependency yet.
 */
export const REQUIRED_SLA_DEPENDENCIES = freezeDeep([
  {
    dependency: 'address-lookup',
    owner: 'APIM / address service owner',
    interfaces: ['SYN-20a', 'SYN-20b', 'SYN-20c'],
    basis: 'no-caller',
    callers: [],
    requiredLatency: null,
    latencyNote: 'TBC (§9.5; open item 12)',
    spikeNote: 'TBC (D6: type-ahead unknown)',
    note: 'no INS service calls it yet (c-009 default; req-035)'
  },
  {
    dependency: 'defra-id',
    owner: 'Customer Identity',
    interfaces: ['SYN-11', 'SYN-12', 'SYN-13'],
    basis: 'measured',
    callers: [
      'trade-imports-animals-frontend',
      'trade-imports-plants-frontend'
    ],
    requiredLatency: INTERIM_REQUIRED_LATENCY,
    latencyNote: INTERIM_REQUIRED_LATENCY.source,
    spikeNote: null,
    note: 'journey frontends measured; the front door sign-ins are derived'
  },
  {
    dependency: 'trade-token',
    owner: 'Trade Platform (TBC: no §9.5 row)',
    interfaces: ['SYN-19'],
    basis: 'shared',
    callers: ['trade-imports-reference-data'],
    requiredLatency: INTERIM_REQUIRED_LATENCY,
    latencyNote: INTERIM_REQUIRED_LATENCY.source,
    spikeNote: null,
    note: "both journeys together, through trade-imports-reference-data's cache"
  },
  {
    dependency: 'mdm',
    owner: 'MDM / data platform team',
    interfaces: ['SYN-19'],
    basis: 'shared',
    callers: ['trade-imports-reference-data'],
    requiredLatency: INTERIM_REQUIRED_LATENCY,
    latencyNote: INTERIM_REQUIRED_LATENCY.source,
    spikeNote: null,
    note: "both journeys together, through trade-imports-reference-data's cache"
  },
  {
    dependency: 'azure-service-bus',
    owner: 'TBC: no §9.5 row',
    interfaces: [],
    basis: 'event-driven',
    callers: ['trade-imports-dynamics-gateway'],
    requiredLatency: null,
    latencyNote:
      '§9.5 gives no figure; asynchronous interfaces need delivery and drain targets, not latency (§9.7)',
    spikeNote: 'none: asynchronous through SQS (§9.7)',
    note: 'called by the gateway for each forwarded event, never by a page'
  }
])
