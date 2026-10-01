import { STEP_ENDPOINTS } from '../config/journey-endpoints.js'
import { arrivalDateText, blankFieldAnswers } from '../lib/form-fill.js'
import {
  identityOf,
  pagePath,
  pickAddress,
  reachAndSubmit,
  saved
} from './journey-pages.js'

const ENDPOINTS = STEP_ENDPOINTS['high-risk-plants']

const COMMODITY_TYPE = 'plants-for-planting'
const CATEGORY = 'plants-for-planting'
const ORIGIN_EU_MEMBER_STATE = 'DE'
const ARRIVAL_DAYS_AHEAD = 7
const NOT_YET_ARRIVED = 'not-yet-arrived'

const picker = (name, slug, field) => ({
  name,
  run: (context, landed) =>
    saved(
      name,
      pickAddress(context, {
        landed,
        slug,
        field,
        endpoints: ENDPOINTS[name]
      })
    )
})

const commodityLine = {
  name: 'commodity-line',
  run: (context, landed) => {
    const { walker } = context
    const endpoints = ENDPOINTS['commodity-line']
    const entry = walker.reach(
      landed,
      pagePath(context, 'commodities/details'),
      endpoints.open
    )
    const revealed = walker.submit(
      entry,
      { category: CATEGORY },
      endpoints.categorySave
    )

    return saved(
      'commodity-line',
      walker.submit(
        revealed,
        {
          category: CATEGORY,
          ...blankFieldAnswers(revealed.formInputs, identityOf(context))
        },
        endpoints.save
      )
    )
  }
}

const NON_WORD_CHARACTERS = /\W/g

const consignmentNumberFor = ({ vu, iteration, suffix }) =>
  `PERF_${vu}_${iteration}${suffix}`.replaceAll(NON_WORD_CHARACTERS, '')

const identificationNumbers = reachAndSubmit(
  'identification-numbers',
  'identification-numbers',
  ENDPOINTS['identification-numbers'],
  (context, page) => ({
    ...blankFieldAnswers(page.formInputs, identityOf(context)),
    consignmentNumber: consignmentNumberFor(context)
  })
)

export const HIGH_RISK_PLANTS_STEPS = Object.freeze({
  draft: [
    reachAndSubmit(
      'commodity-type',
      'commodity-type',
      ENDPOINTS['commodity-type'],
      () => ({ commodityType: COMMODITY_TYPE })
    ),
    commodityLine,
    reachAndSubmit(
      'commodities',
      'commodities',
      ENDPOINTS.commodities,
      () => ({})
    ),
    reachAndSubmit('origin', 'origin', ENDPOINTS.origin, () => ({
      countryOfOrigin: ORIGIN_EU_MEMBER_STATE
    })),
    reachAndSubmit(
      'arrival-status',
      'arrival-status',
      ENDPOINTS['arrival-status'],
      () => ({ arrivalStatus: NOT_YET_ARRIVED })
    ),
    reachAndSubmit(
      'arrival-details',
      'arrival-details',
      ENDPOINTS['arrival-details'],
      ({ now }) => ({
        arrivalDate: arrivalDateText(now, ARRIVAL_DAYS_AHEAD)
      })
    ),
    picker('destination', 'destinations/select', 'placeOfDestination'),
    picker('consignor', 'consignors/select', 'consignor'),
    identificationNumbers,
    picker('contact', 'consignment/contact/select', 'contactAddress')
  ],
  reEdit: ['origin', 'arrival-details', 'identification-numbers', 'contact'],
  amendEdit: 'identification-numbers'
})
