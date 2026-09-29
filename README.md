# trade-imports-performance-tests

k6 performance test suites for the trade imports services, run on the Core Delivery Platform (CDP).

CDP builds this repo into a Docker image. The CDP Portal runs the image, and the image runs one k6 suite, then publishes the report to S3 so the Portal can show it.

- [Layout](#layout)
- [Run locally](#run-locally)
- [Run in CDP](#run-in-cdp)
- [Add a suite](#add-a-suite)
- [Licence](#licence)

## Layout

| Path                 | What it holds                                                                     |
| -------------------- | --------------------------------------------------------------------------------- |
| `src/suites/`        | One k6 script per suite, named `<suite>.k6.js`                                    |
| `src/config/`        | Plain JavaScript modules shared by suites, with their unit tests (`*.test.js`)    |
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

This runs `src/suites/health-check.k6.js` from source against the trade imports workspace stack (`tim docker dev`), which must already be running. It calls the INS frontend's `/health` on host port 3002, through `host.docker.internal`. It sets `ENVIRONMENT=local` and the service URL override, so it can never reach a CDP environment. It prints k6's summary and uploads nothing. It exits with k6's exit code, so a breached threshold, or a stack that is not running, exits with code 99.

Tear down afterwards:

```bash
npm run k6:down
```

This removes only this repo's containers. It does not stop the workspace stack.

## Run in CDP

Merging to `main` publishes the image. Run it from the CDP Portal.

The image reads these environment variables:

| Variable                 | Set by          | Purpose                                                                                                       |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`            | CDP Portal      | The environment to test, for example `perf-test`. Suites build service URLs from it                           |
| `RESULTS_OUTPUT_S3_PATH` | CDP Portal      | Where the report goes. The run fails if it is not set                                                         |
| `S3_ENDPOINT`            | image           | Defaults to AWS S3 in `eu-west-2`. Compose points it at LocalStack                                            |
| `TEST_SUITE`             | image           | The suite to run, as a file name in `src/suites/` without `.k6.js`. Defaults to `health-check`                |
| `<SERVICE_NAME>_URL`     | you, optionally | Overrides a service's URL, for example `TRADE_IMPORTS_INS_FRONTEND_URL`. Needed when `ENVIRONMENT` is `local` |

Without an override, a service's URL is `https://<service-name>.<ENVIRONMENT>.cdp-int.defra.cloud`.

The image writes 2 files and copies them to `RESULTS_OUTPUT_S3_PATH`:

- `index.html` — the k6 web dashboard report, which the Portal shows
- `summary.json` — k6's end-of-test summary

The image exits with k6's exit code, so a failed threshold (code 99) fails the run. The report is still published first. The image exits with code 1 if `RESULTS_OUTPUT_S3_PATH` is not set, the suite does not exist, the report was not written or the upload failed.

## Add a suite

1. Add `src/suites/<suite>.k6.js`. Name it after the test type and what it covers, for example `load-notification-submit.k6.js`.
2. Get service URLs from `resolveServiceUrl(__ENV, '<service-name>')` in `src/config/target.js`.
3. Give it thresholds, tag requests with a `name`, and put a threshold on `checks`. Follow the workspace's k6 best practices.
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
