import { describe, expect, test } from 'vitest'

import {
  absoluteLocation,
  endpointForHop,
  isIdentitySignInPage,
  isStaleActionRedirect,
  journeyIdFrom,
  originOf
} from './redirects.js'

const FROM = 'http://localhost:3000/live-animals'
const ALIAS = 'host.docker.internal'

describe('originOf', () => {
  test('returns the scheme, host and port', () => {
    expect(originOf('http://localhost:3002/a/b?c=d')).toBe(
      'http://localhost:3002'
    )
  })

  test('throws for a URL that is not absolute', () => {
    expect(() => originOf('/a/b')).toThrow('Not an absolute URL: /a/b')
  })
})

describe('absoluteLocation', () => {
  test('joins a root-relative Location to the origin of the request', () => {
    expect(absoluteLocation(FROM, '/live-animals/notifications/1')).toBe(
      'http://localhost:3000/live-animals/notifications/1'
    )
  })

  test('keeps an absolute Location', () => {
    expect(absoluteLocation(FROM, 'https://example.test/x')).toBe(
      'https://example.test/x'
    )
  })

  test('rewrites localhost to the alias', () => {
    expect(absoluteLocation(FROM, 'http://localhost:3007/a?b=c', ALIAS)).toBe(
      'http://host.docker.internal:3007/a?b=c'
    )
  })

  test('keeps localhost when no alias is given', () => {
    expect(absoluteLocation(FROM, 'http://localhost:3007/a')).toBe(
      'http://localhost:3007/a'
    )
  })

  test('never rewrites another host', () => {
    expect(
      absoluteLocation(FROM, 'http://localhost.example.test/a', ALIAS)
    ).toBe('http://localhost.example.test/a')
  })

  test('throws for a relative Location', () => {
    expect(() => absoluteLocation(FROM, 'next')).toThrow(
      'Relative redirect Location is not supported: next'
    )
  })
})

describe('isStaleActionRedirect', () => {
  test.each([
    ['/live-animals?staleAction=1', true],
    ['/live-animals?a=b&staleAction=1', true],
    ['/live-animals?staleAction=1&a=b', true],
    ['/live-animals?staleAction=10', false],
    ['/live-animals', false]
  ])('%s is %s', (location, expected) => {
    expect(isStaleActionRedirect(location)).toBe(expected)
  })
})

describe('isIdentitySignInPage', () => {
  test('is true for the identity provider sign-in path', () => {
    expect(
      isIdentitySignInPage(
        'http://localhost:3007/dcidmtest.onmicrosoft.com/oauth2/authresp'
      )
    ).toBe(true)
  })

  test('is false for a journey page', () => {
    expect(isIdentitySignInPage('http://localhost:3000/live-animals')).toBe(
      false
    )
  })
})

describe('endpointForHop', () => {
  test.each([
    ['http://localhost:3002/auth/sign-in?next=%2F', 'sign-in'],
    [
      'http://localhost:3007/dcidmtest.onmicrosoft.com/oauth2/v2.0/authorize?x=1',
      'sign-in'
    ],
    ['http://localhost:3007/organisations', 'sign-in'],
    ['http://localhost:3007/idphub/b2c/x', 'sign-in'],
    ['http://localhost:3000/live-animals', 'animals-dashboard']
  ])('%s is %s', (url, expected) => {
    expect(endpointForHop(url, 'animals-dashboard')).toBe(expected)
  })
})

describe('journeyIdFrom', () => {
  const createPath = '/live-animals/notifications'

  test('reads the segment after the create path', () => {
    expect(
      journeyIdFrom(
        `http://localhost:3000${createPath}/DRAFT.GB.2026.1/origin?x=1`,
        createPath
      )
    ).toBe('DRAFT.GB.2026.1')
  })

  test('returns an empty string for a Location outside the create path', () => {
    expect(
      journeyIdFrom('http://localhost:3000/live-animals', createPath)
    ).toBe('')
  })
})
