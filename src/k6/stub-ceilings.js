import http from 'k6/http'
import { check } from 'k6'
import { Gauge } from 'k6/metrics'

import { DEFRA_ID_PATHS, HEADROOM_MEASURES } from '../config/stub-ceilings.js'
import {
  codeFromLocation,
  distortionLine,
  headroomLine,
  headroomVerdict,
  absoluteLocationOrNull,
  loadOf,
  sharedStubDistortions,
  signInCompleted,
  trustLine
} from '../lib/stub-ceilings.js'
import { effectiveProfile } from '../lib/stub-profiles.js'
import { encodeForm } from '../lib/forms.js'

const HTTP_OK = 200
const HTTP_REDIRECT = 302
const FORM_ENCODED = 'application/x-www-form-urlencoded'
const MDM_KEY_HEADER = 'Ocp-Apim-Subscription-Key'
const MDM_KEY = 'perf-test'
const TOKEN_CLIENT_SECRET = 'perf-test'
const OIDC_SCOPE = 'openid offline_access'
const RANDOM_RADIX = 36

const stubLoadGauge = new Gauge('stub_load')
const stubCeilingGauge = new Gauge('stub_ceiling')
const stubHeadroomGauge = new Gauge('stub_headroom')
const runTrustedGauge = new Gauge('run_trusted')

const loadsOf = ({ entries, since, now }) =>
  Object.fromEntries(
    entries.map((entry) => [entry.integration, loadOf(entry, since, now)])
  )

const ceilingsOf = ({ entries, ceilings }) =>
  Object.fromEntries(
    entries.map((entry) => [
      entry.integration,
      ceilings[entry.integration]?.[effectiveProfile(entry)]
    ])
  )

const recordLoad = (entry, load) => {
  if (load.peakPerSecond === null) {
    return
  }

  const values = {
    'peak-per-second': load.peakPerSecond,
    'mean-per-second': load.meanPerSecond
  }

  for (const measure of HEADROOM_MEASURES) {
    stubLoadGauge.add(values[measure], {
      integration: entry.integration,
      measure
    })
  }
}

const recordEntry = ({ entry, load, ceiling, result }) => {
  const tags = { integration: entry.integration }

  recordLoad(entry, load)

  if (ceiling !== undefined) {
    stubCeilingGauge.add(ceiling.rps, tags)
  }

  if (result.judged) {
    stubHeadroomGauge.add(result.verdict === 'headroom' ? 1 : 0, tags)
  }
}

/**
 * Reports, for each stub a run went through, the load it carried against its
 * measured ceiling and whether it had headroom, then whether the run can be
 * trusted. The verdict is reported and never fails the run.
 *
 * @param {object} options - The run.
 * @param {object[]} options.entries - One entry per stubbed integration, read at the end of the run.
 * @param {Record<string, Record<string, object>>} options.ceilings - Recorded ceilings by integration, then profile.
 * @param {string} options.environment - The environment the run is in.
 * @param {number} options.since - When the stubs were cleared, in epoch milliseconds.
 * @param {number} options.now - When the entries were read, in epoch milliseconds.
 */
export const reportStubHeadroom = ({
  entries,
  ceilings,
  environment,
  since,
  now
}) => {
  const loads = loadsOf({ entries, since, now })
  const ceilingByIntegration = ceilingsOf({ entries, ceilings })
  const judgements = entries.map((entry) => {
    const load = loads[entry.integration]
    const ceiling = ceilingByIntegration[entry.integration]
    const result = headroomVerdict({ entry, ceiling, load })

    return { entry, load, ceiling, result }
  })
  const distortions = sharedStubDistortions({
    entries,
    ceilings: ceilingByIntegration,
    loads
  })

  for (const { entry, load, ceiling, result } of judgements) {
    console.log(headroomLine({ entry, ceiling, load, environment, result }))
    recordEntry({ entry, load, ceiling, result })
  }

  for (const distortion of distortions) {
    console.log(distortionLine(distortion))
  }

  const verdicts = judgements.map(({ entry, result }) => ({
    integration: entry.integration,
    ...result
  }))

  console.log(trustLine(verdicts, distortions))
  runTrustedGauge.add(
    verdicts.every(
      ({ judged, verdict }) => !judged || verdict === 'headroom'
    ) && distortions.length === 0
      ? 1
      : 0
  )
}

/**
 * Asks the Trade token stub for one token.
 *
 * @param {object} options - Call settings.
 * @param {Record<string, string>} options.urls - `tradeImportsStub` base URL.
 * @param {string} options.timeout - The request timeout, such as `10s`.
 */
export const tradeTokenCall = ({ urls, timeout }) => {
  const response = http.post(
    `${urls.tradeImportsStub}/tenant/oauth2/v2.0/token`,
    { grant_type: 'client_credentials' },
    {
      timeout,
      tags: {
        endpoint: 'stub-trade-token',
        name: 'stub-trade-token',
        profiled: 'yes'
      }
    }
  )

  check(response, {
    'trade token answered': (answer) =>
      answer.status === HTTP_OK && String(answer.body).includes('stub-token')
  })
}

/**
 * Asks the MDM stub for reference data, countries on even iterations and
 * border control posts on odd ones, as reference-data does for both.
 *
 * @param {object} options - Call settings.
 * @param {Record<string, string>} options.urls - `tradeImportsStub` base URL.
 * @param {string} options.timeout - The request timeout, such as `10s`.
 * @param {number} options.iteration - The iteration's number across the whole test.
 */
