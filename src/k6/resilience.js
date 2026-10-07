import http from 'k6/http'
import exec from 'k6/execution'
import { Counter, Gauge } from 'k6/metrics'

import {
  FAULT_CATALOGUE,
  FAULT_HOSTS,
  INJECTION_CODES,
  SERVICE_BUS_PROXY,
  STUB_HOSTED_INTEGRATIONS,
  notInjectedReason,
  stubFaultBody,
  toxicBody,
  toxicName
} from '../config/resilience.js'
import { SCHEMA_VERSIONS } from '../config/eventing.js'
import { phaseAt } from '../lib/phases.js'
import {
  INITIAL_CONTROL_STATE,
  counterDelta,
  faultOfPhase,
  nextControlActions,
  notInjectedLine,
  toxicsCleared
} from '../lib/resilience.js'
import { readDeadLetterCount } from './dead-letters.js'
import { readBacklogDepth, readForwardedCounts } from './eventing.js'
import { READINESS_TAGS } from './readiness.js'
import { serviceHttp } from './service-http.js'

const HTTP_OK = 200
const HTTP_NO_CONTENT = 204
const HTTP_NOT_FOUND = 404
const MS_PER_SECOND = 1000
const JSON_HEADERS = { 'Content-Type': 'application/json' }
const FIRST_VERSION = SCHEMA_VERSIONS[0]
const isServiceBusHost = (fault) => fault.host === FAULT_HOSTS.TOXIPROXY
const SERVICE_BUS_FAULTS = FAULT_CATALOGUE.filter(isServiceBusHost)

const stubRequests = new Counter('stub_requests')
const stubFaultsInjected = new Counter('stub_faults_injected')
const faultInjectionApplied = new Gauge('fault_injection_applied')
const resilienceDeadLetters = new Gauge('resilience_dead_letters')
const serviceBusForwardedInPhase = new Gauge('service_bus_forwarded_in_phase')
const backlogDrainedSeconds = new Gauge('resilience_backlog_drained_seconds')
const backlogUnread = new Gauge('resilience_backlog_unread')

const faultBody = ({ fault, model }) =>
  (isServiceBusHost(fault) ? toxicBody : stubFaultBody)({
    kind: fault.kind,
    model
  })

const stubUrls = (urls) => ({
  [FAULT_HOSTS.TRADE_IMPORTS_STUB]: urls.tradeImportsStub,
  [FAULT_HOSTS.DEFRA_ID_STUB]: urls.defraIdStub
})

const attempt = (call, fallback) => {
  try {
    return call()
  } catch {
    return fallback
  }
}

const probeStub = (url) => {
  const status = attempt(
    () => serviceHttp.get(`${url}/faults`, { tags: READINESS_TAGS }).status,
    0
  )

  if (status === HTTP_OK) {
    return { injectable: true, code: INJECTION_CODES.APPLIED }
  }

  return {
    injectable: false,
    code:
      status === HTTP_NOT_FOUND
        ? INJECTION_CODES.STUB_PREDATES_FAULTS
        : INJECTION_CODES.HOST_UNREACHABLE
  }
}

const probeToxiproxy = (toxiproxyUrl) => {
  const status =
    toxiproxyUrl === null
      ? 0
      : attempt(
          () =>
            http.get(`${toxiproxyUrl}/proxies/${SERVICE_BUS_PROXY}`, {
              tags: READINESS_TAGS
            }).status,
          0
        )

  return status === HTTP_OK
    ? { injectable: true, code: INJECTION_CODES.APPLIED }
    : { injectable: false, code: INJECTION_CODES.NO_SERVICE_BUS_PROXY }
}

/**
 * Switches off every fault, on both stubs and every resilience toxic on the
 * Service Bus proxy, so nothing is left behind. Every request carries the
 * readiness tags, so no threshold measures it. A host that cannot be reached, or
 * that predates faults, has nothing to clear.
 *
 * @param {object} options - Clear settings.
 * @param {Record<string, string>} options.urls - `tradeImportsStub` and `defraIdStub` base URLs.
 * @param {string | null} options.toxiproxyUrl - The toxiproxy base URL, or null when there is none.
 */
export const clearEveryFault = ({ urls, toxiproxyUrl }) => {
  const cleared = Object.entries(stubUrls(urls))
    .filter(([, url]) =>
      attempt(
        () =>
          serviceHttp.del(`${url}/faults`, null, { tags: READINESS_TAGS })
            .status === HTTP_NO_CONTENT,
        false
      )
    )
    .map(([host]) => host)

  if (toxiproxyUrl !== null) {
    const results = SERVICE_BUS_FAULTS.map(({ kind }) => ({
      toxic: toxicName(kind),
      status: attempt(
        () =>
          http.del(
            `${toxiproxyUrl}/proxies/${SERVICE_BUS_PROXY}/toxics/${toxicName(kind)}`,
            null,
            { tags: READINESS_TAGS }
          ).status,
        null
      )
    }))

    if (toxicsCleared(results.map(({ status }) => status))) {
      cleared.push(FAULT_HOSTS.TOXIPROXY)
    } else {
      const failed = results
        .filter(({ status }) => !toxicsCleared([status]))
        .map(({ toxic, status }) => `${toxic} (${status ?? 'unreachable'})`)

      console.error(`toxiproxy could not be cleared: ${failed.join(', ')}`)
    }
  }

  console.log(
    `Faults cleared: ${cleared.length === 0 ? 'no fault host could be reached' : cleared.join(', ')}`
  )
}

