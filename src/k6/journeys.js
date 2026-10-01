import { check, sleep } from 'k6'
import http from 'k6/http'

import { THINK_TIME_MAX_S, THINK_TIME_MIN_S } from '../config/smoke.js'
import { replaceBodyFrom } from '../lib/capture.js'
import { journeyIdFrom } from '../lib/redirects.js'

const HTTP_OK = 200
const HTTP_SUCCESS_MAX = 299
const JSON_HEADERS = { 'content-type': 'application/json' }

const thinkTime = () =>
  THINK_TIME_MIN_S + Math.random() * (THINK_TIME_MAX_S - THINK_TIME_MIN_S)

const think = () => sleep(thinkTime())

const firstValue = (html, selector) =>
  html
    .find(selector)
    .toArray()
    .map((element) => element.attr('value'))
    .find((value) => value)

const ANSWERS = {
  origin: (page, vu, iteration) => ({
    countryOfOrigin: firstValue(
      page.html,
      'select[name="countryOfOrigin"] option'
    ),
    regionOfOriginCodeRequirement: 'no',
    internalReferenceNumber: `PERF-${vu}-${iteration}`
  }),
  'commodity-type': (page) => ({
    commodityType: firstValue(page.html, 'input[name="commodityType"]')
  })
}

const isAnswered = (value) => typeof value === 'string' && value !== ''

const READS_BACK = {
  origin: (page, answers) =>
    isAnswered(answers.internalReferenceNumber) &&
    page.html?.find('input[name="internalReferenceNumber"]').attr('value') ===
      answers.internalReferenceNumber,
  'commodity-type': (page, answers) =>
    isAnswered(answers.commodityType) &&
    page.html?.find('input[name="commodityType"][checked]').attr('value') ===
      answers.commodityType
}

const isSavedPage = (page) =>
  page.status >= HTTP_OK &&
  page.status <= HTTP_SUCCESS_MAX &&
  !page.tooManyRedirects

const backendParams = (endpoint, headers = {}) => ({
  headers,
  tags: { endpoint, kind: 'api', name: endpoint }
})

const checkSignedInThroughDefraId = (session, iteration) => {
  if (iteration !== 0) {
    return
  }

  check(session, {
    'sign-in went through Defra ID': (signedInSession) =>
      signedInSession.signedInThroughIdentityProvider()
  })
}

/**
 * Opens the INS dashboard, signing in on the way.
 *
 * @param {object} session - A browser session on the INS frontend.
 * @param {number} iteration - The iteration number. The first one must have signed in through Defra ID.
 */
export const insFrontDoor = (session, iteration) => {
  const page = session.open('/', 'ins-dashboard')

  check(page, {
    'INS dashboard opens signed in': (dashboardPage) =>
      dashboardPage.status === HTTP_OK && dashboardPage.heading === 'Dashboard'
  })

  checkSignedInThroughDefraId(session, iteration)

  think()
}

const capturedBodyFrom = (fulfilments, list) => {
  try {
    return replaceBodyFrom(fulfilments.json(), list.json('content.0'))
  } catch {
    return undefined
  }
}

const replayCapturedSave = ({ journey, backendUrl, id }) => {
  const prefix = journey.endpointPrefix
  const notificationUrl = `${backendUrl}/notifications/${id}`

  const fulfilments = http.get(
    `${notificationUrl}/fulfilments`,
    backendParams(`${prefix}-backend-fulfilments`)
  )
  const list = http.get(
    `${backendUrl}/notifications?referenceNumber=${id}`,
    backendParams(`${prefix}-backend-list`)
  )

  check(fulfilments, {
    'backend fulfilments read succeeds': (response) =>
      response.status === HTTP_OK
  })
  check(list, {
    'backend list read succeeds': (response) => response.status === HTTP_OK
  })

  if (fulfilments.status !== HTTP_OK || list.status !== HTTP_OK) {
    return
  }

  const body = capturedBodyFrom(fulfilments, list)

  check(body, {
    'captured save is complete': (captured) => captured !== undefined
  })

  if (body === undefined) {
    return
  }

  const replace = http.put(
    notificationUrl,
    JSON.stringify(body),
    backendParams(`${prefix}-backend-replace`, JSON_HEADERS)
  )

  check(replace, {
    'backend replay accepted the captured save': (response) =>
      response.status === HTTP_OK
  })
}

/**
 * Runs one notification journey: create a draft through the frontend, save a
 * page, read it back, replay the captured save against the backend, read it back again.
 *
 * @param {object} options - Journey settings.
 * @param {object} options.journey - An entry of `JOURNEYS`.
 * @param {object} options.session - A browser session on the journey's frontend.
 * @param {string} options.backendUrl - The journey backend's base URL.
 * @param {number} options.vu - The virtual user number.
 * @param {number} options.iteration - The iteration number. The first one must have signed in through Defra ID.
 */
export const draftJourney = ({
  journey,
  session,
  backendUrl,
  vu,
  iteration
}) => {
  const { setBase, savePage, endpointPrefix, savePageEndpoint } = journey
  const createPath = `${setBase}/notifications`

  const dashboard = session.open(setBase, `${endpointPrefix}-dashboard`)

  check(dashboard, {
    'journey dashboard opens with a crumb': (page) =>
      page.status === HTTP_OK && page.crumb !== ''
  })
  checkSignedInThroughDefraId(session, iteration)
  think()

  const created = session.post(
    createPath,
    { crumb: dashboard.crumb },
    `${endpointPrefix}-create`
  )
  const id = journeyIdFrom(created.url, createPath)

  check(created, {
    'draft created through the frontend': (page) =>
      page.status === HTTP_OK && id !== '' && page.url.endsWith(`/${savePage}`)
  })
  think()

  if (id === '' || created.status !== HTTP_OK) {
    return
  }

  const answers = ANSWERS[savePage](created, vu, iteration)
  const saved = session.submitForm(created, answers, `${savePageEndpoint}-save`)

  check(saved, {
    'save accepted or stale action handled': isSavedPage
  })
  think()

  const savePagePath = `${createPath}/${id}/${savePage}`

  if (!saved.staleActionHandled) {
    const readBack = session.open(savePagePath, savePageEndpoint)

    check(readBack, {
      'saved answer reads back': (page) => READS_BACK[savePage](page, answers)
    })
    think()
  }

  replayCapturedSave({ journey, backendUrl, id })
  think()

  if (!saved.staleActionHandled) {
    const afterReplay = session.open(savePagePath, savePageEndpoint)

    check(afterReplay, {
      'captured replay leaves the saved answer in place': (page) =>
        READS_BACK[savePage](page, answers)
    })
    think()
  }
}
