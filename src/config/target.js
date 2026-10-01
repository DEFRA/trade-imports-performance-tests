const CDP_DOMAIN = 'cdp-int.defra.cloud'
const LOCAL_ENVIRONMENT = 'local'
const DEFAULT_LOCALHOST = 'localhost'

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
 */
export function resolveEnvironment(env) {
  const environment = env.ENVIRONMENT?.trim()

  if (!environment) {
    throw new Error(
      'ENVIRONMENT is not set. Set it to a CDP environment name, or to "local".'
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
 * Names the environment variable that overrides a service's base URL.
 *
 * @param {string} serviceName - The CDP service name, for example `trade-imports-ins-frontend`.
 * @returns {string} For example `TRADE_IMPORTS_INS_FRONTEND_URL`.
 */
export function serviceUrlVariable(serviceName) {
  return `${serviceName.toUpperCase().replaceAll('-', '_')}_URL`
}

/**
 * Works out the base URL of a service under test.
 *
 * An override in `<SERVICE_NAME>_URL` wins. Without one, the URL is the
 * service's CDP address in the current environment. Local runs default to the
 * workspace Docker stack's host port for the service, on `localhost` or on
 * `LOCALHOST_ALIAS` when that is set.
 *
 * @param {Record<string, string | undefined>} env - k6's `__ENV`, or any map of environment variables.
 * @param {string} serviceName - The CDP service name, for example `trade-imports-ins-frontend`.
 * @returns {string} The base URL, without a trailing slash.
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

  return `https://${serviceName}.${environment}.${CDP_DOMAIN}`
}