/**
 * Clears every fault, then asks each fault host whether it can inject: each
 * stub answers `GET /faults`, and the Service Bus proxy answers toxiproxy. Logs
 * what each answered. A host that cannot inject does not stop the run; its
 * faults are reported as not injected and nothing is judged for them.
 *
 * @param {object} options - Probe settings.
 * @param {Record<string, string>} options.urls - `tradeImportsStub` and `defraIdStub` base URLs.
 * @param {string | null} options.toxiproxyUrl - The toxiproxy base URL, or null when there is none.
 * @param {string} options.environment - The environment the run is in.
 * @returns {Record<string, { injectable: boolean, code: number }>} Each fault host's answer, by host name.
 */
export const prepareFaults = ({ urls, toxiproxyUrl, environment }) => {
  clearEveryFault({ urls, toxiproxyUrl })

  const hosts = {
    ...Object.fromEntries(
      Object.entries(stubUrls(urls)).map(([host, url]) => [
        host,
        probeStub(url)
      ])
    ),
    [FAULT_HOSTS.TOXIPROXY]: probeToxiproxy(toxiproxyUrl)
  }

  Object.entries(hosts).forEach(([host, { injectable, code }]) => {
    console.log(
      injectable
        ? `Fault injection: ${host}: injectable`
        : `Fault injection: ${host}: not injectable (${notInjectedReason(code, environment)})`
    )
  })

  return hosts
}

const readCounters = ({ urls, hosts }) => {
  const readings = Object.fromEntries(
    STUB_HOSTED_INTEGRATIONS.map((integration) => [integration, null])
  )

  Object.entries(stubUrls(urls))
    .filter(([host]) => hosts[host]?.injectable)
    .forEach(([, url]) => {
      const report = attempt(() => {
        const response = serviceHttp.get(`${url}/faults`, {
          tags: READINESS_TAGS
        })

        return response.status === HTTP_OK ? response.json() : null
      }, null)

      report?.integrations?.forEach((entry) => {
        readings[entry.integration] = {
          requests: entry.requests,
          injected: Object.values(entry.injected).reduce(
            (total, count) => total + count,
            0
          )
        }
      })
    })

  return readings
}

let controlState = INITIAL_CONTROL_STATE
let lastReading = null
const faultStates = new Map()

const recordCounters = ({ reading, phase }) => {
  if (lastReading === null || phase === null) {
    return
  }

  STUB_HOSTED_INTEGRATIONS.forEach((integration) => {
    const requests = counterDelta({
      before: lastReading[integration]?.requests,
      after: reading[integration]?.requests
    })
    const injected = counterDelta({
      before: lastReading[integration]?.injected,
      after: reading[integration]?.injected
    })

    if (requests !== null) {
      stubRequests.add(requests, { integration, phase })
    }

    if (injected !== null) {
      stubFaultsInjected.add(injected, { integration, phase })
    }
  })
}

const putStubFault = ({ url, fault, model }) =>
  serviceHttp.put(
    `${url}/faults/${fault.integration}`,
    JSON.stringify(faultBody({ fault, model })),
    { headers: JSON_HEADERS, tags: READINESS_TAGS }
  ).status === HTTP_OK

const postToxic = ({ toxiproxyUrl, fault, model }) =>
  http.post(
    `${toxiproxyUrl}/proxies/${SERVICE_BUS_PROXY}/toxics`,
    JSON.stringify(faultBody({ fault, model })),
    { headers: JSON_HEADERS, tags: READINESS_TAGS }
  ).status === HTTP_OK

const switchOn = ({ fault, urls, toxiproxyUrl, model }) =>
  attempt(
    () =>
      isServiceBusHost(fault)
        ? postToxic({ toxiproxyUrl, fault, model })
        : putStubFault({ url: stubUrls(urls)[fault.host], fault, model }),
    false
  )

const applyFault = ({
  fault,
  urls,
  toxiproxyUrl,
  model,
  hosts,
  environment
}) => {
  const host = hosts[fault.host]
  const tags = { fault: fault.id }
  const notInjected = (code) => {
    faultInjectionApplied.add(code, tags)
    console.log(notInjectedLine(fault, notInjectedReason(code, environment)))
  }

  if (!host?.injectable) {
    notInjected(host?.code ?? INJECTION_CODES.HOST_UNREACHABLE)

    return
  }

  if (!switchOn({ fault, urls, toxiproxyUrl, model })) {
    notInjected(INJECTION_CODES.APPLY_REFUSED)

    return
  }

  faultInjectionApplied.add(INJECTION_CODES.APPLIED, tags)
  console.log(
    `Fault on: ${fault.id} (${JSON.stringify(faultBody({ fault, model }))})`
  )

  const backlogAtApply = isServiceBusHost(fault)
    ? readBacklogDepth({ urls })
    : null

  if (isServiceBusHost(fault) && backlogAtApply === null) {
    backlogUnread.add(1, tags)
  }

  faultStates.set(fault.id, {
    deadLettersAtApply: readDeadLetterCount({ urls }),
    backlogAtApply,
    forwardedAtApply: isServiceBusHost(fault)
      ? readForwardedCounts({ urls })[FIRST_VERSION]
      : null,
    clearedAt: null,
    drained: false
  })
}

