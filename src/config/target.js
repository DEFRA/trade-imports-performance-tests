const CDP_DOMAIN = 'cdp-int.defra.cloud'
const LOCAL_ENVIRONMENT = 'local'

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
 * service's CDP address in the current environment. Local runs have no CDP
 * address, so they must set the override.
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
    throw new Error(`${variable} must be set when ENVIRONMENT is local.`)
  }

  return `https://${serviceName}.${environment}.${CDP_DOMAIN}`
}
