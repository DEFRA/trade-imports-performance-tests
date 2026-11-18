import { describe, expect, test, vi } from 'vitest'

vi.mock('k6', () => ({ check: vi.fn(), sleep: vi.fn() }))
vi.mock('k6/http', () => ({ default: {} }))
vi.mock('k6/execution', () => ({ default: {} }))
vi.mock('k6/metrics', () => ({
  Counter: class {
    add() {}
  },
  Rate: class {
    add() {}
  },
  Trend: class {
    add() {}
  }
}))

const { ADDRESS_TYPES, DECLARED_ROLES_BY_ADDRESS_TYPE } =
  await import('../lib/address-book.js')
const { makeEveryDeclaredRoleFindable } = await import('./front-door.js')

const ADDRESS = { addressLine1: '1 Test Street', postcode: 'AB1 2CD' }
const NAME = 'Test Address'

const foundPage = () => ({
  status: 200,
  url: '',
  html: {
    find: () => ({ toArray: () => [{ attr: () => '/address-book/found-1' }] })
  }
})

const notFoundPage = () => ({
  status: 200,
  url: '',
  html: { find: () => ({ toArray: () => [] }) }
})

const savedPage = () => ({ status: 200, url: '' })

const fakeRequests = ({ foundRoles = [], addFindsItsRoles = true } = {}) => {
  const found = new Set(foundRoles)
  const submitted = []

  const open = (path) =>
    [...found].some((role) => path.includes(`role=${role}`))
      ? foundPage()
      : notFoundPage()

  const submit = (_page, answers) => {
    submitted.push(answers)

    if (addFindsItsRoles && answers.roles) {
      answers.roles.forEach((role) => found.add(role))
    }

    return savedPage()
  }

  return { open, submit, submitted }
}

const typeChoicesOf = (submitted) =>
  submitted
    .filter((answers) => 'addressType' in answers)
    .map(({ addressType }) => addressType)

const addsOf = (submitted) => submitted.filter((answers) => 'roles' in answers)

describe('makeEveryDeclaredRoleFindable', () => {
  test('adds one record under every declared address type when no search finds the address', () => {
    const requests = fakeRequests()

    makeEveryDeclaredRoleFindable(requests, ADDRESS, NAME)

    expect(typeChoicesOf(requests.submitted).sort()).toEqual(
      Object.keys(DECLARED_ROLES_BY_ADDRESS_TYPE).sort()
    )
    expect(addsOf(requests.submitted).map(({ roles }) => roles)).toEqual(
      expect.arrayContaining(Object.values(DECLARED_ROLES_BY_ADDRESS_TYPE))
    )
  })

  test('adds nothing under a type whose every declared role already finds the address', () => {
    const requests = fakeRequests({
      foundRoles:
        DECLARED_ROLES_BY_ADDRESS_TYPE[ADDRESS_TYPES.ORIGIN_OR_CONSIGNOR]
    })

    makeEveryDeclaredRoleFindable(requests, ADDRESS, NAME)

    expect(typeChoicesOf(requests.submitted)).toEqual([
      ADDRESS_TYPES.DESTINATION_CONSIGNEE_OR_IMPORTER,
      ADDRESS_TYPES.BRANCH
    ])
  })

  test('adds under a type ticking every declared role when only some of its roles are found', () => {
    const [firstSendingRole] =
      DECLARED_ROLES_BY_ADDRESS_TYPE[ADDRESS_TYPES.ORIGIN_OR_CONSIGNOR]
    const requests = fakeRequests({
      foundRoles: [
        firstSendingRole,
        ...DECLARED_ROLES_BY_ADDRESS_TYPE[
          ADDRESS_TYPES.DESTINATION_CONSIGNEE_OR_IMPORTER
        ]
      ]
    })

    makeEveryDeclaredRoleFindable(requests, ADDRESS, NAME)

    expect(typeChoicesOf(requests.submitted)).toEqual([
      ADDRESS_TYPES.ORIGIN_OR_CONSIGNOR,
      ADDRESS_TYPES.BRANCH
    ])
    expect(addsOf(requests.submitted)).toEqual([
      expect.objectContaining({
        roles: DECLARED_ROLES_BY_ADDRESS_TYPE[ADDRESS_TYPES.ORIGIN_OR_CONSIGNOR]
      }),
      expect.objectContaining({
        roles: DECLARED_ROLES_BY_ADDRESS_TYPE[ADDRESS_TYPES.BRANCH]
      })
    ])
  })

  test('throws naming the address type and every role still missing after the add', () => {
    const requests = fakeRequests({ addFindsItsRoles: false })
    let thrown

    try {
      makeEveryDeclaredRoleFindable(requests, ADDRESS, NAME)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)

    for (const [addressType, roles] of Object.entries(
      DECLARED_ROLES_BY_ADDRESS_TYPE
    )) {
      expect(thrown.message).toContain(`${addressType}: ${roles.join(', ')}`)
    }
  })
})
