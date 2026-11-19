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

const { ADDRESS_TYPES, DECLARED_ROLES_BY_ADDRESS_TYPE, addressBookListPath } =
  await import('../lib/address-book.js')
const { addAddressThrough, makeEveryDeclaredRoleFindable } =
  await import('./front-door.js')

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

const typeSavedPage = (addressType) => ({
  status: 200,
  url: '',
  formInputs: DECLARED_ROLES_BY_ADDRESS_TYPE[addressType].map((role) => ({
    name: 'roles',
    type: 'checkbox',
    value: role
  }))
})

const landedOnTabPage = (addressType) => ({
  status: 200,
  url: addressBookListPath(addressType)
})

const refusedOnTheAddFormPage = () => ({
  status: 400,
  url: '/address-book/add/address',
  heading: 'There is a problem'
})

const fakeRequests = ({
  foundRoles = [],
  addFindsItsRoles = true,
  addressTypesRefused = []
} = {}) => {
  const found = new Set(foundRoles)
  const submitted = []
  let addressTypeBeingAdded

  const open = (path) =>
    [...found].some((role) => path.includes(`role=${role}`))
      ? foundPage()
      : notFoundPage()

  const submit = (_page, answers) => {
    submitted.push(answers)

    if ('addressType' in answers) {
      addressTypeBeingAdded = answers.addressType
      return typeSavedPage(addressTypeBeingAdded)
    }

    if (addFindsItsRoles && answers.roles) {
      answers.roles.forEach((role) => found.add(role))
    }

    return addressTypesRefused.includes(addressTypeBeingAdded)
      ? refusedOnTheAddFormPage()
      : landedOnTabPage(addressTypeBeingAdded)
  }

  return { open, submit, submitted }
}

const requestsOfferingRoles = (offeredRoles) => ({
  open: () => ({ status: 200, url: '' }),
  submit: (_page, answers) =>
    'addressType' in answers
      ? {
          status: 200,
          url: '',
          formInputs: offeredRoles.map((role) => ({
            name: 'roles',
            type: 'checkbox',
            value: role
          }))
        }
      : landedOnTabPage(ADDRESS_TYPES.ORIGIN_OR_CONSIGNOR)
})

const typeChoicesOf = (submitted) =>
  submitted
    .filter((answers) => 'addressType' in answers)
    .map(({ addressType }) => addressType)

const addsOf = (submitted) => submitted.filter((answers) => 'roles' in answers)

describe('addAddressThrough', () => {
  test('throws naming the address type, the missing role and the roles the form offers, when the form does not offer every declared role', () => {
    const [, secondRole] =
      DECLARED_ROLES_BY_ADDRESS_TYPE[ADDRESS_TYPES.ORIGIN_OR_CONSIGNOR]

    expect(() =>
      addAddressThrough(
        requestsOfferingRoles([secondRole]),
        ADDRESS,
        NAME,
        ADDRESS_TYPES.ORIGIN_OR_CONSIGNOR
      )
    ).toThrowError(
      new RegExp(
        `${ADDRESS_TYPES.ORIGIN_OR_CONSIGNOR}.*${DECLARED_ROLES_BY_ADDRESS_TYPE[ADDRESS_TYPES.ORIGIN_OR_CONSIGNOR][0]}.*${secondRole}`
      )
    )
  })

  test('does not throw when the form offers every declared role', () => {
    expect(() =>
      addAddressThrough(
        requestsOfferingRoles(
          DECLARED_ROLES_BY_ADDRESS_TYPE[ADDRESS_TYPES.ORIGIN_OR_CONSIGNOR]
        ),
        ADDRESS,
        NAME,
        ADDRESS_TYPES.ORIGIN_OR_CONSIGNOR
      )
    ).not.toThrow()
  })
})

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

  test('does not throw when every add lands on its own address type tab', () => {
    const requests = fakeRequests()

    expect(() =>
      makeEveryDeclaredRoleFindable(requests, ADDRESS, NAME)
    ).not.toThrow()
  })

  test('throws naming the address type, and the status and heading of the page the save landed on, when a save does not land on that type tab', () => {
    const requests = fakeRequests({
      addressTypesRefused: [ADDRESS_TYPES.ORIGIN_OR_CONSIGNOR]
    })
    let thrown

    try {
      makeEveryDeclaredRoleFindable(requests, ADDRESS, NAME)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.message).toContain(ADDRESS_TYPES.ORIGIN_OR_CONSIGNOR)
    expect(thrown.message).toContain('400')
    expect(thrown.message).toContain('There is a problem')
  })
})
