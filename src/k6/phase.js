import { sleep } from 'k6'
import exec from 'k6/execution'

import { phaseAt, wallSecondsFor } from '../lib/phases.js'

const MS_PER_SECOND = 1000

let schedule

/**
 * Sets the phase schedule this virtual user's metrics are tagged and paced by.
 *
 * @param {ReadonlyArray<object>} nextSchedule - A schedule from `phaseSchedule`.
 */
export const usePhaseSchedule = (nextSchedule) => {
  schedule = nextSchedule
}

const elapsedSeconds = () =>
  (Date.now() - exec.scenario.startTime) / MS_PER_SECOND

/**
 * Tags everything this virtual user emits next with the phase it is in, or
 * does nothing when no schedule is set.
 */
export const markPhase = () => {
  if (schedule === undefined) {
    return
  }

  exec.vu.metrics.tags.phase = phaseAt(schedule, elapsedSeconds())
}

/**
 * Waits for think time, paced by the phase it runs in.
 *
 * With no schedule this is `sleep`. In a burst phase the wait is shorter, so
 * every user moves faster through the same journey.
 *
 * @param {number} seconds - The think time to use up.
 */
export const pacedSleep = (seconds) => {
  if (schedule === undefined) {
    sleep(seconds)

    return
  }

  sleep(wallSecondsFor(seconds, elapsedSeconds(), schedule))
}
