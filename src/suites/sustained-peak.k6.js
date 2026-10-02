import { SHAPES } from '../config/design-target.js'
import { createDesignTargetRun } from '../k6/design-target.js'

const run = createDesignTargetRun({ shape: SHAPES.SUSTAINED_PEAK, env: __ENV })

export const options = run.options
export const setup = run.setup
export const teardown = run.teardown
export const handleSummary = run.handleSummary
export const liveAnimals = run.liveAnimals
export const highRiskPlants = run.highRiskPlants
export const insFrontDoor = run.insFrontDoor
export const insAddressBook = run.insAddressBook
export const iuuJourneySession = run.iuuJourneySession
export const iuuFrontDoor = run.iuuFrontDoor
export const iuuAddressBook = run.iuuAddressBook
