import http from 'k6/http'

import { kindOf } from '../config/endpoints.js'
import { RE_AUTHENTICATION_TAG } from '../config/request-mix.js'
import { MAX_REDIRECT_HOPS } from '../config/smoke.js'
import { encodeForm, formFields, prefilledFields } from '../lib/forms.js'
import {
  absoluteLocation,
  endpointForHop,
  isIdentitySignInPage,
  isStaleActionRedirect,
  originOf
} from '../lib/redirects.js'
import { markPhase } from './phase.js'
import { recordServerError, recordTransportError } from './server-errors.js'

const SIGN_IN_ENDPOINT = 'sign-in'
const FORM_ENCODED = 'application/x-www-form-urlencoded'
const HTTP_OK = 200
const HTTP_REDIRECT_MIN = 300
const HTTP_REDIRECT_MAX = 399

const isRedirect = (status) =>
  status >= HTTP_REDIRECT_MIN && status <= HTTP_REDIRECT_MAX

const recorded = (response) => {
  recordServerError(response)
  recordTransportError(response)

  return response
}

const hiddenFieldsOf = (form) =>
  Object.fromEntries(
    form
      .find('input[type="hidden"]')
      .toArray()
      .map((input) => [input.attr('name'), input.attr('value') ?? ''])
      .filter(([name]) => name)
  )

const chosenPostForm = (html) => {
  const postForms = html
    .find('form')
    .toArray()
    .filter((form) => form.attr('method')?.toLowerCase() === 'post')
  const withToken = postForms.filter(
    (form) => form.find('input[name="concurrencyToken"]').size() > 0
  )

  return withToken.at(-1) ?? postForms[0]
}

const NON_ANSWER_INPUT_TYPES = new Set(['hidden', 'submit', 'button'])

const isSet = (value) => value !== undefined

const optionValuesOf = (select) =>
  select
    .find('option')
    .toArray()
    .map((option) => option.attr('value') ?? '')
    .filter((value) => value)

const selectedValueOf = (select) =>
  select
    .find('option')
    .toArray()
    .find((option) => isSet(option.attr('selected')))
    ?.attr('value') ?? ''

const formInputsOf = (form) => [
  ...form
    .find('input')
    .toArray()
    .filter((input) => !NON_ANSWER_INPUT_TYPES.has(input.attr('type')))
    .map((input) => ({
      name: input.attr('name') ?? '',
      type: input.attr('type') ?? '',
      value: input.attr('value') ?? '',
      checked: isSet(input.attr('checked'))
    })),
  ...form
    .find('select')
    .toArray()
    .map((select) => ({
      name: select.attr('name') ?? '',
      type: 'select',
      value: selectedValueOf(select),
      options: optionValuesOf(select)
    })),
  ...form
    .find('textarea')
    .toArray()
    .map((textarea) => ({
      name: textarea.attr('name') ?? '',
      type: 'textarea',
      value: textarea.text().trim()
    }))
]

const hiddenFieldsOfPage = (html) => {
  const chosen = chosenPostForm(html)

  return chosen ? hiddenFieldsOf(chosen) : {}
}

const formInputsOfPage = (html) => {
  const chosen = chosenPostForm(html)

  return chosen ? formInputsOf(chosen) : []
}

const toPage = (response, url, outcome) => {
  const html = response.status === HTTP_OK ? response.html() : undefined

  return {
    status: response.status,
    url,
    receivedAt: Date.now(),
    html,
    crumb: html?.find('meta[name="csrf-token"]').attr('content') ?? '',
    heading: html?.find('h1').first().text().trim() ?? '',
    hiddenFields: html ? hiddenFieldsOfPage(html) : {},
    formInputs: html ? formInputsOfPage(html) : [],
    ...outcome
  }
}

