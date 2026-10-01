const BYTES_PER_KILOBYTE = 1000
const PDF_HEADER = '%PDF-1.4\n'
const PDF_TRAILER = '\n%%EOF\n'
const JPEG_HEADER = [
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00
]
const JPEG_TRAILER = [0xff, 0xd9]
const PDF_PADDING_BYTE = 0x20
const JPEG_PADDING_BYTE = 0x00
const SCAN_PENDING = 'PENDING'
const SCAN_REJECTED = 'REJECTED'

const charCodesOf = (text) =>
  [...text].map((character) => character.charCodeAt(0))

export const DOCUMENT_KINDS = Object.freeze({
  pdf: Object.freeze({
    extension: 'pdf',
    contentType: 'application/pdf',
    header: charCodesOf(PDF_HEADER),
    trailer: charCodesOf(PDF_TRAILER),
    padding: PDF_PADDING_BYTE
  }),
  jpeg: Object.freeze({
    extension: 'jpg',
    contentType: 'image/jpeg',
    header: JPEG_HEADER,
    trailer: JPEG_TRAILER,
    padding: JPEG_PADDING_BYTE
  })
})

/**
 * Draws a document's size in bytes from a range of kilobytes.
 *
 * A kilobyte is 1,000 bytes, as the animals frontend's upload limit counts.
 *
 * @param {{ min: number, max: number }} kilobytes - The range, in kilobytes.
 * @param {number} random - A number from 0 up to, not including, 1.
 * @returns {number} Whole bytes, from the range's minimum up to under its maximum.
 */
export const documentSizeBytes = ({ min, max }, random) =>
  Math.floor((min + (max - min) * random) * BYTES_PER_KILOBYTE)

/**
 * Builds the bytes of a document of one kind.
 *
 * It starts and ends like a real PDF or JPEG, and is padded in between. It is
 * never shorter than its header and trailer.
 *
 * @param {'pdf' | 'jpeg'} kind - A key of `DOCUMENT_KINDS`.
 * @param {number} size - The size in bytes.
 * @returns {Uint8Array} The document.
 */
export const documentBytes = (kind, size) => {
  const { header, trailer, padding } = DOCUMENT_KINDS[kind]
  const length = Math.max(size, header.length + trailer.length)
  const bytes = new Uint8Array(length).fill(padding)

  bytes.set(header, 0)
  bytes.set(trailer, length - trailer.length)

  return bytes
}

/**
 * Names a document's file.
 *
 * @param {'pdf' | 'jpeg'} kind - A key of `DOCUMENT_KINDS`.
 * @param {string} reference - The document's reference.
 * @returns {string} The file name, with the kind's extension.
 */
export const documentFilename = (kind, reference) =>
  `${reference}.${DOCUMENT_KINDS[kind].extension}`

/**
 * Tells whether every document's scan has finished, as the frontend's page does.
 *
 * @param {Array<{ scanStatus: string }>} documents - The status route's documents.
 * @returns {boolean} True for a list with nothing pending.
 */
export const scanHasSettled = (documents) =>
  Array.isArray(documents) &&
  documents.every(({ scanStatus }) => scanStatus !== SCAN_PENDING)

/**
 * Tells whether any scan rejected its document.
 *
 * @param {Array<{ scanStatus: string }>} documents - The status route's documents.
 * @returns {boolean} True when a document was rejected.
 */
export const scanWasRejected = (documents) =>
  Array.isArray(documents) &&
  documents.some(({ scanStatus }) => scanStatus === SCAN_REJECTED)
