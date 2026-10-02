import { check } from 'k6'
import exec from 'k6/execution'
import http from 'k6/http'

import { sharedEndpoints } from '../config/journey-endpoints.js'
import { TRAFFIC_CLASSES } from '../config/request-mix.js'
import {
  amendmentPlan,
  isChosen,
  sessionsFor,
  thinkSecondsMean
} from '../config/traffic.js'
import { replaceBodyFrom } from '../lib/capture.js'
import { journeyIdFrom } from '../lib/redirects.js'
import { chunkEvenly, reEditPlan } from '../lib/traffic-shape.js'
import { createBrowserSession } from './browser-session.js'
import {
  openInsDashboard,
  SIGN_IN_AND_DASHBOARD_PAGES,
  secondsSince
} from './front-door.js'
import { pagePath } from './journey-pages.js'
import {
  createWalker,
  recordNotificationPages,
  recordNotificationStarted,
  recordSession
} from './pages.js'
import { markPhase } from './phase.js'
import { recordServerError } from './server-errors.js'

const HTTP_OK = 200
const JSON_HEADERS = { 'content-type': 'application/json' }

const REVIEW_PAGES = 3
const READ_BACK_PAGES = 3
const AMEND_START_AND_EDIT_PAGES = 3
const CANCEL_AMEND_PAGES = 2
const RESUBMIT_AMEND_PAGES = 3
const AMENDMENT_SUFFIX = '-A'

const backendParams = (endpoint, headers = {}) => {
  markPhase()

  return {
    headers,
    tags: { endpoint, kind: 'api', name: endpoint }
  }
}

