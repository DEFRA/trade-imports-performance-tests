const CDP_DOMAIN = 'cdp-int.defra.cloud'
const LOCAL_ENVIRONMENT = 'local'
const PROD_ENVIRONMENT = 'prod'
const DEFAULT_LOCALHOST = 'localhost'
const GATEWAY_HOST_PREFIX = 'ephemeral-protected.api'
const API_KEY_HEADER = 'x-api-key'
const CDP_LOCAL_ON = 'true'

// The workspace stack's toxiproxy API, published to the host by docker/stack/infrastructure.compose.yml.
const LOCAL_TOXIPROXY_PORT = 8474

const GATEWAY_SERVICES = Object.freeze([
  'trade-imports-animals-backend',
  'trade-imports-plants-backend',
  'trade-imports-ins-backend',
  'trade-imports-reference-data',
  'trade-imports-stub',
  'trade-imports-dynamics-gateway',
  'trade-imports-address-book'
])

const LOCAL_PORTS = Object.freeze({
  'trade-imports-animals-frontend': 3000,
  'trade-imports-animals-admin': 3001,
  'trade-imports-ins-frontend': 3002,
  'trade-imports-plants-frontend': 3003,
  'trade-imports-defra-id-stub': 3007,
  'trade-imports-animals-backend': 8085,
  'trade-imports-reference-data': 8086,
  'trade-imports-stub': 8087,
  'trade-imports-dynamics-gateway': 8088,
  'trade-imports-address-book': 8089,
  'trade-imports-ins-backend': 8090,
  'trade-imports-plants-backend': 8091
})

/**
 * Reads the name of the environment the suite runs against.
 *
 * The CDP Portal sets ENVIRONMENT to the environment it runs the suite in,
 * for example `perf-test`. Local Compose runs set it to `local`.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @returns {string} The environment name.
 * @throws {Error} When ENVIRONMENT is blank, or names production.
 */
export function resolveEnvironment(env) {
  const environment = env.ENVIRONMENT?.trim()

  if (!environment) {
    throw new Error(
      'ENVIRONMENT is not set. Set it to a CDP environment name, or to "local".'
    )
  }

  if (environment.toLowerCase() === PROD_ENVIRONMENT) {
    throw new Error(
      'Refusing to run against prod. Set ENVIRONMENT to a non-production environment.'
    )
  }

  return environment
}

/**
 * Reads the host a container uses to reach the machine's `localhost`.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @returns {string} `LOCALHOST_ALIAS` when set, otherwise `localhost`.
 */
export function resolveLocalhostAlias(env) {
  return env.LOCALHOST_ALIAS?.trim() || DEFAULT_LOCALHOST
}

/**
 * Works out the base URL of the toxiproxy that stands in front of the Service
 * Bus emulator, where a resilience run injects its Service Bus faults.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @param {string} environment - The environment the run is in.
 * @returns {string | null} `TOXIPROXY_URL` without a trailing slash when set; in `local` the workspace stack's toxiproxy on the localhost alias; otherwise null, for there is none to reach.
 */
export function resolveToxiproxyUrl(env, environment) {
  const override = env.TOXIPROXY_URL?.trim().replace(/\/+$/, '')

  if (override) {
    return override
  }

  return environment === LOCAL_ENVIRONMENT
    ? `http://${resolveLocalhostAlias(env)}:${LOCAL_TOXIPROXY_PORT}`
    : null
}

/**
 * Names the environment variable that overrides a service's base URL.
 *
 * @param {string} serviceName - The CDP service name, for example `trade-imports-ins-frontend`.
 * @returns {string} For example `TRADE_IMPORTS_INS_FRONTEND_URL`.
 */
export function serviceUrlVariable(serviceName) {
  return `${serviceName.toUpperCase().replaceAll('-', '_')}_URL`
}

/**
 * Says whether the run is on a laptop reaching CDP through its protected gateway.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @returns {boolean} True only when CDP_LOCAL is exactly `true`.
 */
export function isCdpLocal(env) {
  return env.CDP_LOCAL?.trim() === CDP_LOCAL_ON
}

