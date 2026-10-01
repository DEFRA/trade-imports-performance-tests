import { STEP_ENDPOINTS } from '../config/journey-endpoints.js'
import { ANIMAL_COMMODITY_SEARCH } from '../config/test-data.js'
import { countAt } from '../lib/distributions.js'
import {
  blankFieldAnswers,
  selectOptions,
  slashDateText
} from '../lib/form-fill.js'
import { documentsStep } from './documents.js'
import {
  choiceLabelled,
  choiceValues,
  identityOf,
  pagePath,
  pickAddress,
  pickFrom,
  reachAndSubmit,
  saved
} from './journey-pages.js'

const ENDPOINTS = STEP_ENDPOINTS['live-animals']

const ARRIVAL_DAYS_AHEAD = 7
const PARTY_SLUGS = [
  'place-of-origin/select',
  'consignors/select',
  'consignees/select',
  'importers/select',
  'destinations/select'
]
const FRANCE = 'FR'
const DEFAULT_PORT_OF_ENTRY = 'GB ABD'

const drawnOrElse = (context, formInputs, name, fallback) =>
  pickFrom(context, selectOptions(formInputs, name)) ?? fallback

const originAnswers = (context, page) => ({
  countryOfOrigin: drawnOrElse(
    context,
    page.formInputs,
    'countryOfOrigin',
    FRANCE
  ),
  regionOfOriginCodeRequirement: 'no',
  internalReferenceNumber: `PERF-${context.vu}-${context.iteration}${context.suffix}`
})

const commodities = {
  name: 'commodities',
  run: (context, landed) => {
    const { walker } = context
    const opened = walker.reach(
      landed,
      pagePath(context, 'commodities'),
      ENDPOINTS.commodities.open
    )
    const searched = walker.submit(
      opened,
      { commoditySearch: ANIMAL_COMMODITY_SEARCH, action: 'search' },
      ENDPOINTS.commodities.search
    )

    return saved(
      'commodities',
      walker.submit(
        searched,
        { species: pickFrom(context, choiceValues(searched, 'species')) },
        ENDPOINTS.commodities.save
      )
    )
  }
}

const addresses = {
  name: 'addresses',
  run: (context, landed) => {
    const { walker } = context
    const path = pagePath(context, 'addresses')
    let page = walker.reach(landed, path, ENDPOINTS.addresses.open)

    for (const slug of PARTY_SLUGS) {
      page = pickAddress(context, {
        landed: page,
        slug,
        field: 'party',
        endpoints: ENDPOINTS.addresses.picker
      })
    }

    return saved(
      'addresses',
      walker.submit(
        walker.reach(page, path, ENDPOINTS.addresses.open),
        {},
        ENDPOINTS.addresses.save
      )
    )
  }
}

const portOfEntry = reachAndSubmit(
  'port-of-entry',
  'port-of-entry',
  ENDPOINTS['port-of-entry'],
  (context, page) => ({
    arrivalDateAtPort: slashDateText(context.now, ARRIVAL_DAYS_AHEAD),
    portOfEntry: drawnOrElse(
      context,
      page.formInputs,
      'portOfEntry',
      DEFAULT_PORT_OF_ENTRY
    ),
    meansOfTransport: 'ROAD_VEHICLE',
    transportIdentification: 'FR-892-LK',
    transportDocumentReference: 'CMR-2026-884721'
  })
)

const transitCountries = {
  name: 'transit-countries',
  run: (context, landed) => {
    const { walker } = context
    const endpoints = ENDPOINTS['transit-countries']
    const opened = walker.reach(
      landed,
      pagePath(context, 'transit-countries'),
      endpoints.open
    )
    const added = walker.submit(
      opened,
      {
        transitedCountry: drawnOrElse(
          context,
          opened.formInputs,
          'transitedCountry',
          FRANCE
        ),
        action: 'add'
      },
      endpoints.add
    )

    return saved('transit-countries', walker.submit(added, {}, endpoints.save))
  }
}

const transporters = reachAndSubmit(
  'transporters',
  'transporters',
  ENDPOINTS.transporters,
  (_context, page) => ({
    transporter: choiceValues(page, 'transporter')[0],
    action: 'save'
  })
)

const contact = reachAndSubmit(
  'contact',
  'consignment/contact/select',
  ENDPOINTS.contact,
  ({ addressName }, page) => ({
    contactAddress: choiceLabelled(page, 'contactAddress', addressName)
  })
)

export const LIVE_ANIMALS_STEPS = Object.freeze({
  draft: [
    reachAndSubmit('origin', 'origin', ENDPOINTS.origin, originAnswers),
    commodities,
    reachAndSubmit(
      'consignment-details',
      'consignment-details',
      ENDPOINTS['consignment-details'],
      (context, page) => blankFieldAnswers(page.formInputs, identityOf(context))
    ),
    reachAndSubmit(
      'identification',
      'commodities/identification',
      ENDPOINTS.identification,
      (context, page) => blankFieldAnswers(page.formInputs, identityOf(context))
    ),
    reachAndSubmit(
      'import-reason',
      'import-reason',
      ENDPOINTS['import-reason'],
      () => ({
        reasonForImport: 'internalMarket',
        purposeInInternalMarket: 'breeding'
      })
    ),
    reachAndSubmit(
      'additional-details',
      'additional-details',
      ENDPOINTS['additional-details'],
      (_context, page) => ({
        animalsCertifiedFor: choiceLabelled(
          page,
          'animalsCertifiedFor',
          'Slaughter'
        ),
        containsUnweanedAnimals: choiceLabelled(
          page,
          'containsUnweanedAnimals',
          'No'
        )
      })
    ),
    documentsStep,
    addresses,
    reachAndSubmit('cph-number', 'cph-number', ENDPOINTS['cph-number'], () => ({
      cphCounty: '12',
      cphParish: '345',
      cphHolding: '6789'
    })),
    portOfEntry,
    transitCountries,
    transporters,
    contact
  ],
  reEdit: [
    'origin',
    'import-reason',
    'additional-details',
    'cph-number',
    'port-of-entry'
  ],
  amendEdit: 'origin',
  planFor: (journeyModel, iteration) => ({
    notificationType: 'live-animals',
    documents: countAt(iteration, journeyModel.documentsPerNotification)
  })
})
