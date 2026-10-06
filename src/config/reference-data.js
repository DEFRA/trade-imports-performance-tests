const FRONTEND_PAIR = 'animals and plants frontends'

// The frontends read reference data once a process and keep it, so these are the URLs they use (animals and plants services/countries and services/ports, ins-frontend services/countries).
// A forced miss reads a block no country is in: MdmService never caches an empty answer (unless = "#result == null || #result.isEmpty()"), so it reaches MDM on every read.
export const REFERENCE_DATA_READS = Object.freeze(
  [
    {
      endpoint: 'reference-data-countries-sps',
      path: '/countries?blocks=GBNAG_SPS_EX',
      readBy: FRONTEND_PAIR,
      forcedMiss: false
    },
    {
      endpoint: 'reference-data-countries',
      path: '/countries',
      readBy: 'INS frontend',
      forcedMiss: false
    },
    {
      endpoint: 'reference-data-ports-of-entry',
      path: '/ports-of-entry',
      readBy: FRONTEND_PAIR,
      forcedMiss: false
    },
    {
      endpoint: 'reference-data-countries-uncached',
      path: '/countries?blocks=PERF_TEST_NO_SUCH_BLOCK',
      readBy: 'nobody: a forced miss',
      forcedMiss: true
    }
  ].map(Object.freeze)
)

export const CACHE_CLASSES = Object.freeze(['cold', 'warm', 'unclassified'])

// The stub integration only reference-data calls, whose answered count rises when a read reaches MDM.
export const MDM_INTEGRATION = 'mdm'