/**
 * Creates one virtual user's browser-like session against a single frontend.
 *
 * It keeps a cookie jar of its own, or shares the one it is given, follows
 * redirects itself so every hop is tagged with an endpoint, signs in when the
 * Defra ID stub's sign-in page appears, and counts a stale-concurrency redirect
 * as a handled outcome.
 *
 * @param {object} options - Session settings.
 * @param {string} options.baseUrl - The frontend's base URL.
 * @param {string} options.localhostAlias - The host that stands in for `localhost` in redirects.
 * @param {{ crn: string, password: string }} options.credentials - The stub identity to sign in with.
 * @param {{ add: (value: number) => void }} options.staleRedirects - Counts handled stale-concurrency redirects.
 * @param {object} [options.jar] - A cookie jar to share with another session, as one browser does across frontends.
 * @param {Record<string, string>} [options.extraTags] - Tags added to every request, overriding the defaults.
 * @returns {{ open: Function, post: Function, submitForm: Function, submitMultipart: Function, getJson: Function, signedInThroughIdentityProvider: () => boolean, signIns: () => number }} The session. `submitMultipart` posts a form with one file; `getJson` reads a JSON route, returning undefined unless it answers 200 with JSON; `signIns` counts the redirect chains that went through a sign-in, and once it is above 0 every later sign-in hop is tagged `auth: re-authentication`.
 */
export const createBrowserSession = ({
  baseUrl,
  localhostAlias,
  credentials,
  staleRedirects,
  jar = new http.CookieJar(),
  extraTags = {}
}) => {
  let signedIn = false
  let completedSignIns = 0

  const authTagFor = (endpoint) =>
    endpoint === SIGN_IN_ENDPOINT && completedSignIns > 0
      ? RE_AUTHENTICATION_TAG
      : {}

  const paramsFor = (endpoint, headers = {}) => {
    markPhase()

    return {
      jar,
      redirects: 0,
      headers,
      tags: {
        endpoint,
        kind: kindOf(endpoint),
        name: endpoint,
        ...authTagFor(endpoint),
        ...extraTags
      }
    }
  }

  const postForm = (url, fields, endpoint) =>
    recorded(
      http.post(
        url,
        encodeForm(fields),
        paramsFor(endpoint, { 'content-type': FORM_ENCODED })
      )
    )

  const follow = (first, firstUrl, endpoint) => {
    let response = first
    let url = firstUrl
    let hops = 0
    let staleActionHandled = false
    let chainSignedIn = false
    let passedThroughSignIn = false

    while (isRedirect(response.status) && hops < MAX_REDIRECT_HOPS) {
      const location = response.headers.Location

      if (isStaleActionRedirect(location)) {
        staleRedirects.add(1)
        staleActionHandled = true
      }

      url = absoluteLocation(url, location, localhostAlias)

      const hopEndpoint = endpointForHop(url, endpoint)

      response = recorded(http.get(url, paramsFor(hopEndpoint)))
      hops += 1
      passedThroughSignIn =
        passedThroughSignIn || hopEndpoint === SIGN_IN_ENDPOINT

      if (response.status === HTTP_OK && isIdentitySignInPage(url)) {
        response = postForm(url, credentials, SIGN_IN_ENDPOINT)
        signedIn = true
        chainSignedIn = true
      }
    }

    if ((chainSignedIn || passedThroughSignIn) && response.status === HTTP_OK) {
      completedSignIns += 1
    }

    return toPage(response, url, {
      staleActionHandled,
      tooManyRedirects: isRedirect(response.status)
    })
  }

  const open = (path, endpoint) => {
    const url = `${baseUrl}${path}`

    return follow(recorded(http.get(url, paramsFor(endpoint))), url, endpoint)
  }

  const post = (path, fields, endpoint) => {
    const url = `${baseUrl}${path}`

    return follow(postForm(url, fields, endpoint), url, endpoint)
  }

  const submitForm = (page, answers, endpoint) =>
    post(
      page.url.slice(originOf(page.url).length),
      formFields(
        { ...prefilledFields(page.formInputs), ...page.hiddenFields },
        answers
      ),
      endpoint
    )

  const submitMultipart = (page, answers, file, endpoint) => {
    const url = `${baseUrl}${page.url.slice(originOf(page.url).length)}`
    const fields = formFields(
      { ...prefilledFields(page.formInputs), ...page.hiddenFields },
      answers
    )

    return follow(
      recorded(http.post(url, { ...fields, file }, paramsFor(endpoint))),
      url,
      endpoint
    )
  }

  const getJson = (path, endpoint) => {
    const response = recorded(
      http.get(
        `${baseUrl}${path}`,
        paramsFor(endpoint, { accept: 'application/json' })
      )
    )

    if (response.status !== HTTP_OK) {
      return undefined
    }

    try {
      return response.json()
    } catch {
      return undefined
    }
  }

  return {
    open,
    post,
    submitForm,
    submitMultipart,
    getJson,
    signedInThroughIdentityProvider: () => signedIn,
    signIns: () => completedSignIns
  }
}
