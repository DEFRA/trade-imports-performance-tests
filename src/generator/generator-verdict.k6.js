import { GENERATOR } from '../config/generator.js'
import {
  generatorLines,
  generatorVerdict,
  parseGeneratorSamples,
  vusMaxFrom
} from '../lib/generator.js'

const parsed = parseGeneratorSamples(open(__ENV.GENERATOR_SAMPLES))
const summary = __ENV.SUMMARY_EXPORT
  ? JSON.parse(open(__ENV.SUMMARY_EXPORT))
  : undefined
const verdict = generatorVerdict({
  parsed,
  vusMax: vusMaxFrom(summary),
  allowances: GENERATOR
})

export const options = { vus: 1, iterations: 1 }

export default function () {}

export function handleSummary() {
  return {
    stdout: `${generatorLines(verdict).join('\n')}\n`,
    ...(__ENV.GENERATOR_REPORT
      ? { [__ENV.GENERATOR_REPORT]: JSON.stringify(verdict, null, 2) }
      : {})
  }
}