const switchOff = ({ fault, urls, toxiproxyUrl }) => {
  attempt(
    () =>
      isServiceBusHost(fault)
        ? http.del(
            `${toxiproxyUrl}/proxies/${SERVICE_BUS_PROXY}/toxics/${toxicName(fault.kind)}`,
            null,
            { tags: READINESS_TAGS }
          )
        : serviceHttp.del(
            `${stubUrls(urls)[fault.host]}/faults/${fault.integration}`,
            null,
            { tags: READINESS_TAGS }
          ),
    null
  )
}

const clearFault = ({ fault, urls, toxiproxyUrl }) => {
  const state = faultStates.get(fault.id)

  if (state === undefined) {
    return
  }

  switchOff({ fault, urls, toxiproxyUrl })
  state.clearedAt = Date.now()
  console.log(`Fault off: ${fault.id}`)

  const forwarded = counterDelta({
    before: state.forwardedAtApply,
    after: isServiceBusHost(fault)
      ? readForwardedCounts({ urls })[FIRST_VERSION]
      : null
  })

  if (forwarded !== null) {
    serviceBusForwardedInPhase.add(forwarded, { fault: fault.id })
  }
}

const recordDeadLetters = ({ fault, urls }) => {
  const state = faultStates.get(fault.id)

  if (!isServiceBusHost(fault) && state?.clearedAt !== null) {
    return
  }

  const growth =
    state === undefined
      ? null
      : counterDelta({
          before: state.deadLettersAtApply,
          after: readDeadLetterCount({ urls })
        })

  if (growth !== null) {
    resilienceDeadLetters.add(growth, { fault: fault.id })
  }
}

const watchBacklog = ({ fault, urls }) => {
  const state = faultStates.get(fault.id)

  if (state === undefined || state.drained || state.clearedAt === null) {
    return
  }

  const depth = readBacklogDepth({ urls })

  if (
    depth !== null &&
    state.backlogAtApply !== null &&
    depth <= state.backlogAtApply
  ) {
    state.drained = true
    backlogDrainedSeconds.add(
      Math.round((Date.now() - state.clearedAt) / MS_PER_SECOND),
      { fault: fault.id }
    )
  }
}

const faultFor = (faults, id) => faults.find((fault) => fault.id === id)

/**
 * Takes one second's step of the fault controller: finds the phase, and on a
 * change records what each stub counted for the phase that ended, switches off
 * the fault whose window ended and switches on the one whose window began. In a
 * fault window or after it, it counts the dead letters the gateway gained, and
 * in a Service Bus cleared step it watches the backlog drain. One virtual user
 * runs this, so the module's state has one owner.
 *
 * @param {object} options - The tick.
 * @param {Record<string, string>} options.urls - `tradeImportsStub`, `defraIdStub` and `gateway` base URLs.
 * @param {string | null} options.toxiproxyUrl - The toxiproxy base URL, or null when there is none.
 * @param {ReadonlyArray<object>} options.schedule - The resilience run's phase schedule.
 * @param {ReadonlyArray<object>} options.faults - The faults the run injects.
 * @param {object} options.model - A resolved traffic model.
 * @param {Record<string, { injectable: boolean, code: number }>} options.hosts - What `prepareFaults` found.
 * @param {string} options.environment - The environment the run is in.
 */
export const controlFaults = ({
  urls,
  toxiproxyUrl,
  schedule,
  faults,
  model,
  hosts,
  environment
}) => {
  const elapsedSeconds = (Date.now() - exec.scenario.startTime) / MS_PER_SECOND
  const phase = phaseAt(schedule, elapsedSeconds)
  const next = nextControlActions({ state: controlState, phase })

  controlState = next.state

  next.actions.forEach((action) => {
    if (action.type === 'record') {
      const reading = readCounters({ urls, hosts })

      recordCounters({ reading, phase: action.phase })
      lastReading = reading

      return
    }

    const fault = faultFor(faults, action.fault)

    if (action.type === 'clear') {
      clearFault({ fault, urls, toxiproxyUrl })
    } else if (action.type === 'apply') {
      applyFault({ fault, urls, toxiproxyUrl, model, hosts, environment })
    } else if (action.type === 'watch-backlog') {
      watchBacklog({ fault, urls })
    }
  })

  const current = faultOfPhase(phase)

  if (current !== null) {
    recordDeadLetters({ fault: faultFor(faults, current.id), urls })
  }
}
