import { check, sleep } from 'k6'
import http from 'k6/http'
import { Counter, Trend } from 'k6/metrics'

import { STEP_ENDPOINTS } from '../config/journey-endpoints.js'
import { DOCUMENT_ISSUED_DAYS_AGO, DOCUMENT_SCAN } from '../config/test-data.js'
import { valueAtRandom } from '../lib/distributions.js'
import {
  DOCUMENT_KINDS,
  documentBytes,
  documentFilename,
  documentSizeBytes,
  scanHasSettled,
  scanWasRejected
} from '../lib/documents.js'
import { selectOptions, slashDateText } from '../lib/form-fill.js'
import { pagePath, pickFrom, saved } from './journey-pages.js'

const HTTP_OK = 200
const MS_PER_SECOND = 1000
const DOCUMENTS_SLUG = 'accompanying-documents'

const ENDPOINTS = STEP_ENDPOINTS['live-animals'].documents

const scanDuration = new Trend('document_scan_duration', true)
const documentsUploaded = new Counter('documents_uploaded')

// The backend accepts a document reference of letters and digits only.
const referenceFor = ({ vu, iteration }, number) =>
  `PERFDOC${vu}V${iteration}N${number}`

const answersFor = (context, page, reference) => ({
  accompanyingDocumentReference: reference,
  accompanyingDocumentType: pickFrom(
    context,
    selectOptions(page.formInputs, 'accompanyingDocumentType')
  ),
  accompanyingDocumentDateOfIssue: slashDateText(
    context.now,
    -DOCUMENT_ISSUED_DAYS_AGO
  ),
  action: 'add'
})

const fileFor = (context, reference) => {
  const { documentTypes, documentKilobytes } = context.journeyModel
  const kind = valueAtRandom(documentTypes, context.random())
  const size = documentSizeBytes(documentKilobytes, context.random())
  const bytes = documentBytes(kind, size)

  return http.file(
    bytes.buffer,
    documentFilename(kind, reference),
    DOCUMENT_KINDS[kind].contentType
  )
}

// A scan has settled once the page lists the document and nothing is pending.
const isScanned = (listed) =>
  Array.isArray(listed) && listed.length > 0 && scanHasSettled(listed)

const pollUntilScanned = (context, landed) => {
  const { walker, base } = context
  const statusPath = `${base}/${DOCUMENTS_SLUG}/status`
  const timeoutMs = DOCUMENT_SCAN.timeoutSeconds * MS_PER_SECOND
  let documents = walker.session.getJson(statusPath, ENDPOINTS.status)

  while (
    !isScanned(documents?.documents) &&
    Date.now() - landed.receivedAt < timeoutMs
  ) {
    sleep(DOCUMENT_SCAN.pollSeconds)
    documents = walker.session.getJson(statusPath, ENDPOINTS.status)
  }

  return documents?.documents
}

const awaitScan = (context, landed) => {
  const documents = pollUntilScanned(context, landed)

  scanDuration.add(Date.now() - landed.receivedAt)
  check(documents, {
    'document scan settled': isScanned,
    'document scan not rejected': (listed) => !scanWasRejected(listed)
  })
}

const isUploaded = ({ base }, response) =>
  response.status === HTTP_OK &&
  response.url.split(/[?#]/)[0].endsWith(`${base}/${DOCUMENTS_SLUG}`)

const uploadOne = (context, page, number) => {
  const reference = referenceFor(context, number)
  const landed = context.walker.upload(
    page,
    answersFor(context, page, reference),
    fileFor(context, reference),
    ENDPOINTS.upload,
    (uploaded) => {
      if (isUploaded(context, uploaded)) {
        awaitScan(context, uploaded)
      }
    }
  )

  check(landed, {
    'document uploaded': (response) => isUploaded(context, response)
  })

  if (isUploaded(context, landed)) {
    documentsUploaded.add(1)
  }

  return landed
}

/**
 * The live-animals documents step: uploads the notification's documents, then continues.
 *
 * Each document goes through the frontend to the real cdp-uploader and its
 * virus scan. The step then polls the frontend's status route, as the page's
 * script does every 3 seconds, until nothing is pending, and records how long
 * the scan took in `document_scan_duration`. With no documents the step only
 * opens the page and continues.
 */
export const documentsStep = {
  name: 'documents',
  run: (context, landed) => {
    const { walker } = context
    let page = walker.reach(
      landed,
      pagePath(context, DOCUMENTS_SLUG),
      ENDPOINTS.open
    )

    for (let number = 1; number <= context.plan.documents; number += 1) {
      page = uploadOne(context, page, number)
    }

    return saved(
      'documents',
      walker.submit(page, { action: 'continue' }, ENDPOINTS.save)
    )
  }
}
