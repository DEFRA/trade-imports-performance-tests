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

// A selection over a fixed set of matches, so a test can drive the page-parsing
// helpers from something closer to markup than an always-empty selection.
const selectionOf = (matches) => ({
  toArray: () => matches,
  size: () => matches.length,
  attr: (name) => matches[0]?.attributes[name],
  first: () => selectionOf(matches.slice(0, 1)),
  text: () => matches[0]?.content ?? ''
})

const elementOf = (attributes, descendants = {}, content = '') => ({
  attributes,
  content,
  attr: (name) => attributes[name],
  text: () => content,
  find: (selector) => selectionOf(descendants[selector] ?? [])
})

const pageAnswer = (forms) => ({
  status: 200,
  headers: {},
  html: () => ({
    find: (selector) => selectionOf(selector === 'form' ? forms : [])
  })
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

// Both describes drive the same two mocks, so the reset is declared once.
beforeEach(() => {
  httpMock.get.mockReset()
  httpMock.post.mockReset()
})

describe('createBrowserSession sign-in counting', () => {
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

describe('createBrowserSession multipart submits', () => {
  const DOCUMENTS_PATH =
    '/live-animals/notifications/n-1/accompanying-documents'
  const UPLOAD_ENDPOINT = 'animals-documents-upload'
  const UPLOAD_ACTION = '/upload-and-scan/upload-1'
  const FILE_CARRYING_SUBMIT = '[formenctype="multipart/form-data"][formaction]'

  const documentsPage = (uploadAction) => ({
    url: `${APP}${DOCUMENTS_PATH}`,
    formInputs: [],
    hiddenFields: { crumb: 'c-1' },
    uploadAction
  })

  const file = { data: new Uint8Array([1]).buffer, filename: 'cert.pdf' }

  const submitDocument = (uploadAction) =>
    newSession().submitMultipart(
      documentsPage(uploadAction),
      { action: 'add' },
      file,
      UPLOAD_ENDPOINT
    )

  test("posts the file to the page's upload target", () => {
    httpMock.post.mockReturnValueOnce(redirectTo(`${APP}${DOCUMENTS_PATH}`))
    httpMock.get.mockReturnValueOnce(answer(200))

    submitDocument(UPLOAD_ACTION)

    expect(httpMock.post.mock.calls[0][0]).toBe(`${APP}${UPLOAD_ACTION}`)
  })

  test('sends the typed fields and the file in one body', () => {
    httpMock.post.mockReturnValueOnce(answer(200))

    submitDocument(UPLOAD_ACTION)

    expect(httpMock.post.mock.calls[0][1]).toEqual({
      crumb: 'c-1',
      action: 'add',
      file
    })
  })

  test('follows the upload service back to the page it returns to', () => {
    httpMock.post.mockReturnValueOnce(redirectTo(`${APP}${DOCUMENTS_PATH}`))
    httpMock.get.mockReturnValueOnce(answer(200))

    const landed = submitDocument(UPLOAD_ACTION)

    expect(httpMock.get.mock.calls[0][0]).toBe(`${APP}${DOCUMENTS_PATH}`)
    expect(landed.status).toBe(200)
  })

  test('posts to the page itself when it has no upload target', () => {
    httpMock.post.mockReturnValueOnce(answer(200))

    submitDocument(undefined)

    expect(httpMock.post.mock.calls[0][0]).toBe(`${APP}${DOCUMENTS_PATH}`)
  })

  // In amend mode the save buttons carry a formaction too, and they come first
  // in document order, so taking the first one would post the file back at the
  // page instead of the upload service.
  test('reads the upload target from the file-carrying submit, not the first formaction', () => {
    const amendSave = elementOf({ formaction: `${DOCUMENTS_PATH}?change=1` })
    const uploadSubmit = elementOf({
      formaction: UPLOAD_ACTION,
      formenctype: 'multipart/form-data'
    })
    const form = elementOf(
      { method: 'post' },
      {
        '[formaction]': [amendSave, uploadSubmit],
        [FILE_CARRYING_SUBMIT]: [uploadSubmit]
      }
    )
    httpMock.get.mockReturnValueOnce(pageAnswer([form]))

    const landed = newSession().open(DOCUMENTS_PATH, UPLOAD_ENDPOINT)

    expect(landed.uploadAction).toBe(UPLOAD_ACTION)
  })
})
