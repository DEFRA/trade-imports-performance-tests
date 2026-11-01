import { STEP_ENDPOINTS } from '../config/journey-endpoints.js'
import {
  ANIMAL_COMMODITY_SEARCH,
  ANIMAL_COMMODITY_SPECIES
} from '../config/test-data.js'
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
  hasFieldMatching,
  identityOf,
  isSaved,
  pagePath,
  pathOfUrl,
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

const SAVE_ATTEMPTS = 2

const COMMODITIES_SAVE_ATTEMPTS = SAVE_ATTEMPTS
const CONSIGNMENT_SAVE_ATTEMPTS = SAVE_ATTEMPTS

const saveWorthRetrying = (page) =>
  page.staleActionHandled || page.tooManyRedirects

const searchCow = (walker, page) =>
  walker.submit(
    page,
    { commoditySearch: ANIMAL_COMMODITY_SEARCH, action: 'search' },
    ENDPOINTS.commodities.search
  )

const speciesToSave = (page) => {
  const values = choiceValues(page, 'species')
  const byLineKey = values.find((value) =>
    value.endsWith(`|${ANIMAL_COMMODITY_SPECIES}`)
  )

  return (
    byLineKey ??
    choiceLabelled(page, 'species', ANIMAL_COMMODITY_SPECIES) ??
    values[0]
  )
}

const saveSpecies = (walker, page, species) =>
  walker.submit(page, { species, action: 'save' }, ENDPOINTS.commodities.save)

const commoditiesSavedPage = (context, landed) => {
  const { walker } = context
  const path = pagePath(context, 'commodities')
  let page = walker.reach(landed, path, ENDPOINTS.commodities.open)
  let savedPage = page

  for (let attempt = 0; attempt < COMMODITIES_SAVE_ATTEMPTS; attempt += 1) {
    page = searchCow(walker, page)
    const species = speciesToSave(page)

    if (species !== undefined) {
      savedPage = saveSpecies(walker, page, species)

      if (isSaved(savedPage)) {
        break
      }

      if (!saveWorthRetrying(savedPage)) {
        break
      }
    }

    page = walker.reach(savedPage, path, ENDPOINTS.commodities.open)
  }

  return savedPage
}

const commodities = {
  name: 'commodities',
  run: (context, landed) =>
    saved('commodities', commoditiesSavedPage(context, landed))
}

const consignmentReady = (page, path) =>
  pathOfUrl(page.url) === path &&
  hasFieldMatching(page, 'numberOfAnimalsQuantity')

const consignmentDetails = {
  name: 'consignment-details',
  run: (context, landed) => {
    const { walker } = context
    const endpoints = ENDPOINTS['consignment-details']
    const path = pagePath(context, 'consignment-details')
    let page = walker.reach(landed, path, endpoints.open)
    let savedPage = page

    for (let attempt = 0; attempt < CONSIGNMENT_SAVE_ATTEMPTS; attempt += 1) {
      if (!consignmentReady(page, path)) {
        page = walker.reach(page, path, endpoints.open)
      }

      if (!consignmentReady(page, path)) {
        break
      }

      savedPage = walker.submit(
        page,
        consignmentAnswers(context, page),
        endpoints.save
      )

      if (isSaved(savedPage)) {
        break
      }

      if (!saveWorthRetrying(savedPage)) {
        break
      }

      page = walker.reach(savedPage, path, endpoints.open)
    }

    return saved('consignment-details', savedPage)
  }
}

const IDENTIFICATION_SUBMIT_ATTEMPTS = 4

const identificationAnswers = (context, page) => ({
  action: 'implicit-submit',
  ...blankFieldAnswers(page.formInputs, identityOf(context))
})

const identification = {
  name: 'identification',
  run: (context, landed) => {
    const { walker } = context
    const endpoints = ENDPOINTS.identification
    const path = pagePath(context, 'commodities/identification')
    let page = walker.reach(landed, path, endpoints.open)
    let savedPage = page

    if (pathOfUrl(page.url) !== path) {
      return saved('identification', savedPage)
    }

    for (
      let attempt = 0;
      attempt < IDENTIFICATION_SUBMIT_ATTEMPTS;
      attempt += 1
    ) {
      page = walker.reach(savedPage, path, endpoints.open)

      if (pathOfUrl(page.url) !== path) {
        savedPage = page
        break
      }

      savedPage = walker.submit(
        page,
        identificationAnswers(context, page),
        endpoints.save
      )

      if (pathOfUrl(savedPage.url) !== path && isSaved(savedPage)) {
        break
      }

      if (!isSaved(savedPage) && !saveWorthRetrying(savedPage)) {
        break
      }
    }

    return saved('identification', savedPage)
  }
}

const consignmentAnswers = (context, page) => {
  const answers = blankFieldAnswers(page.formInputs, identityOf(context))

  for (const input of page.formInputs) {
    if (
      input.name.startsWith('numberOfAnimalsQuantity') &&
      answers[input.name] === undefined
    ) {
      answers[input.name] = '1'
    }

    if (
      input.name.startsWith('numberOfPackages') &&
      answers[input.name] === undefined
    ) {
      answers[input.name] = '5'
    }
  }

  if (Object.keys(answers).length > 0) {
    return answers
  }

  return {
    'numberOfAnimalsQuantity-0': '1',
    'numberOfPackages-0': '5'
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
    consignmentDetails,
    identification,
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
