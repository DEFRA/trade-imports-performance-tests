import { freezeDeep } from './traffic.js'

// High-risk plants has no outbox and publishes no events yet (plants frontend limits.md, pbe-022).
export const PUBLISHING_JOURNEYS = freezeDeep({
  liveAnimals: true,
  highRiskPlants: false
})

// The two event types the gateway forwards to Service Bus: its EXTERNAL_EVENT_TYPES.
export const EXTERNAL_EVENT_TYPES = Object.freeze([
  'uk.gov.defra.imports.notification.NotificationSubmitted',
  'uk.gov.defra.imports.notification.NotificationSubmissionAmended'
])

// The gateway sends each external event once as each of these (finding req-061).
export const SCHEMA_VERSIONS = Object.freeze(['0.1.0', '0.2.0'])

// Interim: how long a run waits for a notification's events to reach the read model, and how often it asks.
export const ARRIVAL_TIMEOUT_SECONDS = 60
export const ARRIVAL_POLL_SECONDS = 2
// Interim: how long teardown waits for the backlog and the forwarded count to stop moving, and how often it asks.
export const SETTLE_TIMEOUT_SECONDS = 120
export const SETTLE_POLL_SECONDS = 2
// Interim: how long the burst and spike runs keep watching the backlog after the traffic stops.
export const DRAIN_WATCH_SECONDS = 180

/**
 * Tells whether a journey publishes events today.
 *
 * @param {{ trafficKey: string }} journey - An entry of `JOURNEYS`.
 * @returns {boolean} True for live animals, false for high-risk plants.
 */
export const publishesEvents = (journey) =>
  PUBLISHING_JOURNEYS[journey.trafficKey] === true
