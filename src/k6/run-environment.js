import { Gauge } from 'k6/metrics'

const runEnvironmentGauge = new Gauge('run_environment')

/** Records the environment the run targets, so the end-of-test summary names it. */
export const recordRunEnvironment = (environment) =>
  runEnvironmentGauge.add(1, { environment })