/**
 * Builds the base address of CDP's protected gateway in an environment.
 *
 * @param {string} environment - The CDP environment name, for example `dev`.
 * @returns {string} For example `https://ephemeral-protected.api.dev.cdp-int.defra.cloud`.
 */
export function gatewayBaseUrl(environment) {
  return `https://${GATEWAY_HOST_PREFIX}.${environment}.${CDP_DOMAIN}`
}

/**
 * Reads the developer API key the protected gateway needs.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @returns {string} The key. Never log or print it.
 * @throws {Error} When DEVELOPER_API_KEY is blank.
 */
export function resolveDeveloperApiKey(env) {
  const key = env.DEVELOPER_API_KEY?.trim()

  if (!key) {
    throw new Error(
      "DEVELOPER_API_KEY is not set. Set it in .env: CDP_LOCAL=true sends backend calls through CDP's protected gateway, which needs it."
    )
  }

  return key
}

const usesGateway = (env, environment, serviceName) =>
  environment !== LOCAL_ENVIRONMENT &&
  isCdpLocal(env) &&
  GATEWAY_SERVICES.includes(serviceName)

/**
 * Works out the base URL of a service under test.
 *
 * An override in `<SERVICE_NAME>_URL` wins. Without one, the URL is the
 * service's CDP address in the current environment. With CDP_LOCAL=true, a
 * backend service goes through CDP's protected gateway instead, which needs
 * DEVELOPER_API_KEY. Frontends and the Defra ID stub keep their direct address.
 * Local runs default to the workspace Docker stack's host port for the
 * service, on `localhost` or on `LOCALHOST_ALIAS` when that is set.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @param {string} serviceName - The CDP service name, for example `trade-imports-ins-frontend`.
 * @returns {string} The base URL, without a trailing slash.
 * @throws {Error} When the gateway is needed and DEVELOPER_API_KEY is blank.
 */
export function resolveServiceUrl(env, serviceName) {
  const environment = resolveEnvironment(env)
  const variable = serviceUrlVariable(serviceName)
  const override = env[variable]?.trim()

  if (override) {
    return override.replace(/\/+$/, '')
  }

  if (environment === LOCAL_ENVIRONMENT) {
    const port = LOCAL_PORTS[serviceName]

    if (!port) {
      throw new Error(
        `${variable} must be set when ENVIRONMENT is local and ${serviceName} has no local port.`
      )
    }

    return `http://${resolveLocalhostAlias(env)}:${port}`
  }

  if (usesGateway(env, environment, serviceName)) {
    resolveDeveloperApiKey(env)
    return `${gatewayBaseUrl(environment)}/${serviceName}`
  }

  return `https://${serviceName}.${environment}.${CDP_DOMAIN}`
}

/**
 * Gives the headers a call to a URL needs to pass CDP's protected gateway.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @param {string} url - The full URL being called.
 * @returns {Record<string, string>} The `x-api-key` header for a gateway URL, otherwise nothing.
 * @throws {Error} When the URL is under the gateway and DEVELOPER_API_KEY is blank.
 */
export function gatewayHeaders(env, url) {
  const environment = resolveEnvironment(env)

  if (
    environment === LOCAL_ENVIRONMENT ||
    !isCdpLocal(env) ||
    !url.startsWith(`${gatewayBaseUrl(environment)}/`)
  ) {
    return {}
  }

  return { [API_KEY_HEADER]: resolveDeveloperApiKey(env) }
}

/**
 * Describes where backend calls go, for the run's log. Never includes the key.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @returns {string} One line naming the route.
 */
export function backendRouteLine(env) {
  const environment = resolveEnvironment(env)

  if (environment === LOCAL_ENVIRONMENT) {
    return "Backend calls: the workspace Docker stack's ports"
  }

  if (isCdpLocal(env)) {
    return `Backend calls: through CDP's protected gateway ${gatewayBaseUrl(environment)}/<service> with the developer API key (CDP_LOCAL=true)`
  }

  return `Backend calls: direct to https://<service>.${environment}.${CDP_DOMAIN}`
}
