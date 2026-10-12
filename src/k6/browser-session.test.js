import { beforeEach, describe, expect, test, vi } from 'vitest'

const httpMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  CookieJar: class {}
}))

vi.mock('k6/http', () => ({ default: httpMock }))
vi.mock('./phase.js', () => ({ markPhase: vi.fn() }))
vi.mock('./server-errors.js', () => ({
  recordServerError: vi.fn(),
  recordTransportError: vi.fn()
}))

const { createBrowserSession } = await import('./browser-session.js')

const emptySelection = () => {
  const selection = {
    toArray: () => [],
    size: () => 0,
    attr: () => undefined,
    first: () => selection,
    text: () => ''
  }

  return selection
}

const redirectTo = (location) => ({
  status: 302,
  headers: { Location: location }
})

const answer = (status) => ({
  status,
  headers: {},
  html: () => ({ find: emptySelection })
})

const APP = 'http://app.test'
const IDENTITY_CALLBACK = 'http://identity.test/oauth2/authresp'

const newSession = () =>
  createBrowserSession({
    baseUrl: APP,
    localhostAlias: 'localhost',
    credentials: { crn: '1', password: 'x' },
    staleRedirects: { add: vi.fn() }
  })

describe('createBrowserSession sign-in counting', () => {
  beforeEach(() => {
    httpMock.get.mockReset()
    httpMock.post.mockReset()
  })

  test('does not count a chain that reaches sign-in and ends in a server error', () => {
    httpMock.get
      .mockReturnValueOnce(redirectTo(`${APP}/auth/sign-in`))
      .mockReturnValueOnce(answer(503))

    const session = newSession()

    session.open('/dashboard', 'ins-dashboard')

    expect(session.signIns()).toBe(0)
    expect(session.signedInThroughIdentityProvider()).toBe(false)
  })

  test('counts the first chain that posts credentials and lands, so a later sign-in is a re-authentication', () => {
    httpMock.get
      .mockReturnValueOnce(redirectTo(`${APP}/auth/sign-in`))
      .mockReturnValueOnce(answer(503))
      .mockReturnValueOnce(redirectTo(IDENTITY_CALLBACK))
      .mockReturnValueOnce(answer(200))
      .mockReturnValueOnce(answer(200))
    httpMock.post.mockReturnValueOnce(redirectTo(`${APP}/dashboard`))

    const session = newSession()

    session.open('/dashboard', 'ins-dashboard')
    session.open('/dashboard', 'ins-dashboard')

    expect(httpMock.post).toHaveBeenCalledTimes(1)
    expect(session.signIns()).toBe(1)
    expect(session.signedInThroughIdentityProvider()).toBe(true)
  })

  test('counts a chain through the sign-in routes that lands without a form', () => {
    httpMock.get
      .mockReturnValueOnce(redirectTo(`${APP}/auth/callback`))
      .mockReturnValueOnce(redirectTo(`${APP}/dashboard`))
      .mockReturnValueOnce(answer(200))

    const session = newSession()

    session.open('/dashboard', 'ins-dashboard')

    expect(httpMock.post).not.toHaveBeenCalled()
    expect(session.signIns()).toBe(1)
  })

  test('does not count a chain that never touches sign-in', () => {
    httpMock.get.mockReturnValueOnce(answer(200))

    const session = newSession()

    session.open('/dashboard', 'ins-dashboard')

    expect(session.signIns()).toBe(0)
  })
})

describe('createBrowserSession submitForm', () => {
  const REVIEW = `${APP}/notifications/N-1/notification-view`
  const reviewPage = (formAction) => ({
    url: REVIEW,
    formInputs: [],
    hiddenFields: { step: 'review' },
    formAction
  })

  beforeEach(() => {
    httpMock.post.mockReset()
    httpMock.post.mockReturnValue(answer(200))
  })

  test('posts to the form action when asked to and the form has one', () => {
    newSession().submitForm(
      reviewPage('/notifications/N-1/declaration'),
      {},
      'animals-declaration',
      { toAction: true }
    )

    expect(httpMock.post.mock.calls[0][0]).toBe(
      `${APP}/notifications/N-1/declaration`
    )
  })

  test('posts back to the page when not asked to follow the action', () => {
    newSession().submitForm(
      reviewPage('/notifications/N-1/declaration'),
      {},
      'animals-declaration'
    )

    expect(httpMock.post.mock.calls[0][0]).toBe(REVIEW)
  })

  test('posts back to the page when the form has no action', () => {
    newSession().submitForm(reviewPage(undefined), {}, 'plants-declaration', {
      toAction: true
    })

    expect(httpMock.post.mock.calls[0][0]).toBe(REVIEW)
  })
})