const recorded = (response) => {
  recordServerError(response)

  return response
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

  const fulfilments = recorded(
    http.get(
      `${notificationUrl}/fulfilments`,
      backendParams(`${prefix}-backend-fulfilments`)
    )
  )
  const list = recorded(
    http.get(
      `${backendUrl}/notifications?referenceNumber=${id}`,
      backendParams(`${prefix}-backend-list`)
    )
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

  const replace = recorded(
    http.put(
      notificationUrl,
      JSON.stringify(body),
      backendParams(`${prefix}-backend-replace`, JSON_HEADERS)
    )
  )

  check(replace, {
    'backend replay accepted the captured save': (response) =>
      response.status === HTTP_OK
  })
}

const createPathOf = (journey) => `${journey.setBase}/notifications`

const baseOf = (journey, id) => `${createPathOf(journey)}/${id}`

const startUserSession = (run) => {
  const jar = new http.CookieJar()
  const sessionOn = (baseUrl) =>
    createBrowserSession({
      baseUrl,
      localhostAlias: run.localhostAlias,
      credentials: run.credentials,
      staleRedirects: run.staleRedirects,
      jar
    })
  const ins = createWalker({
    session: sessionOn(run.urls.ins),
    thinkMean: run.thinkMean,
    trafficClass: TRAFFIC_CLASSES.DASHBOARD_READ,
    frontend: 'ins'
  })
  const walker = createWalker({
    session: sessionOn(run.urls.frontend),
    thinkMean: run.thinkMean,
    trafficClass: TRAFFIC_CLASSES.JOURNEY,
    counter: run.counter,
    frontend: run.journey.endpointPrefix
  })

  openInsDashboard(ins)

  return { ins, walker, startedAt: Date.now() }
}

const openJourneyDashboard = (run, walker) => {
  const dashboard = walker
    .withClass(TRAFFIC_CLASSES.DASHBOARD_READ)
    .open(run.journey.setBase, run.shared.dashboard)

  check(dashboard, {
    'journey dashboard opens with a crumb': (page) =>
      page.status === HTTP_OK && page.crumb !== ''
  })

  return dashboard
}

const createDraft = (run, walker, dashboard) => {
  const createPath = createPathOf(run.journey)
  const created = walker.post(
    createPath,
    { crumb: dashboard.crumb },
    run.shared.create
  )
  const id = journeyIdFrom(created.url, createPath)

  check(created, {
    'draft created through the frontend': (page) =>
      page.status === HTTP_OK &&
      id !== '' &&
      page.url.endsWith(`/${run.journey.firstSavePage}`)
  })

  return { created, id }
}

const contextFor = (run, walker, id, suffix = '') => ({
  walker,
  base: baseOf(run.journey, id),
  addressName: run.addressName,
  vu: run.vu,
  iteration: run.iterationInTest,
  now: new Date(),
  suffix,
  plan: run.plan,
  journeyModel: run.journeyModel,
  worstCaseSearch: run.worstCaseSearch,
  random: Math.random
})

const runSteps = (context, steps, landed) => {
  let page = landed

  for (const step of steps) {
    page = step.run(context, page)

    if (page.status !== HTTP_OK) {
      return { ok: false }
    }
  }

  return { ok: true, landed: page }
}

const runDraftChunk = (run, context, chunk, landed, replayAfterFirst) => {
  if (!replayAfterFirst) {
    return runSteps(context, chunk, landed)
  }

  const [first, ...rest] = chunk
  const afterFirst = runSteps(context, [first], landed)

  if (!afterFirst.ok) {
    return afterFirst
  }

  replayCapturedSave({
    journey: run.journey,
    backendUrl: run.urls.backend,
    id: run.id
  })

  return runSteps(context, rest, undefined)
}

const reEditUntilTarget = (run, context) => {
  const tail = run.tailPages
  const names = reEditPlan(
    run.reEditNames,
    run.counter.count,
    run.journeyModel.pagesPerNotification - tail
  )
  const steps = names.map((name) =>
    run.draftSteps.find((step) => step.name === name)
  )

  return runSteps(context, steps, undefined)
}

const submitFromReview = (run, context, checkName) => {
  const { walker } = context
  const view = walker.open(
    pagePath(context, 'notification-view'),
    run.shared.notificationView
  )
  const declaration = walker.reach(
    undefined,
    pagePath(context, 'declaration'),
    run.shared.declaration
  )
  const confirmation = walker.submit(
    declaration,
    { declaration: 'confirmed' },
    run.shared.declarationSave
  )

  check(confirmation, {
    [checkName]: (page) =>
      view.status === HTTP_OK &&
      page.status === HTTP_OK &&
      page.url.endsWith('/confirmation')
  })

  return confirmation
}

const readBack = (run, context) => {
  const { walker } = context
  const search = walker
    .withClass(TRAFFIC_CLASSES.DASHBOARD_READ)
    .open(
      `${run.journey.setBase}?referenceNumber=${run.id}`,
      run.shared.dashboardSearch
    )
  const reads = walker.withClass(TRAFFIC_CLASSES.POST_SUBMISSION_READ)
  const hub = reads.open(context.base, run.shared.hub)
  const view = reads.open(
    pagePath(context, 'notification-view'),
    run.shared.notificationView
  )

  check(search, {
    'submitted notification is on the dashboard': (page) =>
      page.status === HTTP_OK && page.html.text().includes(run.id)
  })
  check(hub, { 'submitted hub reads back': (page) => page.status === HTTP_OK })
  check(view, {
    'submitted notification view reads back': (page) => page.status === HTTP_OK
  })

  return search
}

const cancelAmendment = (run, context) => {
  const { walker } = context
  const confirmation = walker.open(
    pagePath(context, 'cancel-amend'),
    run.shared.cancelAmend
  )
  const cancelled = walker.submit(confirmation, {}, run.shared.cancelAmendSave)

  check(cancelled, {
    'amendment cancelled': (page) =>
      page.status === HTTP_OK &&
      page.url.includes('/notification-view') &&
      page.url.includes('cancelled=1')
  })
}

const amend = (run, walker, crumb) => {
  const amending = walker.withClass(TRAFFIC_CLASSES.AMENDMENT)
  const context = contextFor(run, amending, run.id, AMENDMENT_SUFFIX)
  const hub = amending.post(
    `${context.base}/amend`,
    { crumb },
    run.shared.amend
  )

  check(hub, {
    'amendment started': (page) =>
      page.status === HTTP_OK && page.url.endsWith(context.base)
  })

  if (hub.status !== HTTP_OK) {
    return
  }

  const edit = run.draftSteps.find((step) => step.name === run.steps.amendEdit)
  const edited = runSteps(context, [edit], undefined)

  if (!edited.ok) {
    return
  }

  if (run.cancelsAmendment) {
    cancelAmendment(run, context)
    return
  }

  submitFromReview(run, context, 'amendment resubmitted')
}

const amendPagesFor = (amends, cancels) => {
  if (!amends) {
    return 0
  }

  return (
    AMEND_START_AND_EDIT_PAGES +
    (cancels ? CANCEL_AMEND_PAGES : RESUBMIT_AMEND_PAGES)
  )
}

const finishNotification = (run, context) => {
  const reEdited = reEditUntilTarget(run, context)

  if (!reEdited.ok) {
    return false
  }

  const confirmation = submitFromReview(
    run,
    context,
    'submitted through the declaration page'
  )

  if (confirmation.status !== HTTP_OK) {
    return false
  }

  const search = readBack(run, context)

  if (run.amends) {
    amend(run, context.walker, search.crumb)
  }

  return true
}

const closeUserSession = (run, { ins, startedAt }) => {
  const statusChecks =
    run.model.frontDoor.corePagesPerJourneySession - SIGN_IN_AND_DASHBOARD_PAGES

  for (let view = 0; view < statusChecks; view += 1) {
    ins.open('/', 'ins-dashboard')
  }

  recordSession(secondsSince(startedAt))
}

const runUserSession = (run, { index, chunk, last }) => {
  const user = startUserSession(run)
  const dashboard = openJourneyDashboard(run, user.walker)
  let landed

  if (index === 0) {
    const draft = createDraft(run, user.walker, dashboard)

    if (draft.id === '' || draft.created.status !== HTTP_OK) {
      return false
    }

    run.id = draft.id
    landed = draft.created
  } else {
    user.walker.open(baseOf(run.journey, run.id), run.shared.hub)
  }

  const context = contextFor(run, user.walker, run.id)
  const drafted = runDraftChunk(
    run,
    context,
    chunk,
    landed,
    index === 0 && run.replaysCapturedSave
  )

  if (!drafted.ok || (last && !finishNotification(run, context))) {
    return false
  }

  closeUserSession(run, user)

  return true
}

const prepareRun = (options) => {
  const { journey, model, iterationInTest } = options
  const journeyModel = model[journey.trafficKey]
  const { amends, cancelsAmendment } = amendmentPlan(
    iterationInTest,
    journeyModel
  )
  const plan = options.steps.planFor(journeyModel, iterationInTest)
  const draftSteps = options.steps.draft.filter(
    (step) => step.appliesTo?.(plan) ?? true
  )

  return {
    ...options,
    urls: { ...options.urls, backend: options.backendUrl },
    shared: sharedEndpoints(journey.endpointPrefix),
    journeyModel,
    plan,
    draftSteps,
    reEditNames: options.steps.reEdit.filter((name) =>
      draftSteps.some((step) => step.name === name)
    ),
    worstCaseSearch: {
      pending: isChosen(iterationInTest, model.addressBook.worstCaseSearchShare)
    },
    thinkMean:
      options.paced === false
        ? 0
        : thinkSecondsMean(journeyModel, model.frontDoor),
    replaysCapturedSave: options.replaysCapturedSave ?? true,
    counter: { count: 0 },
    id: '',
    amends,
    cancelsAmendment,
    tailPages:
      REVIEW_PAGES + READ_BACK_PAGES + amendPagesFor(amends, cancelsAmendment)
  }
}

/**
 * Runs one notification as a real user would: drafted across one or two
 * sessions, submitted, read back, then amended and cancelled or resubmitted.
 *
 * Each session signs in afresh through the INS front door. The draft steps are
 * split across the sessions, and the last one also re-edits answered pages to
 * reach the pages-per-notification figure, submits through the declaration,
 * reads the notification back from the dashboard and hub, and amends it. Every
 * navigation goes through a walker, so it is classified for the request mix and
 * followed by think time. A step that does not land ends the iteration.
 *
 * What each notification carries comes from the traffic model's distributions:
 * `steps.planFor` draws its type, commodity lines and documents, and steps
 * marked `appliesTo` are left out of notification types that do not ask them.
 * Answers that come from reference data are drawn at random from the options
 * each page offers.
 *
 * @param {object} options - Journey settings.
 * @param {object} options.journey - An entry of `JOURNEYS`.
 * @param {{ draft: object[], reEdit: string[], amendEdit: string, planFor: (journeyModel: object, iteration: number) => object }} options.steps - The journey's step definitions.
 * @param {object} options.model - A resolved traffic model.
 * @param {string} options.backendUrl - The journey backend's base URL.
 * @param {{ ins: string, frontend: string }} options.urls - The INS and journey frontend base URLs.
 * @param {{ crn: string, password: string }} options.credentials - The stub identity to sign in with.
 * @param {string} options.localhostAlias - The host that stands in for `localhost` in redirects.
 * @param {{ add: (value: number) => void }} options.staleRedirects - Counts handled stale-concurrency redirects.
 * @param {string} options.addressName - The name of the address the pickers choose.
 * @param {number} options.vu - The virtual user number.
 * @param {number} options.iterationInTest - The iteration number across the whole scenario.
 * @param {boolean} [options.paced] - False waits no think time, for set-up runs that measure nothing. Defaults to true.
 * @param {boolean} [options.replaysCapturedSave] - False skips the backend replay of the first save. Defaults to true.
 */
export const notificationJourney = (options) => {
  const run = prepareRun(options)
  const sessions = Math.max(
    1,
    sessionsFor(run.iterationInTest, run.journeyModel.sessionsPerNotification)
  )
  const chunks = chunkEvenly(run.draftSteps, sessions)

  exec.vu.metrics.tags.notification_type = run.plan.notificationType
  recordNotificationStarted(run.plan.notificationType)

  for (const [index, chunk] of chunks.entries()) {
    const finished = runUserSession(run, {
      index,
      chunk,
      last: index === sessions - 1
    })

    if (!finished) {
      return
    }
  }

  recordNotificationPages(run.counter.count)
}
