import { describe, expect, test } from 'vitest'

import { describeMissedPage } from './missed-page.js'

describe('describeMissedPage', () => {
  test('names the status, address and heading the page answered with', () => {
    expect(
      describeMissedPage('INS dashboard', {
        status: 200,
        url: 'http://ins:3000/auth/sign-in-oidc?code=abc',
        heading: 'Sorry, we are unable to sign you in.'
      })
    ).toBe(
      'INS dashboard did not open: status 200 at http://ins:3000/auth/sign-in-oidc?code=abc, heading "Sorry, we are unable to sign you in."'
    )
  })

  test('says when the redirects never settled', () => {
    expect(
      describeMissedPage('INS dashboard', {
        status: 302,
        url: 'http://ins:3000/',
        heading: '',
        tooManyRedirects: true
      })
    ).toBe(
      'INS dashboard did not open: status 302 at http://ins:3000/, heading "", after too many redirects'
    )
  })
})
