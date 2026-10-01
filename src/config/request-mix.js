const PERCENT = 100

export const TRAFFIC_CLASSES = Object.freeze({
  SIGN_IN: 'sign-in',
  DASHBOARD_READ: 'dashboard-read',
  JOURNEY: 'journey',
  POST_SUBMISSION_READ: 'post-submission-read',
  AMENDMENT: 'amendment',
  ADDRESS_BOOK: 'address-book'
})

/**
 * Tells whether a page request counts towards the dashboard-read share.
 *
 * @param {string} trafficClass - A value of `TRAFFIC_CLASSES`.
 * @returns {boolean} True for a dashboard read.
 */
export const isDashboardRead = (trafficClass) =>
  trafficClass === TRAFFIC_CLASSES.DASHBOARD_READ

/**
 * Words the request mix a run aims for, to log beside what it achieves.
 *
 * @param {{ mix: { dashboardReadShareTarget: number } }} model - A resolved traffic model.
 * @returns {string} The target line.
 */
export const mixTargetLine = (model) =>
  `Request mix target: dashboard reads ${Math.round(model.mix.dashboardReadShareTarget * PERCENT)}% of page requests (D7)`
