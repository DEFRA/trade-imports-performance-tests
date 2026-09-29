import { check, sleep } from 'k6'
import http from 'k6/http'

import { resolveServiceUrl } from '../config/target.js'

const baseUrl = resolveServiceUrl(__ENV, 'trade-imports-ins-frontend')

export const options = {
  vus: 1,
  iterations: 5,
  thresholds: {
    'http_req_duration{name:health}': ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99']
  }
}

export default function () {
  const response = http.get(`${baseUrl}/health`, { tags: { name: 'health' } })

  check(response, {
    'health returns 200': (r) => r.status === 200
  })

  sleep(1)
}
