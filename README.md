# trade-imports-performance-tests

k6 performance test suites for the trade imports services, run on the Core Delivery Platform (CDP).

CDP builds this repo into a Docker image. The CDP Portal runs the image, and the image runs one k6 suite, then publishes the report to S3 so the Portal can show it.

- [Layout](#layout)
- [Run locally](#run-locally)
- [Run in CDP](#run-in-cdp)
- [Smoke run on pull requests](#smoke-run-on-pull-requests)
- [Thresholds](#thresholds)
- [Add a suite](#add-a-suite)
- [Licence](#licence)

## Layout

| Path                 | What it holds                                                                     |
| -------------------- | --------------------------------------------------------------------------------- |
| `src/suites/`        | One k6 script per suite, named `<suite>.k6.js`                                    |
| `src/config/`        | Environment and service URLs, the endpoint catalogue, thresholds and smoke values |
| `src/lib/`           | Pure helpers with unit tests, shared by suites, with no k6 imports                |
| `src/k6/`            | k6-only modules: the browser-like session, the journeys and the readiness wait    |
| `entrypoint.sh`      | What the image runs: one suite, then the S3 upload                                |
| `Dockerfile`         | The image CDP runs, based on `grafana/k6` with the AWS CLI added                  |
| `compose.yml`        | Local runs: LocalStack for S3 and `target`, a stand-in service that has `/health` |
| `compose/`           | LocalStack set-up and the stand-in service's nginx config                         |
| `.github/workflows/` | Pull request checks, and the CDP publish on merge to `main`                       |

Suites import shared modules with relative paths. k6 and Vitest both load them, so keep them free of Node-only and k6-only APIs. Pass k6's `__ENV` in rather than reading it inside the module.

## Run locally

You need Docker and Node.js (the version in `.nvmrc`).

```bash
npm ci
npm run lint
npm run format:check
npm test
```

`npm test` runs the Vitest unit tests. It does not run k6.

### Run a suite from source

```bash
npm run k6:local
```

This runs `src/suites/health-check.k6.js` in the `grafana/k6` image against the stand-in service. It does not build the image or upload a report. To run another suite:

```bash
npm run k6:local -- run --no-usage-report src/suites/<suite>.k6.js
```

### Run the image as CDP does

```bash
npm run k6:image
```

This builds the image, runs it against the stand-in service and uploads the report to the `test-results` bucket in LocalStack. The command exits with the image's exit code.

### Run against the workspace Docker stack

```bash
npm run test:docker-compose
```

This runs `src/suites/smoke.k6.js` from source against the trade imports workspace stack, which must already be running. Start it with `tim docker up`, not `tim docker dev`. `up` is production-like: template caching is on and sign-in goes through the Defra ID stub. `dev` turns caching off, so it measures something other than CDP.

The run waits for the stack to be functionally ready (up to 5 minutes), then runs 3 scenarios at once for about 2 minutes with 5 virtual users in total:

- `ins-front-door` signs in to INS and opens the dashboard
- `live-animals` and `high-risk-plants` each create a draft through the frontend, save a page, read it back, replay the captured save against the backend, and read it back again

It reaches the stack through `host.docker.internal` and sets `ENVIRONMENT=local`, so it can never reach a CDP environment. It prints k6's summary and uploads nothing. It exits with k6's exit code, so a breached threshold exits with code 99.

Tear down afterwards:

```bash
npm run k6:down
```

This removes only this repo's containers. It does not stop the workspace stack.

## Run in CDP

Merging to `main` publishes the image. Run it from the CDP Portal.

The image reads these environment variables:

| Variable                 | Set by          | Purpose                                                                                        |
| ------------------------ | --------------- | ---------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`            | CDP Portal      | The environment to test, for example `perf-test`. Suites build service URLs from it            |
| `RESULTS_OUTPUT_S3_PATH` | CDP Portal      | Where the report goes. The run fails if it is not set                                          |
| `S3_ENDPOINT`            | image           | Defaults to AWS S3 in `eu-west-2`. Compose points it at LocalStack                             |
| `TEST_SUITE`             | image           | The suite to run, as a file name in `src/suites/` without `.k6.js`. Defaults to `health-check` |
| `<SERVICE_NAME>_URL`     | you, optionally | Overrides a service's URL, for example `TRADE_IMPORTS_INS_FRONTEND_URL`                        |
| `LOCALHOST_ALIAS`        | Compose         | The host a container uses for the machine's `localhost`, for example `host.docker.internal`    |
| `AUTH_PASSWORD`          | you, optionally | The Defra ID stub's password. Defaults to `Password123`                                        |

Without an override, a service's URL is `https://<service-name>.<ENVIRONMENT>.cdp-int.defra.cloud`. When `ENVIRONMENT` is `local`, it is the workspace Docker stack's host port for the service, on `localhost` or on `LOCALHOST_ALIAS` when that is set.

The image writes 2 files and copies them to `RESULTS_OUTPUT_S3_PATH`:

- `index.html` — the k6 web dashboard report, which the Portal shows
- `summary.json` — k6's end-of-test summary

The image exits with k6's exit code, so a failed threshold (code 99) fails the run. The report is still published first. The image exits with code 1 if `RESULTS_OUTPUT_S3_PATH` is not set, the suite does not exist, the report was not written or the upload failed.

## Smoke run on pull requests

`.github/workflows/smoke.yml` stands up the workspace stack without `--dev`, builds this image and runs it with `TEST_SUITE=smoke`. The check fails on any breached threshold. It uploads the k6 report as the `smoke-report` artifact.

It runs on every pull request that is ready for review. Draft pull requests skip it, and it runs when a draft is marked ready for review. Another repo's workflow can call it:

```yaml
smoke:
  uses: DEFRA/trade-imports-performance-tests/.github/workflows/smoke.yml@main
  with:
    branch: ${{ github.head_ref }}
```

The stubs answer without added delay, which is the zero-delay profile. The question the pull request run asks is whether the change made INS slower.

## Thresholds

Thresholds live in `src/config/thresholds.js`. The interim values come from the open question c-004 and DR-EUDP-005 section 4.7, until INS sets its own:

| What                        | Limit                                               |
| --------------------------- | --------------------------------------------------- |
| Backend API response time   | P95 under 200ms, P99 under 1,200ms                  |
| Frontend page response time | P95 under 2,000ms, P99 under 5,000ms                |
| Failed requests             | Under 1%                                            |
| Checks                      | More than 99% pass, so a failed check fails the run |

Every threshold is scoped to its scenario, and response times are also scoped to an endpoint tag from the catalogue in `src/config/endpoints.js`. Scoping to the scenario keeps the readiness wait in `setup()` out of the measurement. A breached threshold aborts the run, after a 30 second evaluation delay.

## Add a suite

1. Add `src/suites/<suite>.k6.js`. Name it after the test type and what it covers, for example `load-notification-submit.k6.js`.
2. Get service URLs from `resolveServiceUrl(__ENV, '<service-name>')` in `src/config/target.js`.
3. Give each scenario its thresholds with `scenarioThresholds` in `src/config/thresholds.js`. Tag requests with an endpoint from the catalogue in `src/config/endpoints.js`, which also sets the `name` tag. Follow the workspace's k6 best practices.
4. Put any logic worth testing in `src/config/` (or a new folder under `src/`) with a `*.test.js` beside it.
5. Run it with `npm run k6:local -- run --no-usage-report src/suites/<suite>.k6.js`.
6. To make CDP run it, change `TEST_SUITE` in the `Dockerfile` to `<suite>`.

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government licence v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of Her Majesty's Stationery Office (HMSO) to enable
information providers in the public sector to license the use and re-use of their information under a common open
licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.
