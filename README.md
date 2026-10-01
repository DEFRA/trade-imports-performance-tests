# trade-imports-performance-tests

k6 performance test suites for the trade imports services, run on the Core Delivery Platform (CDP).

CDP builds this repo into a Docker image. The CDP Portal runs the image, and the image runs one k6 suite, then publishes the report to S3 so the Portal can show it.

- [Layout](#layout)
- [Run locally](#run-locally)
- [Run in CDP](#run-in-cdp)
- [Smoke run on pull requests](#smoke-run-on-pull-requests)
- [Traffic model](#traffic-model)
- [Request mix](#request-mix)
- [Thresholds](#thresholds)
- [Add a suite](#add-a-suite)
- [Licence](#licence)

## Layout

| Path                 | What it holds                                                                                                                                                                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/suites/`        | One k6 script per suite, named `<suite>.k6.js`                                                                                                                                                                                                                                                             |
| `src/config/`        | Environment and service URLs, the endpoint catalogue, thresholds and smoke values, the traffic model (`traffic.js`), the journeys' endpoint names (`journey-endpoints.js`) and the request-mix classes (`request-mix.js`)                                                                                  |
| `src/lib/`           | Pure helpers with unit tests, shared by suites, with no k6 imports                                                                                                                                                                                                                                         |
| `src/k6/`            | k6-only modules: the browser-like session, the notification driver (`journeys.js`), the two journeys' steps (`live-animals.js`, `high-risk-plants.js`), the front door (`front-door.js`), shared step helpers (`journey-pages.js`), page requests and the request mix (`pages.js`), and the readiness wait |
| `entrypoint.sh`      | What the image runs: one suite, then the S3 upload                                                                                                                                                                                                                                                         |
| `Dockerfile`         | The image CDP runs, based on `grafana/k6` with the AWS CLI added                                                                                                                                                                                                                                           |
| `compose.yml`        | Local runs: LocalStack for S3 and `target`, a stand-in service that has `/health`                                                                                                                                                                                                                          |
| `compose/`           | LocalStack set-up and the stand-in service's nginx config                                                                                                                                                                                                                                                  |
| `.github/workflows/` | Pull request checks, and the CDP publish on merge to `main`                                                                                                                                                                                                                                                |

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

This runs `src/suites/smoke.k6.js` from source against the trade imports workspace stack, which must already be running. Start it with `tim docker up`, not `tim docker dev`. `up` is production-like: template caching is on and sign-in goes through the Defra ID stub. `dev` turns caching off, so it measures something other than CDP. The build loop's gate runs this same suite against a `--dev` stack, so its timings are not production-like; the pull-request run in `smoke.yml` is the production-like one.

The run waits for the stack to be functionally ready (up to 5 minutes), makes sure the `Perf Test Holding` address exists in the address book, then runs 4 open-model scenarios at once for a 2 minute smoke window. Each starts iterations at a stated rate, so a slowing service keeps receiving the load it would in production. The smoke profile pre-allocates 5 virtual users across the 4 scenarios and can grow to 10 if the service slows:

- `live-animals` and `high-risk-plants` each run one notification across 1 or 2 sessions, in the order a user fills the journey in. Every session signs in afresh through INS, and the last one submits through the declaration page, reads the notification back from the dashboard and hub, then amends it and either cancels the amendment or resubmits it. The first captured save is replayed against the backend
- `ins-front-door` runs dashboard-only sessions: sign in, then keep checking the INS dashboard
- `ins-address-book` runs address-book sessions: add an address, find it, view it, edit it and delete it, so the book does not grow

The smoke profile starts 20 notifications an hour for each journey, one in the two-minute window and compresses a session to 1 minute, so the gate sees save and return, submit, read-back, amendment and cancel-amendment in about 2.5 minutes. The design-figure rates are in `src/config/traffic.js` and no suite runs them yet.

It reaches the stack through `host.docker.internal` and sets `ENVIRONMENT=local`, so it can never reach a CDP environment. It prints k6's summary and uploads nothing. It exits with k6's exit code, so a breached threshold exits with code 99.

Tear down afterwards:

```bash
npm run k6:down
```

This removes only this repo's containers. It does not stop the workspace stack.

## Run in CDP

Merging to `main` publishes the image. Run it from the CDP Portal.

The image reads these environment variables:

| Variable                 | Set by          | Purpose                                                                                                                                                              |
| ------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`            | CDP Portal      | The environment to test, for example `perf-test`. Suites build service URLs from it. `prod` is refused                                                               |
| `RESULTS_OUTPUT_S3_PATH` | CDP Portal      | Where the report goes. The run fails if it is not set                                                                                                                |
| `S3_ENDPOINT`            | image           | Defaults to AWS S3 in `eu-west-2`. Compose points it at LocalStack                                                                                                   |
| `TEST_SUITE`             | you, optionally | The suite to run, as a file name in `src/suites/` without `.k6.js`. Defaults to `smoke` in `dev` and `test`, and to `health-check` everywhere else                   |
| `<SERVICE_NAME>_URL`     | you, optionally | Overrides a service's URL, for example `TRADE_IMPORTS_INS_FRONTEND_URL`                                                                                              |
| `LOCALHOST_ALIAS`        | Compose         | The host a container uses for the machine's `localhost`, for example `host.docker.internal`                                                                          |
| `AUTH_PASSWORD`          | you, optionally | The Defra ID stub's password. Defaults to `Password123`. In CDP, set it as a test-suite secret in the Portal when the stub in that environment uses another password |
| `TRAFFIC_MODEL`          | you, optionally | JSON laid over the traffic model defaults and the smoke profile — see Traffic model                                                                                  |

Without an override, a service's URL is `https://<service-name>.<ENVIRONMENT>.cdp-int.defra.cloud`. When `ENVIRONMENT` is `local`, it is the workspace Docker stack's host port for the service, on `localhost` or on `LOCALHOST_ALIAS` when that is set.

The image writes 2 files and copies them to `RESULTS_OUTPUT_S3_PATH`:

- `index.html` — the k6 web dashboard report, which the Portal shows
- `summary.json` — k6's end-of-test summary

The image exits with k6's exit code, so a failed threshold (code 99) fails the run. The report is still published first. The image exits with code 1 if `RESULTS_OUTPUT_S3_PATH` is not set, the suite does not exist, the report was not written or the upload failed.

### Smoke run in CDP dev and test

The same smoke suite runs in CDP `dev` and `test`, chosen by `ENVIRONMENT` alone. A Portal run with no variables set runs `smoke` there, and the log includes `Running suite smoke in dev` (or `test`).

- Sign-in goes through the real OIDC flow against the Defra ID stub deployed in that environment, with the secure cookies and the CSRF crumb the platform requires. Every session checks `sign-in went through Defra ID` when it opens the INS dashboard, so a run that bypassed Defra ID fails the `checks` threshold.
- SNS and SQS are the CDP-provisioned ones, reached through animals saves, which publish a notification event.
- cdp-uploader is not exercised yet. The smoke run uploads no document, so it arrives with the document increment.
- Systems outside the INS boundary answer from the stubs deployed in that environment.
- `prod` is refused: the run fails at start without a report.
- The report (`index.html` and `summary.json`) is published with every run, even when a threshold fails.

To run it after each deploy to `dev`, set an automatic test run in the CDP Portal, on the `trade-imports-performance-tests` test suite page, for environment `dev`. Trigger it on deployments of `trade-imports-ins-frontend`, `trade-imports-animals-frontend`, `trade-imports-plants-frontend`, `trade-imports-animals-backend`, `trade-imports-plants-backend` and `trade-imports-reference-data`. This is Portal configuration, not code.

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

## Traffic model

The load is a model, held as values in `src/config/traffic.js` and never fixed in the scripts. Every figure is a working figure from the INS volumetrics page and is still to be confirmed, so a revised figure changes a value, not a script.

| Parameter                                        | Default | Source                                 | Smoke |
| ------------------------------------------------ | ------- | -------------------------------------- | ----- |
| `liveAnimals.notificationsPerHour`               | 44      | design target, section 6.3             | 20    |
| `liveAnimals.pagesPerNotification`               | 40      | AG1                                    | 40    |
| `liveAnimals.sessionsPerNotification`            | 1.5     | A2                                     | 1.5   |
| `liveAnimals.sessionMinutes`                     | 20      | AG2                                    | 1     |
| `liveAnimals.amendShare`                         | 1       | every notification is amended          | 1     |
| `liveAnimals.cancelAmendShare`                   | 0.5     | share of amendments that are cancelled | 1     |
| `highRiskPlants.notificationsPerHour`            | 36      | design target, section 7.3             | 20    |
| `highRiskPlants.pagesPerNotification`            | 50      | PP1                                    | 50    |
| `highRiskPlants.sessionsPerNotification`         | 1.5     | A2                                     | 1.5   |
| `highRiskPlants.sessionMinutes`                  | 25      | PP2                                    | 1     |
| `highRiskPlants.amendShare`                      | 1       | every notification is amended          | 1     |
| `highRiskPlants.cancelAmendShare`                | 0.5     | share of amendments that are cancelled | 0     |
| `frontDoor.corePagesPerJourneySession`           | 6       | C1                                     | 6     |
| `frontDoor.dashboardOnlySessionsPerNotification` | 1       | C2                                     | 1     |
| `frontDoor.dashboardOnlySessionMinutes`          | 5       | C3                                     | 0.25  |
| `frontDoor.pagesPerDashboardOnlySession`         | 8       | C4                                     | 8     |
| `frontDoor.addressBookSessionsPerNotification`   | 0.25    | interim, no volumetrics figure         | 0.25  |
| `mix.dashboardReadShareTarget`                   | 0.25    | D7                                     | 0.25  |
| `duration`                                       | `2m`    | the length of the run                  | `2m`  |

Override any value with `TRAFFIC_MODEL`, a JSON object laid over the defaults and the smoke profile. An unknown key, bad JSON or a value that is not allowed fails the run at start and names the key. The effective model is logged in `setup()`.

```bash
TRAFFIC_MODEL='{"liveAnimals":{"pagesPerNotification":45}}' npm run test:docker-compose
```

In a CDP Portal run, set `TRAFFIC_MODEL` to the same JSON as an environment variable on the run.

Think time between pages is the session length divided by the pages in a session that are followed by a wait, where a session has the pages per notification divided by the sessions per notification, plus the INS core pages, less the sign-in, which has no wait. Each wait is drawn evenly from half to one and a half times that mean. The session length is spread over the journey pages and the INS core pages of the session (the dashboard and status checks), so the waits add up to the session length. Sessions per notification are spread so the average is exactly the figure: 1.5 gives 2, 1, 2, 1 and so on, and the first notification has 2, so a smoke run always exercises save and return. The amend and cancel choices are spread the same way. A notification that needs fewer pages than the target re-edits answered pages until it reaches it, and one that needs more is left as it is and the pages it took are reported.

## Request mix

Every page request is recorded under one traffic class: `sign-in`, `dashboard-read` (the INS dashboard and both journey dashboards), `journey` (drafting, check answers before submit, the declaration), `post-submission-read` (the hub and notification view after submit), `amendment` (everything done while amending) and `address-book`. A page request is one navigation, so redirect hops and backend calls are not counted. A sign-in is recorded as a page request of its own, alongside the dashboard read it leads to. That is how the front door's core-page (C1) and dashboard-only session (C4) figures are counted, and it counts in the `dashboard_read_share` denominator.

| Metric                   | What it shows                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `dashboard_read_share`   | The share of page requests that are dashboard reads, printed in k6's end-of-test summary |
| `page_requests`          | Page requests, tagged by `traffic_class`                                                 |
| `post_submission_reads`  | Reads after submit                                                                       |
| `amendment_pages`        | Pages requested while amending                                                           |
| `pages_per_notification` | Journey pages one notification took, by scenario                                         |
| `session_seconds`        | How long a user session lasted, by scenario                                              |

`setup()` logs the target, `Request mix target: dashboard reads 25% of page requests (D7)`, so the achieved share sits beside it. The mix is reported, not gated: the share comes from the pages the frontends need, and a threshold on it would be run-wide, while every threshold here is scoped to a scenario, and response times to an endpoint as well.

## Thresholds

Thresholds live in `src/config/thresholds.js`. The interim values come from the open question c-004 and DR-EUDP-005 section 4.7, until INS sets its own:

| What                        | Limit                                                                      |
| --------------------------- | -------------------------------------------------------------------------- |
| Backend API response time   | P95 under 200ms, P99 under 1,200ms                                         |
| Frontend page response time | P95 under 2,000ms, P99 under 5,000ms                                       |
| Failed requests             | Under 1%                                                                   |
| Checks                      | More than 99% pass, so a failed check fails the run                        |
| Dropped iterations          | Under 1 per scenario, so a run that could not apply its arrival rate fails |

Every threshold is scoped to its scenario, and response times are also scoped to an endpoint tag from the catalogue in `src/config/endpoints.js`. Scoping to the scenario keeps the readiness wait in `setup()` out of the measurement. A breached response-time, failed-request or check threshold aborts the run, after a 30 second evaluation delay. Dropped iterations are judged at the end of the run: they do not abort it, but they fail it.

## Add a suite

1. Add `src/suites/<suite>.k6.js`. Name it after the test type and what it covers, for example `load-notification-submit.k6.js`.
2. Get service URLs from `resolveServiceUrl(__ENV, '<service-name>')` in `src/config/target.js`.
3. Give each scenario its thresholds with `scenarioThresholds` in `src/config/thresholds.js`. Tag requests with an endpoint from the catalogue in `src/config/endpoints.js`, which also sets the `name` tag. Follow the workspace's k6 best practices.
4. Put any logic worth testing in `src/config/` (or a new folder under `src/`) with a `*.test.js` beside it.
5. Run it with `npm run k6:local -- run --no-usage-report src/suites/<suite>.k6.js`.
6. To make CDP run it by default in an environment, change `default_suite` in `entrypoint.sh`. Otherwise set `TEST_SUITE` to `<suite>` on the run.

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