export const mdmCall = ({ urls, timeout, iteration }) => {
  const isCountries = iteration % 2 === 0
  const endpoint = isCountries ? 'stub-mdm-countries' : 'stub-mdm-ports'
  const path = isCountries ? '/mdm/geo/countries' : '/mdm/trade/bcp/poes'
  const response = http.get(`${urls.tradeImportsStub}${path}`, {
    timeout,
    headers: { [MDM_KEY_HEADER]: MDM_KEY },
    tags: { endpoint, name: endpoint, profiled: 'yes' }
  })

  check(response, { 'MDM answered': (answer) => answer.status === HTTP_OK })
}

const randomToken = () =>
  `${Date.now().toString(RANDOM_RADIX)}${Math.random().toString(RANDOM_RADIX).slice(2)}`

const requestParams = ({ jar, timeout, endpoint, profiled, headers = {} }) => ({
  jar,
  timeout,
  redirects: 0,
  headers,
  tags: { endpoint, name: endpoint, profiled }
})

const authorizeQuery = (client) =>
  encodeForm({
    serviceId: client.serviceId,
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    scope: OIDC_SCOPE,
    response_type: 'code',
    state: randomToken(),
    nonce: randomToken()
  })

const firstOrganisation = (response) =>
  response.html().find('input[name="sbi"]').first().attr('value')

const FAILED_SIGN_IN = Object.freeze({ code: '', statusesAsExpected: false })

const reachCode = ({ urls, client, credentials, jar, timeout }) => {
  const get = (url, endpoint, profiled = 'no') =>
    http.get(url, requestParams({ jar, timeout, endpoint, profiled }))
  const post = (url, fields, endpoint) =>
    http.post(
      url,
      encodeForm(fields),
      requestParams({
        jar,
        timeout,
        endpoint,
        profiled: 'no',
        headers: { 'content-type': FORM_ENCODED }
      })
    )
  const base = urls.defraIdStub
  const wellKnown = get(
    `${base}${DEFRA_ID_PATHS.wellKnown}`,
    'stub-defra-id-well-known',
    'yes'
  )
  const authorize = get(
    `${base}${DEFRA_ID_PATHS.authorize}?${authorizeQuery(client)}`,
    'stub-defra-id-authorize'
  )
  const signInUrl = absoluteLocationOrNull(base, authorize.headers.Location)

  if (signInUrl === null) {
    return FAILED_SIGN_IN
  }

  const signInPage = get(signInUrl, 'stub-defra-id-sign-in-page')
  const signIn = post(signInUrl, credentials, 'stub-defra-id-sign-in')
  const organisationsUrl = absoluteLocationOrNull(
    signInUrl,
    signIn.headers.Location
  )

  if (organisationsUrl === null) {
    return FAILED_SIGN_IN
  }

  const organisations = get(organisationsUrl, 'stub-defra-id-organisations')
  const choice =
    organisations.status === HTTP_OK
      ? post(
          `${base}/organisations`,
          { sbi: firstOrganisation(organisations) },
          'stub-defra-id-organisation-choice'
        )
      : organisations
  const statuses = [
    [wellKnown, HTTP_OK],
    [authorize, HTTP_REDIRECT],
    [signInPage, HTTP_OK],
    [signIn, HTTP_REDIRECT],
    [choice, HTTP_REDIRECT]
  ]

  return {
    code: codeFromLocation(choice.headers.Location),
    statusesAsExpected: statuses.every(
      ([response, expected]) => response.status === expected
    )
  }
}

/**
 * Signs in through the Defra ID stub as a frontend does: discovery, authorize,
 * credentials, organisation, token exchange and keys. With `signOut` the
 * session is ended afterwards, so the stub's session store stays at its
 * steady-state size.
 *
 * @param {object} options - Sign-in settings.
 * @param {Record<string, string>} options.urls - `defraIdStub` base URL.
 * @param {{ clientId: string, serviceId: string, redirectUri: string }} options.client - The client to sign in as.
 * @param {{ crn: string, password: string }} options.credentials - The stub identity to sign in with.
 * @param {string} options.timeout - The request timeout, such as `10s`.
 * @param {boolean} options.signOut - Whether to end the session afterwards.
 */
export const defraIdSignIn = ({
  urls,
  client,
  credentials,
  timeout,
  signOut
}) => {
  const jar = new http.CookieJar()
  const { code, statusesAsExpected } = reachCode({
    urls,
    client,
    credentials,
    jar,
    timeout
  })
  const exchange = http.post(
    `${urls.defraIdStub}${DEFRA_ID_PATHS.token}`,
    encodeForm({
      grant_type: 'authorization_code',
      code,
      redirect_uri: client.redirectUri,
      client_id: client.clientId,
      client_secret: TOKEN_CLIENT_SECRET
    }),
    requestParams({
      jar,
      timeout,
      endpoint: 'stub-defra-id-token',
      profiled: 'yes',
      headers: { 'content-type': FORM_ENCODED }
    })
  )
  const keys = http.get(
    `${urls.defraIdStub}${DEFRA_ID_PATHS.keys}`,
    requestParams({
      jar,
      timeout,
      endpoint: 'stub-defra-id-keys',
      profiled: 'yes'
    })
  )
  const accessToken =
    exchange.status === HTTP_OK ? (exchange.json().access_token ?? '') : ''

  const signedOut =
    signOut && accessToken
      ? http.get(
          `${urls.defraIdStub}${DEFRA_ID_PATHS.signOut}?${encodeForm({
            id_token_hint: accessToken,
            post_logout_redirect_uri: client.redirectUri
          })}`,
          requestParams({
            jar,
            timeout,
            endpoint: 'stub-defra-id-sign-out',
            profiled: 'no'
          })
        )
      : null

  check(keys, {
    'Defra ID sign-in completed': (answer) =>
      signInCompleted({
        statusesAsExpected,
        keysStatus: answer.status,
        accessToken,
        signOut,
        signOutStatus: signedOut === null ? null : signedOut.status
      })
  })
}
