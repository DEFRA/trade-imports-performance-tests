import { STEP_ENDPOINTS } from '../config/journey-endpoints.js'
import {
  PLANT_ORIGINS_BY_COMMODITY_TYPE,
  POTATO_ARRIVAL_TIME
} from '../config/test-data.js'
import { countAt, valueAt } from '../lib/distributions.js'
import {
  blankFieldAnswers,
  hasField,
  selectOptions,
  slashDateText
} from '../lib/form-fill.js'
import {
  choiceValues,
  identityOf,
  pagePath,
  pickAddress,
  pickFrom,
  reachAndSubmit,
  saved
} from './journey-pages.js'

const ENDPOINTS = STEP_ENDPOINTS['high-risk-plants']

const ARRIVAL_DAYS_AHEAD = 7
const NOT_YET_ARRIVED = 'not-yet-arrived'
// The commodity types whose arrival status and consignor pages are asked: plants-frontend obligations/sections/arrival.js and parties.js.
const POST_ARRIVAL_TYPES = ['plants-for-planting', 'wood-and-cut-trees']

const onlyFor = (step, types) => ({
  ...step,
  appliesTo: ({ notificationType }) => types.includes(notificationType)
})

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

const lineAnswers = (context, revealed, category) => ({
  category,
  ...blankFieldAnswers(revealed.formInputs, identityOf(context), (options) =>
    pickFrom(context, options)
  )
})

const saveLine = (context, entry, isLast) => {
  const { walker } = context
  const endpoints = ENDPOINTS['commodity-line']
  const category = pickFrom(context, choiceValues(entry, 'category'))
  const revealed = walker.submit(entry, { category }, endpoints.categorySave)
  const answers = lineAnswers(context, revealed, category)

  return saved(
    'commodity-line',
    walker.submit(
      revealed,
      isLast ? answers : { ...answers, action: 'add' },
      endpoints.save
    )
  )
}

const commodityLines = {
  name: 'commodity-line',
  run: (context, landed) => {
    const lines = context.plan.commodityLines
    let page = context.walker.reach(
      landed,
      pagePath(context, 'commodities/details'),
      ENDPOINTS['commodity-line'].open
    )

    for (let line = 1; line <= lines; line += 1) {
      page = saveLine(context, page, line === lines)
    }

    return page
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

const originAnswers = (context, page) => {
  const allowed = PLANT_ORIGINS_BY_COMMODITY_TYPE[context.plan.notificationType]
  const offered = selectOptions(page.formInputs, 'countryOfOrigin').filter(
    (code) => allowed.includes(code)
  )

  return { countryOfOrigin: pickFrom(context, offered) ?? allowed[0] }
}

const arrivalDetailsAnswers = (context, page) => {
  const places = selectOptions(page.formInputs, 'proposedPlaceOfLanding')

  return {
    arrivalDate: slashDateText(context.now, ARRIVAL_DAYS_AHEAD),
    ...(hasField(page.formInputs, 'arrivalTime')
      ? { arrivalTime: POTATO_ARRIVAL_TIME }
      : {}),
    ...(places.length > 0
      ? { proposedPlaceOfLanding: pickFrom(context, places) }
      : {})
  }
}

export const HIGH_RISK_PLANTS_STEPS = Object.freeze({
  draft: [
    reachAndSubmit(
      'commodity-type',
      'commodity-type',
      ENDPOINTS['commodity-type'],
      ({ plan }) => ({ commodityType: plan.notificationType })
    ),
    commodityLines,
    reachAndSubmit(
      'commodities',
      'commodities',
      ENDPOINTS.commodities,
      () => ({})
    ),
    reachAndSubmit('origin', 'origin', ENDPOINTS.origin, originAnswers),
    onlyFor(
      reachAndSubmit(
        'arrival-status',
        'arrival-status',
        ENDPOINTS['arrival-status'],
        () => ({ arrivalStatus: NOT_YET_ARRIVED })
      ),
      POST_ARRIVAL_TYPES
    ),
    reachAndSubmit(
      'arrival-details',
      'arrival-details',
      ENDPOINTS['arrival-details'],
      arrivalDetailsAnswers
    ),
    picker('destination', 'destinations/select', 'placeOfDestination'),
    onlyFor(
      picker('consignor', 'consignors/select', 'consignor'),
      POST_ARRIVAL_TYPES
    ),
    identificationNumbers,
    picker('contact', 'consignment/contact/select', 'contactAddress')
  ],
  reEdit: ['origin', 'arrival-details', 'identification-numbers', 'contact'],
  amendEdit: 'identification-numbers',
  planFor: (journeyModel, iteration) => ({
    notificationType: valueAt(iteration, journeyModel.commodityTypes),
    commodityLines: countAt(
      iteration,
      journeyModel.commodityLinesPerNotification
    )
  })
})
