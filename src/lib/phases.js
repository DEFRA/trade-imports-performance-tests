const phaseIndexAt = (schedule, elapsedSeconds) => {
  const index = schedule.findIndex(
    ({ startSeconds, endSeconds }) =>
      elapsedSeconds >= startSeconds &&
      (endSeconds === null || elapsedSeconds < endSeconds)
  )

  return index === -1 ? 0 : index
}

/**
 * Finds the schedule entry that holds a time: start inclusive, end exclusive.
 *
 * @param {ReadonlyArray<{ phase: string, startSeconds: number, endSeconds: number | null, paceFactor: number }>} schedule - Ordered phases.
 * @param {number} elapsedSeconds - Seconds since the scenarios started.
 * @returns {{ phase: string, startSeconds: number, endSeconds: number | null, paceFactor: number }} The entry. A time before 0 is the first phase.
 */
export const phaseEntryAt = (schedule, elapsedSeconds) =>
  schedule[phaseIndexAt(schedule, elapsedSeconds)]

/**
 * Names the phase a time falls in.
 *
 * @param {ReadonlyArray<{ phase: string, startSeconds: number, endSeconds: number | null }>} schedule - Ordered phases.
 * @param {number} elapsedSeconds - Seconds since the scenarios started.
 * @returns {string} The phase name.
 */
export const phaseAt = (schedule, elapsedSeconds) =>
  phaseEntryAt(schedule, elapsedSeconds).phase

/**
 * Works out how long, on the wall clock, it takes to use up some think time
 * when each phase runs at its own pace.
 *
 * Think time passes at `paceFactor` seconds per wall-clock second in a phase,
 * so a wait that straddles a phase boundary is exact.
 *
 * @param {number} thinkSeconds - The think time to use up.
 * @param {number} elapsedSeconds - Seconds since the scenarios started, when the wait begins.
 * @param {ReadonlyArray<{ phase: string, startSeconds: number, endSeconds: number | null, paceFactor: number }>} schedule - Ordered phases.
 * @returns {number} Wall-clock seconds.
 */
export const wallSecondsFor = (thinkSeconds, elapsedSeconds, schedule) => {
  let remaining = thinkSeconds
  let wall = 0
  let now = elapsedSeconds
  let index = phaseIndexAt(schedule, now)

  while (remaining > 0) {
    const { endSeconds, paceFactor } = schedule[index]

    if (endSeconds === null) {
      return wall + remaining / paceFactor
    }

    const wallLeft = endSeconds - now
    const thinkLeft = wallLeft * paceFactor

    if (thinkLeft >= remaining) {
      return wall + remaining / paceFactor
    }

    remaining -= thinkLeft
    wall += wallLeft
    now = endSeconds
    index += 1
  }

  return wall
}
