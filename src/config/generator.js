const BYTES_PER_MEGABYTE = 1024 * 1024
const BASE_MEGABYTES = 128
const PER_VIRTUAL_USER_MEGABYTES = 20

/**
 * What the load generator must keep so it is never the bottleneck.
 *
 * `minIdleShare` is the k6 docs' running-large-tests rule: at least 20% idle
 * cycles. The memory figures are interim: a base so a run of one virtual user
 * does not look oversized, plus "tens of megabytes per VU" for tests that
 * upload files, which live animals does.
 */
export const GENERATOR = Object.freeze({
  minIdleShare: 0.2,
  windowSeconds: 60,
  settleSeconds: 60,
  memoryBaseBytes: BASE_MEGABYTES * BYTES_PER_MEGABYTE,
  memoryPerVuBytes: PER_VIRTUAL_USER_MEGABYTES * BYTES_PER_MEGABYTE,
  sampleSeconds: 5
})
