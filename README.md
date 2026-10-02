# trade-imports-performance-tests

k6 performance test suites for the trade imports services, run on the Core Delivery Platform (CDP).

CDP builds this repo into a Docker image. The CDP Portal runs the image, and the image runs one k6 suite, then publishes the report to S3 so the Portal can show it.

- [Layout](#layout)
- [Run locally](#run-locally)
- [Run in CDP](#run-in-cdp)
- [Smoke run on pull requests](#smoke-run-on-pull-requests)
- [Background volume](#background-volume)
- [Stub latency profiles](#stub-latency-profiles)
- [Traffic model](#traffic-model)
- [Request mix](#request-mix)
- [Thresholds](#thresholds)
- [Add a suite](#add-a-suite)
- [Licence](#licence)

## Layout

| Path                 | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/suites/`        | One k6 script per suite, named `<suite>.k6.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/config/`        | Environment and service URLs, the endpoint catalogue, thresholds and smoke values, the traffic model (`traffic.js`), the journeys' endpoint names (`journey-endpoints.js`), the request-mix classes (`request-mix.js`) the stated facts the test data rests on (`test-data.js`) the background volume's targets, scenarios and index line (`background-volume.js`) and the stubbed integrations, their profiles, flags and conformance interval (`stub-profiles.js`)                              |
| `src/lib/`           | Pure helpers with unit tests, shared by suites, with no k6 imports, including the stub profile lines and flags (`stub-profiles.js`)                                                                                                                                                                                                                                                                                                                                                               |
| `src/k6/`            | k6-only modules: the browser-like session, the notification driver (`journeys.js`), the two journeys' steps (`live-animals.js`, `high-risk-plants.js`), the live-animals documents step (`documents.js`), the front door (`front-door.js`), shared step helpers (`journey-pages.js`), page requests and the request mix (`pages.js`), the readiness wait, the background volume's reads and address creation (`background-volume.js`), and the stub profile reads and report (`stub-profiles.js`) |
| `entrypoint.sh`      | What the image runs: one suite, then the S3 upload                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `Dockerfile`         | The image CDP runs, based on `grafana/k6` with the AWS CLI added                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `compose.yml`        | Local runs: LocalStack for S3 and `target`, a stand-in service that has `/health`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `compose/`           | LocalStack set-up and the stand-in service's nginx config                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `.github/workflows/` | Pull request checks, and the CDP publish on merge to `main`                                                                                                                                                                                                                                                                                                                                                                                                                                       |

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

The run waits for the stack to be functionally ready (up to 5 minutes). Ready now includes the INS backend (the dashboard read model) and the address book answering a read, and the run then logs `Indexes: built ...`, because each of those services builds its indexes before it answers. It makes sure the `Perf Test Holding` address exists in the address book, logs `Background volume at start: ...` with each datastore's count, then runs 4 open-model scenarios at once for a 2 minute smoke window. Each starts iterations at a stated rate, so a slowing service keeps receiving the load it would in production. The smoke profile pre-allocates 5 virtual users across the 4 scenarios and can grow to 10 if the service slows:

- `live-animals` and `high-risk-plants` each run one notification across 1 or 2 sessions, in the order a user fills the journey in. Every session signs in afresh through INS, and the last one submits through the declaration page, reads the notification back from the dashboard and hub, then amends it and either cancels the amendment or resubmits it. The first captured save is replayed against the backend
- `ins-front-door` runs dashboard-only sessions: sign in, then keep checking the INS dashboard
- `ins-address-book` runs address-book sessions: add an address, find it, view it, edit it and delete it, so the book does not grow

The journeys draw their answers from the pages, not from fixed values: origin, port of entry, transit country, document type, plants category, genus and potato place of landing are each picked at random from the options the page offers. High-risk plants builds notifications of 1 to 50 commodity lines of each of its three commodity types, and live animals uploads 0 to 3 documents, so the smoke run uploads one document through the real cdp-uploader container and waits for its scan. See [Test data](#test-data).

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

| Variable                 | Set by          | Purpose                                                                                                                                                                |
| ------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`            | CDP Portal      | The environment to test, for example `perf-test`. Suites build service URLs from it. `prod` is refused                                                                 |
| `RESULTS_OUTPUT_S3_PATH` | CDP Portal      | Where the report goes. The run fails if it is not set                                                                                                                  |
| `S3_ENDPOINT`            | image           | Defaults to AWS S3 in `eu-west-2`. Compose points it at LocalStack                                                                                                     |
| `TEST_SUITE`             | you, optionally | The suite to run, as a file name in `src/suites/` without `.k6.js`. Defaults to `smoke` in `dev` and `test`, and to `health-check` everywhere else                     |
| `<SERVICE_NAME>_URL`     | you, optionally | Overrides a service's URL, for example `TRADE_IMPORTS_INS_FRONTEND_URL`                                                                                                |
| `LOCALHOST_ALIAS`        | Compose         | The host a container uses for the machine's `localhost`, for example `host.docker.internal`                                                                            |
| `AUTH_PASSWORD`          | you, optionally | The Defra ID stub's password. Defaults to `Password123`. In CDP, set it as a test-suite secret in the Portal when the stub in that environment uses another password   |
| `TRAFFIC_MODEL`          | you, optionally | JSON laid over the traffic model defaults and the smoke profile — see Traffic model                                                                                    |
| `STUB_PROFILE`           | you, optionally | The profile a run requires every stub-hosted integration to run, `zero-delay` or `sla`. Compose defaults it to `zero-delay`. Unset requires none and reports what runs |

Without an override, a service's URL is `https://<service-name>.<ENVIRONMENT>.cdp-int.defra.cloud`. When `ENVIRONMENT` is `local`, it is the workspace Docker stack's host port for the service, on `localhost` or on `LOCALHOST_ALIAS` when that is set.

The image writes 2 files and copies them to `RESULTS_OUTPUT_S3_PATH`:

- `index.html` — the k6 web dashboard report, which the Portal shows
- `summary.json` — k6's end-of-test summary

The image exits with k6's exit code, so a failed threshold (code 99) fails the run. The report is still published first. The image exits with code 1 if `RESULTS_OUTPUT_S3_PATH` is not set, the suite does not exist, the report was not written or the upload failed.

### Smoke run in CDP dev and test

The same smoke suite runs in CDP `dev` and `test`, chosen by `ENVIRONMENT` alone. A Portal run with no variables set runs `smoke` there, and the log includes `Running suite smoke in dev` (or `test`).

- Sign-in goes through the real OIDC flow against the Defra ID stub deployed in that environment, with the secure cookies and the CSRF crumb the platform requires. Every session checks `sign-in went through Defra ID` when it opens the INS dashboard, so a run that bypassed Defra ID fails the `checks` threshold.
- SNS and SQS are the CDP-provisioned ones, reached through animals saves, which publish a notification event.
- Live-animals uploads go through the real cdp-uploader and its antivirus scan, and the run measures the scan: `document_scan_duration` is judged against the upload page allowance of P99 under 60 seconds.
- Systems outside the INS boundary answer from the stubs deployed in that environment. In perf-test those stubs run the `sla` profile, because cdp-app-config sets `STUB_LATENCY_PROFILE=sla` for `trade-imports-stub` and `trade-imports-defra-id-stub`; a run there should set `STUB_PROFILE=sla`. That cdp-app-config change is made by a person, not by this repo.
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

The run requires `STUB_PROFILE=zero-delay`, and the stubs default to it, so a run against stubs with added delay fails at start. The question the pull request run asks is whether the change made INS slower.

## Background volume

An empty database answers every query fast, so a load run measures nothing useful until each environment holds a realistic background volume. The `background-volume` suite creates it, once per environment, and it is kept between runs.

| Datastore            | Target | Source                                                 |
| -------------------- | ------ | ------------------------------------------------------ |
| Live animals         | 42,000 | section 6.1 baseline: a year of notifications          |
| High-risk plants     | 34,000 | section 7.1 baseline: a year of notifications          |
| Address book         | 500    | interim, no source gives a figure                      |
| Dashboard read model | none   | filled from the events the journeys publish, see below |

The targets are one year at the 2025 baseline: 42,000 live-animals notifications (source section 6.1 Baseline, vol-130) and 34,000 high-risk-plants notifications (source section 7.1 Baseline, vol-144).

The animals backend, plants backend, INS backend and address book each set `spring.data.mongodb.auto-index-creation: true` in `src/main/resources/application.yml` and create no index any other way. Each builds its indexes at start-up, before it answers a read. That is why a run counts its indexes as built once every service has answered.

Everything is created through the frontends' own save routes, as the one stubbed user. Each notification is one run of the same journey driver as journey traffic, with the same commodity types, commodity lines, origins, species, amendment shares and cancelled shares, so the volume is varied as journey traffic is. Each address goes through the INS add-address form.

Run it once per environment:

```bash
TEST_SUITE=background-volume   # CDP Portal, on the run
npm run test:docker-compose:background-volume   # workspace Docker stack
```

- It tops up to the target. It counts what is there, creates only the shortfall and never deletes, so a second run creates nothing new once the target is met.
- It continues the spread where the last run stopped, so the whole background set follows the shares as if it had been created in one run.
- It is not a measurement. It waits no think time, skips the backend replay of the first save and adds no uploaded documents: the document store's volume is a separate figure (section 5.5 row 4), and uploading a year of files of up to 5MB through cdp-uploader is not what this run is for. The thresholds gate correctness only: failed requests, failed checks and dropped iterations.
- Creating a year takes hours, not minutes. `backgroundVolume.maxCreatedPerRun` limits what one run creates, so creation can be split across runs, for example `TRAFFIC_MODEL='{"backgroundVolume":{"maxCreatedPerRun":5000}}'`. A run that cannot finish its batch in `backgroundVolume.maxDuration` fails on dropped iterations, and the next run carries on.
- Where a CDP environment's notification expiry sweep is on, the sweep removes background notifications and the volume shrinks. The next background run tops it up.
- The dashboard read model holds only what the journeys publish. Live animals publishes events and high-risk plants does not yet (pbe-022), so the read model will hold fewer than the sum of the two targets. Each run reports the real figure and claims no target for it.

Every run states the volume it started with: `Background volume at start: live-animals 12 of 42000, high-risk-plants 9 of 34000, dashboard-read-model 12, address-book 3 of 500`. It also records each count in the `background_volume` metric. The background run also logs `Background volume at end: ...` and `Created this run: ...`.

Before any measurement, a run waits for the animals backend, the plants backend, the INS backend (the dashboard read model) and the address book to answer a read, then logs `Indexes: built ...`. Each of those services builds its indexes at start-up before it answers a request (Spring Data auto-index-creation), so an answer means its indexes are built. A service that never answers fails the run in `setup()` before anything is measured. This confirms the indexes that exist are built. It adds none.

## Stub latency profiles

A stub that answers at once makes INS look faster than it will be. Each system outside the INS boundary that an INS service calls today has a stand-in with its own latency profile:

| Integration         | Stands in for                                          | Hosted by                                                                                                    |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `defra-id`          | Defra ID: OIDC discovery, token and signing keys       | `trade-imports-defra-id-stub`                                                                                |
| `trade-token`       | The Trade token endpoint called before MDM             | `trade-imports-stub`                                                                                         |
| `mdm`               | MDM reference data: countries and border control posts | `trade-imports-stub`                                                                                         |
| `azure-service-bus` | Azure Service Bus, the only route to Dynamics and PIMS | No stub service. Locally the workspace stack's toxiproxy in front of the emulator; in CDP, CDP configuration |

SNS, SQS and cdp-uploader are real everywhere and are never profiled.

Each stub answers with one of two profiles, chosen when it starts:

- `zero-delay` adds no delay. It is the default, and what script development and the pull request smoke run use.
- `sla` delays each answer by a draw from a lognormal distribution fitted to the integration's targets: the median matched exactly and the tail fitted to p95 and p99 by least squares in log space. The interim targets are p50 100ms, p95 400ms and p99 1,000ms, which fit to p95 470ms and p99 892ms. Every design-target, breakpoint and resilience scenario runs on `sla`.

Azure Service Bus starts at zero added delay, because section 9.5 gives no figure for it.

Each stub reports its profiles at `GET /latency-profiles`: the interface each represents, its owner, the service level it was derived from, whether it is agreed, when it was last conformed, the targets and the latency the stub actually answered with. The suites read both stubs at the start and the end of a run, and clear each stub's answered latencies (`DELETE /latency-profiles/answered`) straight after the start read, so the end figures cover only that run. A stub that answers 404 or 405 to the clear predates profiles and is left alone. The summary prints `stub_latency_answered_count` per stub-hosted integration, and when it is 0 the stub answered no calls, so its answered p50/p95/p99 (shown as 0) mean nothing. They log:

```
Stub profile: mdm (trade-imports-stub) runs sla, targets p50 100ms, p95 400ms, p99 1000ms (lognormal fit p95 470ms, p99 892ms); MDM reference data through APIM: countries and border control posts; owner MDM / data platform team; from Interim (c-011 default): §9.5 MDM through APIM latency is TBC; never conformed; flags: UNAGREED, CONFORMANCE OVERDUE
Stub latency answered: mdm (trade-imports-stub) p50 98ms, p95 460ms, p99 880ms over 240 calls, beside targets p50 100ms, p95 400ms, p99 1000ms
```

A profile is flagged `unagreed` until it is agreed, which is every interim profile. A profile is flagged overdue when it has never been conformed, its date is malformed or after the run, or it was last conformed more than 7 days before the run (the volumetrics decision says stub profiles are re-checked weekly or per release). A stub that answers 404 predates profiles and adds no delay, so it is reported as `NOT REPORTED` and treated as `zero-delay`.

The summary carries three gauges, each with reporting-only thresholds (`value>=0`) so they print:

| Metric                 | Tags                                                                               | What it shows                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `stub_profile`         | `integration`, `profile`                                                           | 1 for the profile the integration ran (`zero-delay`, `sla`, `not-reported`), 0 for the others |
| `stub_profile_flagged` | `integration`, `flag`                                                              | 1 or 0 for `unagreed` and `conformance-overdue`                                               |
| `stub_latency`         | `integration`, `source` (`target` or `answered`), `quantile` (`p50`, `p95`, `p99`) | The targets, and the latency the stub answered with, in milliseconds                          |

Setting `STUB_PROFILE` makes the smoke run require that profile: it stops at start with `Stub profiles do not match STUB_PROFILE=<profile>` when a stub-hosted integration runs another one. Azure Service Bus is never checked.

## Traffic model

The load is a model, held as values in `src/config/traffic.js` and never fixed in the scripts. Every figure is a working figure from the INS volumetrics page and is still to be confirmed, so a revised figure changes a value, not a script.

| Parameter                                        | Default  | Source                                                | Smoke |
| ------------------------------------------------ | -------- | ----------------------------------------------------- | ----- |
| `liveAnimals.notificationsPerHour`               | 44       | design target, section 6.3                            | 20    |
| `liveAnimals.pagesPerNotification`               | 40       | AG1                                                   | 40    |
| `liveAnimals.sessionsPerNotification`            | 1.5      | A2                                                    | 1.5   |
| `liveAnimals.sessionMinutes`                     | 20       | AG2                                                   | 1     |
| `liveAnimals.amendShare`                         | 0.2      | c-012: share of notifications amended                 | 1     |
| `liveAnimals.cancelAmendShare`                   | 0.05     | c-012: share of amendments cancelled                  | 1     |
| `liveAnimals.documentsPerNotification`           | buckets  | c-012: 0–3 documents, mean 1                          | same  |
| `liveAnimals.documentKilobytes`                  | 100–5000 | c-012: 100KB to 5MB, under the 10MB cap               | same  |
| `liveAnimals.documentTypes`                      | buckets  | c-012: PDF or JPEG, 50% each                          | same  |
| `highRiskPlants.notificationsPerHour`            | 36       | design target, section 7.3                            | 20    |
| `highRiskPlants.pagesPerNotification`            | 50       | PP1                                                   | 50    |
| `highRiskPlants.sessionsPerNotification`         | 1.5      | A2                                                    | 1.5   |
| `highRiskPlants.sessionMinutes`                  | 25       | PP2                                                   | 1     |
| `highRiskPlants.amendShare`                      | 0.2      | c-012: share of notifications amended                 | 1     |
| `highRiskPlants.cancelAmendShare`                | 0.05     | c-012: share of amendments cancelled                  | 0     |
| `highRiskPlants.commodityLinesPerNotification`   | buckets  | NFR-VOL-PP-07: 50% 1–3, 30% 4–10, 15% 11–25, 5% 26–50 | same  |
| `highRiskPlants.commodityTypes`                  | buckets  | interim even split, no volumetrics figure             | same  |
| `addressBook.worstCaseSearchShare`               | 0.25     | interim, no volumetrics figure                        | 1     |
| `frontDoor.corePagesPerJourneySession`           | 6        | C1                                                    | 6     |
| `frontDoor.dashboardOnlySessionsPerNotification` | 1        | C2                                                    | 1     |
| `frontDoor.dashboardOnlySessionMinutes`          | 5        | C3                                                    | 0.25  |
| `frontDoor.pagesPerDashboardOnlySession`         | 8        | C4                                                    | 8     |
| `frontDoor.addressBookSessionsPerNotification`   | 0.25     | interim, no volumetrics figure                        | 0.25  |
| `mix.dashboardReadShareTarget`                   | 0.25     | D7                                                    | 0.25  |
| `backgroundVolume.liveAnimalsNotifications`      | 42000    | section 6.1, vol-130                                  | same  |
| `backgroundVolume.highRiskPlantsNotifications`   | 34000    | section 7.1, vol-144                                  | same  |
| `backgroundVolume.addressBookEntries`            | 500      | interim, no volumetrics figure                        | same  |
| `backgroundVolume.maxCreatedPerRun`              | 42000    | the largest target, so a run creates the whole gap    | same  |
| `backgroundVolume.virtualUsers`                  | 10       | interim                                               | same  |
| `backgroundVolume.maxDuration`                   | `24h`    | interim                                               | same  |
| `duration`                                       | `2m`     | the length of the run                                 | `2m`  |

The smoke run reads the `backgroundVolume` targets only to report them beside the counts.

Override any value with `TRAFFIC_MODEL`, a JSON object laid over the defaults and the suite's profile. An unknown key, bad JSON or a value that is not allowed fails the run at start and names the key. The effective model is logged in `setup()`.

```bash
TRAFFIC_MODEL='{"liveAnimals":{"pagesPerNotification":45}}' npm run test:docker-compose
```

In a CDP Portal run, set `TRAFFIC_MODEL` to the same JSON as an environment variable on the run.

### Test data

Each notification draws its content from distributions held in the traffic model, so the run does not resubmit one static notification.

- A distribution is a list of buckets: `{ share, min, max }` for a count and `{ share, value }` for a value. The shares add up to 1. `TRAFFIC_MODEL` replaces a distribution whole, for example `'{"highRiskPlants":{"commodityLinesPerNotification":[{"share":1,"min":50,"max":50}]}}'` makes every plants notification a 50-line one.
- Buckets are spread over notifications, not drawn by chance, so over 100 plants notifications exactly 5 are in the 26–50 bucket, and the first notification in that bucket has exactly 50 lines. A run of 8 or more plants notifications always includes the 50-line large-consignment case. If a frontend refuses a 50-line save (the payload limit, req-068), the `commodity-line saved` check fails and the run fails: the case is reported, not dropped.
- High-risk plants splits its load by commodity type, which is its notification type. Potatoes, and wood and cut trees, ask different pages from plants for planting, so those steps apply only to the types that have them. Every notification is counted in `notifications_started`, tagged `notification_type`.
- Live-animals species vary within the Cow commodity, the only one whose pages match the step list. Horse, cat, dog and fish are not covered.
- Plants origins are drawn from the page's options, narrowed to the countries every category of the commodity type accepts. Plants commodity codes stay free text, since the form offers no list.
- Documents are PDF or JPEG files built to the stated size, under the 10MB cap. The scan is timed from the upload response to the first status poll with nothing pending, polling every 3 seconds as the browser does. A scan still pending after 120 seconds is recorded as 120,000ms and fails `document scan settled`.
- The worst-case address search is a 255-character term (the longest searchable field) that matches no address, so the address book scans every address of the organisation. A share of notifications runs one on their first picker, and the same share of INS address-book sessions runs one on the list page.
- Every virtual user signs in as the one stubbed user, so all addresses are in one organisation: the heaviest case for the dashboard and address-book queries.
- When `ENVIRONMENT` is `local`, `setup()` logs the stand-ins the results depend on: floci for SNS and SQS, and the stack's cdp-uploader container with a mock antivirus scan that takes 3 seconds. The scan latency measured locally is the mock's, not CDP's.

Think time between pages is the session length divided by the pages in a session that are followed by a wait, where a session has the pages per notification divided by the sessions per notification, plus the INS core pages, less the sign-in, which has no wait. Each wait is drawn evenly from half to one and a half times that mean. The session length is spread over the journey pages and the INS core pages of the session (the dashboard and status checks), so the waits add up to the session length. Sessions per notification are spread so the average is exactly the figure: 1.5 gives 2, 1, 2, 1 and so on, and the first notification has 2, so a smoke run always exercises save and return. The amend and cancel choices are spread the same way. A notification that needs fewer pages than the target re-edits answered pages until it reaches it, and one that needs more is left as it is and the pages it took are reported.

## Request mix

Every page request is recorded under one traffic class: `sign-in`, `dashboard-read` (the INS dashboard and both journey dashboards), `journey` (drafting, check answers before submit, the declaration), `post-submission-read` (the hub and notification view after submit), `amendment` (everything done while amending) and `address-book`. A page request is one navigation, so redirect hops and backend calls are not counted. A sign-in is recorded as a page request of its own, alongside the dashboard read it leads to. That is how the front door's core-page (C1) and dashboard-only session (C4) figures are counted, and it counts in the `dashboard_read_share` denominator.

| Metric                   | What it shows                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `dashboard_read_share`   | The share of page requests that are dashboard reads, printed in k6's end-of-test summary  |
| `page_requests`          | Page requests, tagged by `traffic_class`                                                  |
| `post_submission_reads`  | Reads after submit                                                                        |
| `amendment_pages`        | Pages requested while amending                                                            |
| `pages_per_notification` | Journey pages one notification took, by scenario                                          |
| `session_seconds`        | How long a user session lasted, by scenario                                               |
| `notifications_started`  | Notifications started, tagged by `notification_type`                                      |
| `document_scan_duration` | Milliseconds from a document's upload response until its scan settled                     |
| `background_volume`      | The background volume each datastore held when the run started, tagged by `datastore`     |
| `stub_profile`           | The latency profile each stubbed integration ran, tagged by `integration` and `profile`   |
| `stub_profile_flagged`   | Whether each profile is unagreed or overdue, tagged by `integration` and `flag`           |
| `stub_latency`           | Each stub's target and answered latency, tagged by `integration`, `source` and `quantile` |

`setup()` logs the target, `Request mix target: dashboard reads 25% of page requests (D7)`, so the achieved share sits beside it. The mix is reported, not gated: the share comes from the pages the frontends need, and a threshold on it would be run-wide, while every threshold here is scoped to a scenario, and response times to an endpoint as well.

## Thresholds

Thresholds live in `src/config/thresholds.js`. The interim values come from the open question c-004 and DR-EUDP-005 section 4.7, until INS sets its own:

| What                        | Limit                                                                      |
| --------------------------- | -------------------------------------------------------------------------- |
| Backend API response time   | P95 under 200ms, P99 under 1,200ms                                         |
| Frontend page response time | P95 under 2,000ms, P99 under 5,000ms                                       |
| Upload page response time   | P99 under 60,000ms (section 4.7: pages that upload and scan a document)    |
| Document scan               | P99 under 60,000ms, judged at the end of the run (section 4.7, SYN-28/29)  |
| Failed requests             | Under 1%                                                                   |
| Checks                      | More than 99% pass, so a failed check fails the run                        |
| Dropped iterations          | Under 1 per scenario, so a run that could not apply its arrival rate fails |

Every threshold is scoped to its scenario, and response times are also scoped to an endpoint tag from the catalogue in `src/config/endpoints.js`. Scoping to the scenario keeps the readiness wait in `setup()` out of the measurement. A breached response-time, failed-request or check threshold aborts the run, after a 30 second evaluation delay. Dropped iterations are judged at the end of the run: they do not abort it, but they fail it. So is the document scan: a slow scan fails the run rather than cutting it short. The `notifications_started` thresholds (`count>=0`) are reporting-only and can never fail: they exist so the summary prints the split by notification type. The `background_volume` thresholds (`value>=0`) are reporting-only in the same way: they print each datastore's background volume. The `stub_profile`, `stub_profile_flagged` and `stub_latency` thresholds (`value>=0`) are reporting-only too: they print each stubbed integration's profile, flags and latency. The background-volume run gates on failed requests, checks and dropped iterations only, never on response times.

## Add a suite

1. Add `src/suites/<suite>.k6.js`. Name it after the test type and what it covers, for example `load-notification-submit.k6.js`.
2. Get service URLs from `resolveServiceUrl(__ENV, '<service-name>')` in `src/config/target.js`.
3. Give each scenario its thresholds with `scenarioThresholds` in `src/config/thresholds.js`. Tag requests with an endpoint from the catalogue in `src/config/endpoints.js`, which also sets the `name` tag. Follow the workspace's k6 best practices.
4. Put any logic worth testing in `src/config/` (or a new folder under `src/`) with a `*.test.js` beside it.
5. A suite that measures load reports the background volume and calls `requireBackgroundVolume` in `setup()` (both in `src/k6/background-volume.js`), so it never measures an empty environment.
6. Every suite reports the stub profiles at the start and the end of a run (`readStubProfiles` and `reportStubProfiles` in `src/k6/stub-profiles.js`). A design-target, breakpoint or resilience suite also calls `requireStubProfiles(stubProfiles, SLA_PROFILE)` in `setup()`, in code, whatever `STUB_PROFILE` says, so it never measures against stubs that answer at once. In `setup()`, straight after the start `reportStubProfiles` call (and after `requireStubProfiles` where the suite has one), call `clearStubAnswered({ urls })`, so the end-of-run answered figures cover only this run.
7. Run it with `npm run k6:local -- run --no-usage-report src/suites/<suite>.k6.js`.
8. To make CDP run it by default in an environment, change `default_suite` in `entrypoint.sh`. Otherwise set `TEST_SUITE` to `<suite>` on the run.

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
