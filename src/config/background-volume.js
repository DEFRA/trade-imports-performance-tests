export { DATASTORES } from '../lib/background-volume.js'

/**
 * The target of each datastore that has one. The read model has none: high-risk
 * plants publishes no events yet (pbe-022), so it holds only what live animals
 * publishes.
 *
 * @param {object} backgroundVolume - The `backgroundVolume` part of the traffic model.
 * @returns {Record<string, number>} Targets by datastore.
 */
export const targetsFrom = (backgroundVolume) => ({
  'live-animals': backgroundVolume.liveAnimalsNotifications,
  'high-risk-plants': backgroundVolume.highRiskPlantsNotifications,
  'address-book': backgroundVolume.addressBookEntries
})

export const INDEXED_SERVICES = Object.freeze([
  'animals backend',
  'plants backend',
  'INS backend',
  'address book'
])

/**
 * The line a run logs once every owning service has answered a read.
 *
 * @returns {string} The line to log.
 */
export const indexesBuiltLine = () =>
  `Indexes: built in the ${INDEXED_SERVICES.slice(0, -1).join(', ')} and ${INDEXED_SERVICES.at(-1)}. Each answered a read, and each builds its indexes at start-up before it answers (Spring Data auto-index-creation)`

export const BACKGROUND_SCENARIOS = Object.freeze({
  'seed-live-animals': Object.freeze({
    exec: 'seedLiveAnimals',
    datastore: 'live-animals'
  }),
  'seed-high-risk-plants': Object.freeze({
    exec: 'seedHighRiskPlants',
    datastore: 'high-risk-plants'
  }),
  'seed-address-book': Object.freeze({
    exec: 'seedAddressBook',
    datastore: 'address-book'
  })
})

/**
 * Builds the k6 `scenarios` option for the background-volume run.
 *
 * Each scenario shares a fixed number of iterations between a few virtual
 * users: the target, capped at `maxCreatedPerRun`. Iterations that find the
 * shortfall already met return at once, so the run only creates what is missing.
 *
 * @param {object} model - A resolved traffic model.
 * @returns {Record<string, object>} One shared-iterations scenario per entry of `BACKGROUND_SCENARIOS`.
 */
export const backgroundScenarios = (model) => {
  const targets = targetsFrom(model.backgroundVolume)
  const { maxCreatedPerRun, virtualUsers, maxDuration } = model.backgroundVolume

  return Object.fromEntries(
    Object.entries(BACKGROUND_SCENARIOS).map(([name, { exec, datastore }]) => {
      const iterations = Math.min(targets[datastore], maxCreatedPerRun)

      return [
        name,
        {
          executor: 'shared-iterations',
          iterations,
          vus: Math.min(virtualUsers, iterations),
          maxDuration,
          exec
        }
      ]
    })
  )
}
