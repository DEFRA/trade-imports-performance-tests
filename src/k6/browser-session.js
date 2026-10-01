import http from 'k6/http'

import { kindOf } from '../config/endpoints.js'
import { MAX_REDIRECT_HOPS } from '../config/smoke.js'
import { encodeForm, formFields } from '../lib/forms.js'
import {
  absoluteLocation,
  endpointForHop,
  isIdentitySignInPage,
  isStaleActionRedirect,
  originOf
} from '../lib/redirects.js'

const FORM_ENCODED = 'application/x-www-form-urlencoded'
const HTTP_OK = 200
const HTTP_REDIRECT_MIN = 300
const HTTP_REDIRECT_MAX = 399

const isRedirect = (status) =>
  status >= HTTP_REDIRECT_MIN && status <= HTTP_REDIRECT_MAX

const hiddenFieldsOf = (form) =>
  Object.fromEntries(
    form
      .find('input[type="hidden"]')
      .toArray()
      .map((input) => [input.attr('name'), input.attr('value') ?? ''])
      .filter(([name]) => name)
  )

const hiddenFieldsOfPage = (html) => {
  const postForms = html
    .find('form')
    .toArray()
    .filter((form) => form.attr('method')?.toLowerCase() === 'post')
  const withToken = postForms.filter(
    (form) => form.find('input[name="concurrencyToken"]').size() > 0
  )
  const chosen = withToken.at(-1) ?? postForms[0]

  return chosen ? hiddenFieldsOf(chosen) : {}
}

const toPage = (response, url, outcome) => {
  const html = response.status === HTTP_OK ? response.html() : undefined

  return {
    status: response.status,
    url,
    html,
    crumb: html?.find('meta[name="csrf-token"]').attr('content') ?? '',
    heading: html?.find('h1').first().text().trim() ?? '',
    hiddenFields: html ? hiddenFieldsOfPage(html) : {},
    ...outcome
  }
}

/**
 * Creates one virtual user's browser-like session against a single frontend.
 *
 * It keeps its own cookie jar, follows redirects itself so every hop is tagged
 * with an endpoint, signs in when the Defra ID stub's sign-in page appears, and
 * counts a stale-concurrency redirect as a handled outcome.
 *
 * @param {object} options - Session settings.
 * @param {string} options.baseUrl - The frontend's base URL.
 * @param {string} options.localhostAlias - The host that stands in for `localhost` in redirects.
 * @param {{ crn: string, password: string }} options.credentials - The stub identity to sign in with.
 * @param {{ add: (value: number) => void }} options.staleRedirects - Counts handled stale-concurrency redirects.
 * @param {Record<string, string>} [options.extraTags] - Tags added to every request, overriding the defaults.
 * @returns {{ open: Function, post: Function, submitForm: Function, signedInThroughIdentityProvider: () => boolean }} The session.
 */
export const createBrowserSession = ({
  baseUrl,
  localhostAlias,
  credentials,
  staleRedirects,
  extraTags = {}
}) => {
  const jar = new http.CookieJar()
  let signedIn = false

  const paramsFor = (endpoint, headers = {}) => ({
    jar,
    redirects: 0,
    headers,
    tags: { endpoint, kind: kindOf(endpoint), name: endpoint, ...extraTags }
  })

  const postForm = (url, fields, endpoint) =>
    http.post(
      url,
      encodeForm(fields),
      paramsFor(endpoint, { 'content-type': FORM_ENCODED })
    )

  const follow = (first, firstUrl, endpoint) => {
    let response = first
    let url = firstUrl
    let hops = 0
    let staleActionHandled = false

    while (isRedirect(response.status) && hops < MAX_REDIRECT_HOPS) {
      const location = response.headers.Location

      if (isStaleActionRedirect(location)) {
        staleRedirects.add(1)
        staleActionHandled = true
      }

      url = absoluteLocation(url, location, localhostAlias)
      response = http.get(url, paramsFor(endpointForHop(url, endpoint)))
      hops += 1

      if (response.status === HTTP_OK && isIdentitySignInPage(url)) {
        response = postForm(url, credentials, 'sign-in')
        signedIn = true
      }
    }

    return toPage(response, url, {
      staleActionHandled,
      tooManyRedirects: isRedirect(response.status)
    })
  }

  const open = (path, endpoint) => {
    const url = `${baseUrl}${path}`

    return follow(http.get(url, paramsFor(endpoint)), url, endpoint)
  }

  const post = (path, fields, endpoint) => {
    const url = `${baseUrl}${path}`

    return follow(postForm(url, fields, endpoint), url, endpoint)
  }

  const submitForm = (page, answers, endpoint) =>
    post(
      page.url.slice(originOf(page.url).length),
      formFields(page.hiddenFields, answers),
      endpoint
    )

  return {
    open,
    post,
    submitForm,
    signedInThroughIdentityProvider: () => signedIn
  }
}
