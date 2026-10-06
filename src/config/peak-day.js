import { ARRIVAL_TIMEOUT_SECONDS } from './eventing.js'
import {
  SECONDS_PER_HOUR,
  durationSeconds,
  freezeDeep,
  gracefulStopFor,
  iterationSeconds,
  virtualUsersFor
} from './traffic.js'

export const PEAK_DAY_SCENARIOS = Object.freeze({
  'live-animals': Object.freeze({
    exec: 'liveAnimals',
    trafficKey: 'liveAnimals',
    notificationsKey: 'liveAnimalsNotifications'
  }),
  'high-risk-plants': Object.freeze({
    exec: 'highRiskPlants',
    trafficKey: 'highRiskPlants',
    notificationsKey: 'highRiskPlantsNotifications'
  })
})

/**
 * What each run length lays over the traffic model's defaults.
 *
 * `full` and `nightly` run the peak-day volume. `local` is a script check: a
 * handful of notifications over minutes, with sessions shortened so the run
 * ends.
 */
export const PEAK_DAY_LENGTH_PROFILES = freezeDeep({
  full: {},
  nightly: {},
  local: {
    peakDay: {
      liveAnimalsNotifications: 6,
      highRiskPlantsNotifications: 5,
      duration: '6m'
    },
    liveAnimals: { sessionMinutes: 2 },
    highRiskPlants: { sessionMinutes: 2 }
  }
})

const scenarioFor = ({ model, name, exec, notificationsKey }) => {
  const { duration } = model.peakDay
  const windowSeconds = durationSeconds(duration)
  const notifications = model.peakDay[notificationsKey]
  const seconds = iterationSeconds(model)[name] + ARRIVAL_TIMEOUT_SECONDS

  return {
    executor: 'constant-arrival-rate',
    rate: notifications,
    timeUnit: `${windowSeconds}s`,
    duration: `${windowSeconds}s`,
    ...virtualUsersFor(
      (notifications * SECONDS_PER_HOUR) / windowSeconds,
      seconds
    ),
    gracefulStop: gracefulStopFor(seconds),
    exec,
    tags: { journey: name }
  }
}

/**
 * Builds the k6 `scenarios` option for the peak-day run.
 *
 * Each journey is an open-model scenario that starts exactly the day's number of
 * notifications, spread evenly over the run's duration. The virtual users come
 * from Little's law, counting the wait for a notification's events to arrive.
 *
 * @param {object} model - A resolved traffic model.
 * @returns {Record<string, object>} One constant-arrival-rate scenario per entry of `PEAK_DAY_SCENARIOS`.
 */
export const peakDayScenarios = (model) =>
  Object.fromEntries(
    Object.entries(PEAK_DAY_SCENARIOS).map(
      ([name, { exec, notificationsKey }]) => [
        name,
        scenarioFor({ model, name, exec, notificationsKey })
      ]
    )
  )

/**
 * The log line that names a peak-day run's settings.
 *
 * @param {object} options - The run.
 * @param {object} options.model - A resolved traffic model.
 * @param {string} options.scenarioLength - `full`, `nightly` or `local`.
 * @param {string} options.environment - The environment the run is in.
 * @param {string | undefined} options.stubProfile - The stub profile the run requires, if any.
 * @returns {string} The line.
 */
export const peakDayLine = ({
  model,
  scenarioLength,
  environment,
  stubProfile
}) => {
  const { liveAnimalsNotifications, highRiskPlantsNotifications, duration } =
    model.peakDay
  const scriptCheck =
    scenarioLength === 'local'
      ? ', a script check, not the peak-day volume'
      : ''

  return `Peak-day run: ${liveAnimalsNotifications} live-animals and ${highRiskPlantsNotifications} high-risk-plants notifications over ${duration}, in ${environment}, requiring stub profile ${stubProfile ?? 'none'}${scriptCheck}`
}
