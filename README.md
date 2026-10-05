# trade-imports-performance-tests

k6 performance test suites for the trade imports services, run on the Core Delivery Platform (CDP).

CDP builds this repo into a Docker image. The CDP Portal runs the image, and the image runs one k6 suite, then publishes the report to S3 so the Portal can show it.

- [Layout](#layout)
- [Run locally](#run-locally)
- [Run in CDP](#run-in-cdp)
- [Run from a laptop against CDP](#run-from-a-laptop-against-cdp)
- [Smoke run on pull requests](#smoke-run-on-pull-requests)
- [Background volume](#background-volume)
- [Stub latency profiles](#stub-latency-profiles)
- [Stub ceilings and headroom](#stub-ceilings-and-headroom)
- [Design-target runs](#design-target-runs)
- [Load generator](#load-generator)
- [Traffic model](#traffic-model)
- [Request mix](#request-mix)
- [Thresholds](#thresholds)
- [Add a suite](#add-a-suite)
- [Licence](#licence)

## Layout

| Path                 | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/suites/`        | One k6 script per suite, named `<suite>.k6.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/config/`        | Environment and service URLs, the endpoint catalogue, thresholds and smoke values, the traffic model (`traffic.js`), the journeys' endpoint names (`journey-endpoints.js`), the request-mix classes (`request-mix.js`) the stated facts the test data rests on (`test-data.js`) the background volume's targets, scenarios and index line (`background-volume.js`) and the stubbed integrations, their profiles, flags and conformance interval (`stub-profiles.js`), and the stub ceilings: recorded ceilings, ladders, the headroom factor and the sign-in targets (`stub-ceilings.js`), the design-target shapes, run lengths, load profiles, IUU scenarios, the weekday profile's rows, the spike's capacities and pace factors, the endurance run's returning users and the volumetrics targets (`design-target.js`) and the load generator's idle and memory allowances (`generator.js`) |
| `src/lib/`           | Pure helpers with unit tests, shared by suites, with no k6 imports, including the stub profile lines and flags (`stub-profiles.js`), the stub ceiling step verdicts, ceilings and headroom lines (`stub-ceilings.js`), the phase clock (`phases.js`), the design-target report (`design-target-summary.js`), the dead-letter growth and line (`dead-letters.js`), the generator verdict (`generator.js`) and the threshold lines (`summary-text.js`)                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/k6/`            | k6-only modules: the browser-like session, the notification driver (`journeys.js`), the two journeys' steps (`live-animals.js`, `high-risk-plants.js`), the live-animals documents step (`documents.js`), the front door (`front-door.js`), shared step helpers (`journey-pages.js`), page requests and the request mix (`pages.js`), the readiness wait, the background volume's reads and address creation (`background-volume.js`), the stub profile reads and report (`stub-profiles.js`), the stub calls, the Defra ID sign-in and the headroom report (`stub-ceilings.js`), the design-target run (`design-target.js`), the returning users of the endurance run (`returning-session.js`), the gateway's dead-letter reads (`dead-letters.js`), the phase tag and paced waits (`phase.js`) and the 5xx rate and transport errors (`server-errors.js`)                                    |
| `src/generator/`     | The generator verdict run, a one-iteration k6 script that judges the sampler's file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `scripts/`           | The run wrapper (`run-suite.sh`) and the generator sampler (`sample-generator.sh`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `entrypoint.sh`      | What the image runs: one suite through `scripts/run-suite.sh`, then the S3 upload                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `Dockerfile`         | The image CDP runs, based on `grafana/k6` with the AWS CLI added                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `compose.yml`        | Local runs: LocalStack for S3 and `target`, a stand-in service that has `/health`, the `stub-ceiling` profile: its own Defra ID stub and the stub-ceiling runner, and the `design-target` profile: the design-target runner                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `compose/`           | LocalStack set-up and the stand-in service's nginx config                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `.github/workflows/` | Pull request checks, and the CDP publish on merge to `main`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

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

The smoke profile starts 20 notifications an hour for each journey, one in the two-minute window and compresses a session to 1 minute, so the gate sees save and return, submit, read-back, amendment and cancel-amendment in about 2.5 minutes. The design-figure rates are in `src/config/traffic.js`. The [design-target runs](#design-target-runs) drive them.

It reaches the stack through `host.docker.internal` and sets `ENVIRONMENT=local`, so it can never reach a CDP environment. It prints k6's summary and uploads nothing. It exits with k6's exit code, so a breached threshold exits with code 99.

Tear down afterwards:

```bash
npm run k6:down
```

This removes only this repo's containers. It does not stop the workspace stack.

## Run in CDP

Merging to `main` publishes the image. Run it from the CDP Portal.

The image reads these environment variables:

| Variable                 | Set by             | Purpose                                                                                                                                                                                                                                                                                               |
| ------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`            | CDP Portal         | The environment to test, for example `perf-test`. Suites build service URLs from it. `prod` is refused                                                                                                                                                                                                |
| `RESULTS_OUTPUT_S3_PATH` | CDP Portal         | Where the report goes. The run fails if it is not set                                                                                                                                                                                                                                                 |
| `S3_ENDPOINT`            | image              | Defaults to AWS S3 in `eu-west-2`. Compose points it at LocalStack                                                                                                                                                                                                                                    |
| `TEST_SUITE`             | you, optionally    | The suite to run, as a file name in `src/suites/` without `.k6.js`. Defaults to `smoke` in `dev` and `test`, and to `health-check` everywhere else                                                                                                                                                    |
| `<SERVICE_NAME>_URL`     | you, optionally    | Overrides a service's URL, for example `TRADE_IMPORTS_INS_FRONTEND_URL`                                                                                                                                                                                                                               |
| `CDP_LOCAL`              | you, from a laptop | `true` sends backend calls through CDP's protected gateway — see [Run from a laptop against CDP](#run-from-a-laptop-against-cdp)                                                                                                                                                                      |
| `DEVELOPER_API_KEY`      | you, from a laptop | The CDP developer API key, needed when `CDP_LOCAL` is `true` — see [Run from a laptop against CDP](#run-from-a-laptop-against-cdp)                                                                                                                                                                    |
| `LOCALHOST_ALIAS`        | Compose            | The host a container uses for the machine's `localhost`, for example `host.docker.internal`                                                                                                                                                                                                           |
| `AUTH_PASSWORD`          | you, optionally    | The Defra ID stub's password. Defaults to `Password123`. In CDP, set it as a test-suite secret in the Portal when the stub in that environment uses another password                                                                                                                                  |
| `TRAFFIC_MODEL`          | you, optionally    | JSON laid over the traffic model defaults and the smoke profile — see Traffic model                                                                                                                                                                                                                   |
| `STUB_PROFILE`           | you, optionally    | The profile a run requires every stub-hosted integration to run, `zero-delay` or `sla`. Compose defaults it to `zero-delay`, except for `k6-cdp` (the laptop-to-CDP runner), which leaves it unset. Unset requires none and reports what runs. The stub-ceiling suite requires `sla` when it is unset |
| `STUB_CEILING_GROUPS`    | you, optionally    | The groups the stub-ceiling suite runs, a comma list of `trade-token`, `mdm`, `defra-id-target` and `defra-id`. Unset runs all of them                                                                                                                                                                |
| `STUB_CEILING_MODEL`     | you, optionally    | JSON laid over the stub-ceiling suite's ladders and step settings — see Stub ceilings and headroom                                                                                                                                                                                                    |
| `STUB_CEILINGS`          | you, optionally    | JSON laid over the ceilings recorded for the run's environment, by integration then profile — see Stub ceilings and headroom                                                                                                                                                                          |
| `LOAD_PROFILE`           | you, optionally    | `two-journeys` or `with-iuu`, for the design-target suites. Unset is `two-journeys` — see Design-target runs                                                                                                                                                                                          |
| `SCENARIO_LENGTH`        | you, optionally    | `full`, `nightly` or `local`, for the design-target suites. Unset follows the environment — see Design-target runs                                                                                                                                                                                    |
| `REPORTS_DIR`            | image              | Where the run writes its files. The image sets it to `/opt/perftest/reports`                                                                                                                                                                                                                          |

Without an override, a service's URL is `https://<service-name>.<ENVIRONMENT>.cdp-int.defra.cloud`. When `ENVIRONMENT` is `local`, it is the workspace Docker stack's host port for the service, on `localhost` or on `LOCALHOST_ALIAS` when that is set. With `CDP_LOCAL=true`, a backend service's URL is `https://ephemeral-protected.api.<ENVIRONMENT>.cdp-int.defra.cloud/<service-name>` instead.

The image writes these files and copies them to `RESULTS_OUTPUT_S3_PATH`:

- `index.html` — the k6 web dashboard report, which the Portal shows, at one-second resolution
- `summary.json` — k6's end-of-test summary
- `timeseries.json.gz` — every sample with its timestamp and tags, so a 10-second spike is visible
- `generator-samples.txt` and `generator.json` — the load generator's CPU and memory, and its verdict (see [Load generator](#load-generator))
- for design-target suites, `design-target.json` and `design-target.html` — the run's report per scenario and per endpoint, and `relative-thresholds-failed.txt` when the relative burst rule fails

`timeseries.json.gz` is written for every suite run through the image, smoke included. A long run makes a large file.

The image exits with k6's exit code, so a failed threshold (code 99) fails the run. It also exits 99 when a design-target run's relative threshold fails. The report is still published first. The image exits with code 1 if `RESULTS_OUTPUT_S3_PATH` is not set, the suite does not exist, the report was not written or the upload failed.

### Smoke run in CDP dev and test

The same smoke suite runs in CDP `dev` and `test`, chosen by `ENVIRONMENT` alone. A Portal run with no variables set runs `smoke` there, and the log includes `Running suite smoke in dev` (or `test`).

- Sign-in goes through the real OIDC flow against the Defra ID stub deployed in that environment, with the secure cookies and the CSRF crumb the platform requires. Every session checks `sign-in went through Defra ID` when it opens the INS dashboard, so a run that bypassed Defra ID fails the `checks` threshold.
- SNS and SQS are the CDP-provisioned ones, reached through animals saves, which publish a notification event.
- Live-animals uploads go through the real cdp-uploader and its antivirus scan, and the run measures the scan: `document_scan_duration` is judged against the upload page allowance of P99 under 60 seconds.
- Systems outside the INS boundary answer from the stubs deployed in that environment. In perf-test those stubs run the `sla` profile, because cdp-app-config sets `STUB_LATENCY_PROFILE=sla` for `trade-imports-stub` and `trade-imports-defra-id-stub`; a run there should set `STUB_PROFILE=sla`. That cdp-app-config change is made by a person, not by this repo.
- `prod` is refused: the run fails at start without a report.
- The report (`index.html` and `summary.json`) is published with every run, even when a threshold fails.

To run it after each deploy to `dev`, set an automatic test run in the CDP Portal, on the `trade-imports-performance-tests` test suite page, for environment `dev`. Trigger it on deployments of `trade-imports-ins-frontend`, `trade-imports-animals-frontend`, `trade-imports-plants-frontend`, `trade-imports-animals-backend`, `trade-imports-plants-backend` and `trade-imports-reference-data`. This is Portal configuration, not code.

To run the smoke suite from a laptop instead, see [Run from a laptop against CDP](#run-from-a-laptop-against-cdp).

## Run from a laptop against CDP

From a laptop, the backend services' CDP addresses do not resolve. With `CDP_LOCAL=true`, the suite sends backend calls to `https://ephemeral-protected.api.<env>.cdp-int.defra.cloud/<service>` with `DEVELOPER_API_KEY` as the `x-api-key` header. This is the same switch `trade-imports-ins-tests` uses. The frontends and the Defra ID stub stay on their direct addresses. Without `CDP_LOCAL`, the suite uses the direct `https://<service>.<env>.cdp-int.defra.cloud` addresses.

Put these variables in a `.env` file in the repo root. `ENVIRONMENT` can be set there too and defaults to `dev`. Git ignores `.env`; never commit it.

| Variable            | Value                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `ENVIRONMENT`       | `dev`, or `test` with that environment's key. `prod` is refused, whatever `CDP_LOCAL` says |
| `CDP_LOCAL`         | `true` from a laptop                                                                       |
| `DEVELOPER_API_KEY` | The CDP developer API key for that environment. Each environment has its own               |

Run it, then take the Compose project down:

```bash
npm run k6:cdp
npm run k6:down
```

Any other variable (`TRAFFIC_MODEL`, `STUB_PROFILE`, `AUTH_PASSWORD`) can be set in `.env` or in the shell. A shell variable wins over `.env`.

- Unless `STUB_PROFILE` is set, a laptop run requires no stub profile and only reports the profiles that run.

- Without `DEVELOPER_API_KEY`, the run stops at once with `DEVELOPER_API_KEY is not set`, naming the variable.
- The key goes only to gateway addresses. It is never printed, logged or written to `./reports`. Do not run `docker compose config` or `k6 inspect --include-system-env-vars` against `k6-cdp`: both print the environment.
- The run writes the same report files as the image to `./reports` and uploads nothing.
- The log includes `Backend calls: through CDP's protected gateway …`, and the summary names the environment in `run_environment{environment:dev}`.
- Runs against `dev` create `PERF-` notifications there.

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
- `sla` delays each answer by a draw from a lognormal distribution fitted to the integration's targets: the median matched exactly and the tail fitted to p95 and p99 by least squares in log space. The interim targets are p50 100ms, p95 400ms and p99 1,000ms, which fit to p95 470ms and p99 892ms. Every design-target, breakpoint and resilience scenario that measures INS runs on `sla`. The scenarios that measure a stub's own ceiling are the exception, see [Stub ceilings and headroom](#stub-ceilings-and-headroom).

Azure Service Bus starts at zero added delay, because section 9.5 gives no figure for it.

Each stub reports its profiles at `GET /latency-profiles`: the interface each represents, its owner, the service level it was derived from, whether it is agreed, when it was last conformed, the targets and the latency the stub actually answered with, including `peakPerSecond`, the most calls it answered within one wall-clock second since it started or was last cleared. The suites read both stubs at the start and the end of a run, and clear each stub's answered latencies (`DELETE /latency-profiles/answered`) straight after the start read, so the end figures cover only that run. A stub that answers 404 or 405 to the clear predates profiles and is left alone. The summary prints `stub_latency_answered_count` per stub-hosted integration, and when it is 0 the stub answered no calls, so its answered p50/p95/p99 (shown as 0) mean nothing. They log:

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

## Stub ceilings and headroom

A stub that cannot keep up makes INS look slow when it is not, so "the stub must have headroom over the system under test" (confluence:6608160092, Rationale, Validation against the real systems). Each stub is driven to its breaking point on its own, and every run says whether each stub it went through had headroom over the load it carried.

The `breakpoint-stubs` suite measures the ceilings. It runs in groups, in this order:

| Group             | What it does                                                                                                                                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trade-token`     | A stepped ramp of token requests to `trade-imports-stub`: 10, 25, 50, 100, 200, 300, 400, 600, 800, 1,200, 1,600, 2,400 a second                                                                                                                                                                                                       |
| `mdm`             | The same ladder of MDM reads to `trade-imports-stub`, countries and border control posts alternately                                                                                                                                                                                                                                   |
| `defra-id-target` | Shows the Defra ID stub carries twice the sign-in design target plus the front-door spike. After a warm-up that fills the session store (400 sessions, then 1,540), it holds 400 sign-ins an hour for 60 seconds, adds 5 a second for 10 seconds, then holds for 60 seconds. The same with 1,540 an hour for with-IUU (reporting only) |
| `defra-id`        | A stepped ramp of full sign-ins to the Defra ID stub: 1, 2, 3, 5, 8, 12, 16, 24, 32 a second, over a store kept at the with-IUU steady state because every iteration signs out at its end                                                                                                                                              |

The figures behind the Defra ID target: the sign-in design target is 200 an hour, or 770 with IUU (NFR-VOL-CORE-01). Twice that is 400 and 1,540 an hour. Each frontend's 10-second spike capacity is 5 RPS (section 4.2), and NFR-VOL-CORE-05 includes sign-in through IDM in it, so every spike request is treated as a sign-in. The stub must therefore carry 400 / 3600 + 5 = 5.11 sign-ins a second, or 5.43 with IUU. The stub keeps a session for an hour, so the warm-up holds one hour of sessions at the doubled target. Its session store is changed only if this measurement falls short (c-010).

### Each step, and the ceiling

Every ladder step is its own `constant-arrival-rate` scenario of 20 seconds, with a 5 second gap, so k6 measures each step separately. A step holds when failed requests are under 1%, checks pass over 99%, no iteration is dropped and the p95 of its profiled requests is within the stub's fitted p95 (0 for `zero-delay`) plus 200ms. Requests time out after 10 seconds. A step that runs out of virtual users drops iterations and breaks, which is what saturation looks like from outside. The ceiling is the rate of the last step that held before the first that broke. If the first step broke it is 0, and if every step held it is the top step and the run says `at least` and to raise the ladder.

The ceiling is in requests a second at the integration's profiled endpoints, the same thing a stub's `peakPerSecond` counts. For `trade-token` and `mdm` one iteration is one request. For `defra-id` one iteration is one sign-in, which reaches the profiled paths three times (the INS frontend fetches the discovery document, the token and the keys on every use), so its ceiling in requests a second is 3 times its ceiling in sign-ins a second. Both are printed, and the Defra ID target is judged in sign-ins a second.

The suite's end-of-test text replaces k6's default summary and lists every step, every ceiling, the Defra ID verdicts and every threshold as `passed` or `FAILED`. k6's exit code still follows the thresholds. The only gating thresholds are the two-journey sign-in target's (failed requests under 1%, checks over 99%, no dropped iteration). Every other threshold the suite declares is reporting-only.

### Run it

Each group is its own run, so every run stays under 10 minutes:

```bash
STUB_CEILING_GROUPS=mdm npm run test:docker-compose:stub-ceilings
npm run k6:down
```

The workspace stack must be running. The runner reaches the stack's own `trade-imports-stub`. The Defra ID stub runs in a container of its own (the `stub-ceiling` Compose profile), so the sessions a ceiling run leaves behind go with `npm run k6:down` and never reach the stack's Defra ID stub or its E2E suite. To measure under `sla` locally, use a Defra ID stub image that carries latency profiles and set `TRADE_IMPORTS_DEFRA_ID_STUB=<branch tag> STUB_PROFILE=sla`. The stack's Java stub stays on `zero-delay`, because a stage cannot restart the stack. Local ceilings are the `--dev` stack's on one machine, so they are a local reference, not a CDP figure.

In CDP, `TEST_SUITE=breakpoint-stubs` with nothing else set runs every group and requires `sla`. The `sla` setting on the stubs in perf-test is cdp-app-config, which a person changes.

### Record a ceiling

A measurement becomes trusted by being committed. Each ceiling run prints `Stub ceilings recorded: {...}`. Paste each integration's entry into `RECORDED_CEILINGS` for that environment in `src/config/stub-ceilings.js`, keeping the printed `source` or making it more specific about where it was measured, or pass the same object as `STUB_CEILINGS` on a run. A ceiling is recorded for an environment and a profile, and a run is judged only against the ceiling for its own environment and its stubs' own profile.

### Headroom in every run

The smoke and background-volume suites end by reading each stub's load (`peakPerSecond` and the mean a second since the stubs were cleared) and judging it against the recorded ceiling. The busiest second a stub carried must be at most half its ceiling (the factor the volumetrics page applies to its design targets). Per stub-hosted integration that carried load the verdict is one of:

- `headroom`
- `no headroom`: twice the peak is more than the ceiling, including when the ceiling is only known as "at least"
- `no ceiling measured`: none is recorded for this environment and profile
- `load not reported`: the stub predates `peakPerSecond`

```
Stub headroom: mdm (trade-imports-stub) peak 3 a second, mean 0.40 a second, against a ceiling of 400 a second (zero-delay, local, measured 2026-10-02): headroom
Stub headroom: defra-id (trade-imports-defra-id-stub) carried load not reported: the stub does not report it
Stub headroom: trade-token (trade-imports-stub) peak 2 a second, mean 0.20 a second, no ceiling measured for zero-delay in local
Stub headroom: mdm (trade-imports-stub) carried no load
Stub headroom: azure-service-bus is not a stub service: not judged
```

For a stub that hosts more than one integration, the combined peak is the sum of its integrations' peaks. An integration that has headroom alone but not against the combined peak is named, and that is the evidence for splitting it into its own stub service (c-020):

```
Shared stub: trade-imports-stub carried a combined peak of 30 a second across mdm and trade-token, more than half mdm's ceiling of 40: mdm's results are distorted, which is evidence for splitting mdm into its own stub service
```

A run is untrusted when any judged integration has no headroom, no ceiling or unreported load, or is named for distortion:

```
Run trust: untrusted: defra-id carried load not reported; mdm no headroom; mdm shared-stub distortion
```

The verdict is reported, never gated: it does not fail the run. The stub-ceiling suite itself logs `Run trust: not judged`, because it measures the stubs' own ceilings.

## Design-target runs

Five suites drive live animals, high-risk plants and the INS front door at the rates the volumetrics page sets: `sustained-peak`, `p99-burst`, `average-load`, `spike-recovery` and `endurance`. Each is a few lines that call `createDesignTargetRun` in `src/k6/design-target.js`. The shapes, rates, phases and thresholds are configuration in `src/config/design-target.js` and `src/config/traffic.js`, so an agreed revision changes values, not scripts (c-006). The names follow DR-EUDP-005's scenario names.

Each traffic scenario is one `ramping-arrival-rate` scenario, per hour, tagged `journey` (`live-animals`, `high-risk-plants`, `ins-front-door` or `iuu-synthetic`). The virtual users come from Little's law with twice as many as the ceiling, as in the smoke run. The scenarios are `live-animals`, `high-risk-plants`, `ins-front-door` (dashboard-only sessions) and `ins-address-book`. The average-load scenarios count their rate per 24 hours, not per hour: k6 rates are whole numbers, so counted per day a quiet hour's rate stays within a few per cent of its target, where per hour it would round to 1. The endurance run adds three `constant-vus` scenarios, `returning-ins`, `returning-animals` and `returning-plants`: a fixed few users who each keep one browser for the whole run (see [Endurance and re-authentication](#endurance-and-re-authentication)).

### Shapes and lengths

`SCENARIO_LENGTH` is laid over the traffic model's defaults. Unset, it follows the environment: `local` gives `local`, `test` gives `nightly` (c-003's default), and any other environment gives `full`. `SCENARIO_LENGTH=local` outside `local` is refused. `TRAFFIC_MODEL` still overrides any single value, for example `{"sustainedPeak":{"holdDuration":"4h"}}`.

| Length    | Sustained peak                           | P99 burst                    | Average load         | Spike and recovery                                          | Endurance                                                                | Sessions                                                               |
| --------- | ---------------------------------------- | ---------------------------- | -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `full`    | ramp 3h, then hold 7h (the DR's figures) | warm-up, 30m peak, 60s burst | 24 hours of 1h       | warm-up, 5m baseline, 10s spike, 60s recovery, 2m recovered | warm-up, 8h hold, 1h windows, sessions expire at the frontends after 4h  | as the traffic model                                                   |
| `nightly` | ramp 1h, then hold 2h                    | unchanged                    | 24 hours of 10m (4h) | unchanged                                                   | unchanged                                                                | as the traffic model                                                   |
| `local`   | ramp 2m, then hold 6m                    | warm-up, 4m peak, 60s burst  | 24 hours of 2m (48m) | warm-up, 2m baseline, 10s spike, 60s recovery, 1m recovered | warm-up, 12m hold, 3m windows, the browser forgets each session after 3m | 2 minutes (journeys and IUU) and 0.5 minutes (dashboard-only sessions) |

The nightly ramp is 1 hour, not shorter, so the longest iteration (50 minutes) has finished once before the hold starts. At `local` length the page and arrival rates stay at the design figures, because page rate is notifications times pages and does not depend on session length. Concurrency is lower.

Phases, tagged on every metric a journey emits as `phase`:

- sustained peak: `ramp`, `hold`, `tail`. Response times are judged in the hold
- P99 burst: `warm-up` (as long as the longest iteration, 50 minutes at full length, so the 30 minutes judged as peak are at steady state), `peak`, `burst`, `tail`
- average load: `hour-00` to `hour-23`, then `tail`. Response times are judged over the whole run
- spike and recovery: `warm-up` (as the burst's), `baseline`, `spike`, `recovery`, `recovered`, `tail`. Response times are judged in the baseline, and recovery in the `recovered` window
- endurance: `warm-up` (as the burst's), `first-hour`, `middle`, `final-hour`, `tail`. The names stay `first-hour` and `final-hour` at every length: the run line states the window. Response times are judged over the whole run, and drift between the two windows

### How the burst works

An arrival rate alone cannot make a one-minute burst: at 44 notifications an hour, 1.5 times the rate for 60 seconds starts about one extra notification. So the arrival rate steps to 1.5 times for the 60 seconds, and in the `burst` phase every user also moves 1.5 times faster through their think time (`pacedSleep` in `src/k6/phase.js`). A wait that straddles the start of the burst is exact: a 30-second wait that starts 10 seconds before the burst lasts 10 + 20 / 1.5 = 23.3 seconds. The journey is the same pages in the same order. Outside a design-target run `pacedSleep` is `sleep`.

### How the spike works

The `spike-recovery` suite holds the design-target peak for a baseline (5 minutes), then spikes every component to its stated capacity for 10 seconds, then watches it recover (DR-EUDP-005 'Scenario shapes' row 3). The capacities are volumetrics section 4.2's Spike capacities, held in the traffic model as `spikeRecovery.capacityRps` so an agreed revision of open item 2 changes values, not scripts: 5 RPS on each of the INS front door (including sign-in), the live animals frontend and the high-risk plants frontend, and 15 RPS for IUU with IUU. The section carries no headroom factor.

As the burst does, the arrival rate steps up for the spike and every user moves faster through their think time. Unlike the burst the factor is per scenario, because one factor cannot hit 5 RPS on three frontends at once: a journey session puts pages on its journey frontend and on INS. Each journey's factor takes its own frontend to capacity, the two front-door scenarios share the factor that takes INS to capacity once the journeys' own INS pages are counted, and each IUU scenario's factor takes IUU to capacity. At the defaults:

| Scenario                                | Pace factor |
| --------------------------------------- | ----------- |
| `live-animals`                          | 10.23       |
| `high-risk-plants`                      | 10          |
| `ins-front-door` and `ins-address-book` | 12.17       |
| each IUU scenario (with IUU)            | 11.79       |

Page rate does not depend on session length, so the factors are the same at every run length. The 25 RPS session path (55 RPS with IUU) and the backend rates are derived, as the burst's backend rate is: nothing in the stack is a session API, so the session path is every frontend page plus one backend call a journey page. `setup()` logs what the run applies: `Spike: 10s at the stated capacities: animals 5 RPS (pace x10.23), plants 5 RPS (pace x10), INS front door 5 RPS including sign-in (pace x12.17), session path 25 RPS (derived); recovery judged over the 2m after the 60s allowed`. The one-second view of the recovery is the run's `index.html` and `timeseries.json.gz`.

### Endurance and re-authentication

The `endurance` suite holds the design-target peak for 8 hours (DR-EUDP-005 row 4) and checks for drift, exhaustion and re-authentication. Every ordinary session signs in with a fresh browser, so none outlives either lifetime and none would ever re-authenticate. The run therefore adds returning users: one each (`endurance.returningUsersPerFrontend`) on INS, live animals and high-risk plants, in the `constant-vus` scenarios `returning-ins`, `returning-animals` and `returning-plants`. Each keeps one browser, with one cookie jar, for the whole run, visits its frontend's dashboard every `endurance.visitInterval` (10 minutes), and so stays signed in until the frontend expires its session, then goes through Defra ID again on its next visit. The ordinary sessions are unchanged, so the sign-in rate stays at its design target.

What triggers re-authentication is each frontend's own session, `session.cache.ttl`, which is 4 hours, set at sign-in and not sliding. What does not is the Defra ID stub's 1-hour session: it bounds only the stub's own store, which is read to exchange an access code or a refresh token, and the access token itself lives 24 hours, so no frontend refreshes within an 8-hour run. The all-day sign-ins do exercise that store, but they are not the trigger.

A sign-in hop in a browser session that has already signed in once is tagged `auth: re-authentication`. A returning visit that went through sign-in again is recorded as a page request in the `re-authentication` traffic class, counted in `reauthentications`, and checked to land back on the page it asked for. The report shows both as their own traffic, `Re-authentication traffic (auth:re-authentication)`.

A compressed run cannot reach a 4-hour expiry, and nothing in this repo changes the stack's session lifetime. At `local` length `endurance.sessionExpiry` is `client`: the returning user clears its cookies for that frontend once `endurance.sessionLifetime` (3 minutes) has passed since it last signed in, standing in for the expiry. The redirect to `/auth/sign-in`, the Defra ID round trip and the landing are then the same path a server-side expiry takes. Locally all services share the `host.docker.internal` host, so clearing also drops the Defra ID stub's cookie and the user re-enters credentials; in CDP the hosts differ and the stub signs in silently. Both are re-authentications through the stub.

k6 sees only its own requests, not a service's connection pool or heap. The run judges exhaustion on what k6 can see: `transport_errors` counts requests that failed below HTTP (refused, reset or timed out), which is what a crashed container, or a request stuck behind an exhausted pool until k6's 60-second timeout, looks like, and a slow exhaustion shows as drift. Read the services' own heap and pool metrics on the platform's dashboards (CDP Grafana) beside the report.

### Average load

k6 and Grafana name average load as its own test type: how a system behaves on an ordinary day. Sustained peak does not cover it, because it holds the busiest hour of a seasonal peak day with 2x headroom on top, which is a stress test. The `average-load` suite replays the shape of a normal weekday at the forecast volume, for live animals, high-risk plants and the front door together.

The profile is volumetrics section 4.3's daily profile, each row read hour by hour and interpolated linearly. It is held in the traffic model as `averageLoad.hourlyShares`:

| Hours      | Row                | Share of the weekday                     |
| ---------- | ------------------ | ---------------------------------------- |
| 00 to 05   | Overnight baseline | 0.9% each                                |
| 06, 07, 08 | Ramp-up            | 1.9%, 3.6%, 5.3%                         |
| 09 to 15   | Sustained window   | 7.7%, 7.8%, 8.0%, 7.8%, 7.7%, 7.7%, 7.7% |
| 16, 17     | Early ramp-down    | 7.2%, 5.8%                               |
| 18 to 23   | Evening ramp-down  | 4.1%, 3.6%, 3.1%, 2.6%, 2.1%, 1.6%       |

The shares sum to 100.7%, not 100%: the section's own rows cannot sum to exactly 100%, and normalising them would move the busiest hour off T2's 8%. The sustained window sums to 54.4%, against T2's "about 54%". The busiest hour, 11:00, is T2's 8%.

The volume is the design rate without the seasonal peak-day factor (A1, 2) and the design headroom (A3, 2). Each scenario's rate in an hour is its design-target rate times that hour's share over the busiest hour's share, over A1 times A3. The busiest hour is therefore a quarter of the sustained peak run's rate, and the day averages about an eighth of it (0.131). `setup()` logs the figures worked out from the model: `Average weekday: seasonal peak factor (A1) 2 and design headroom (A3) 2 taken out, so the busiest hour runs at 25% of the sustained peak run's rate and the day averages 13.1% of it`.

Each hour holds its rate. Compression shortens an hour (`averageLoad.hourDuration`), never changes its rate, so an hour's achieved rate stays comparable with its target at any length.

The day starts with no one in session, so hour 00's page rate is below its target for the first session length. It is the quietest hour, and the shortfall is reported, not corrected.

### Pass rules

c-004's default, with each threshold tied to a figure:

- sustained peak: the response-time limits in Thresholds, per scenario and endpoint, in the `hold` phase. Failed requests under 1%, checks over 99% and no dropped iteration over the whole scenario, so a failure in the ramp still fails the run
- P99 burst: 5xx under 1% in the burst minute (`server_errors{scenario,phase:burst}`), checks over 99% and no dropped iteration over the whole run, and the relative rule below. The peak-phase response times are reported, not gated
- average load: sustained peak's limits per scenario and endpoint over the whole run, judged at the end and never aborting, because an overnight hour with a handful of samples would be judged on its first few. Failed requests and checks also use sustained peak's limits, judged at the end and never aborting for the same reason, and dropped iterations as for sustained peak
- spike and recovery: sustained peak's limits per scenario and endpoint in the `baseline` phase. Failed requests under 1%, checks over 99% and no dropped iteration over the whole scenario, all judged at the end and never aborting. Spike-phase response times are reported, not gated: the spike is allowed to be slow, and recovery is the rule (below). The achieved spike rates are reported, never gated, as every achieved figure is
- endurance: sustained peak's limits per scenario and endpoint over the whole run (the returning scenarios included), failed requests, checks and dropped iterations also over the whole run, all at the end and never aborting, so an 8-hour run is not cut short by an early abort judged on its first samples. No `transport_errors` in any scenario, at least one re-authentication from each returning user, and the drift rule below

The relative rules: for the burst, P95 in the burst minute is no worse than twice the sustained-peak P95. For the spike (c-004's default), P95 in the `recovered` window, the 2 minutes after the 60 seconds allowed, is no more than 1.1 times its P95 in the `baseline`: back within 10% of the pre-spike baseline within 60 seconds. For endurance (c-004's default), P95 in the `final-hour` is no more than 1.2 times its P95 in the `first-hour`. k6 cannot compare two of its own metrics in a threshold, so `handleSummary` works each out for each scenario and request kind (`page`, `api`, `upload`). A pair with fewer than 10 requests in the later phase (interim) is `not judged`. In the two-journey profile an over pair is written to `relative-thresholds-failed.txt`, and `scripts/run-suite.sh` exits 99 when k6 itself exited 0 and that file exists. The report has already been written by then. In the with-IUU profile the verdict prints as `reported, not gated`.

### Cascade

The spike and endurance runs check that a failure does not cascade through the stubs, on two signals and one liveness check:

- Service Bus stand-in: `setup()` reads the gateway's dead-letter queue (`GET /dlq/notifications?limit=1`, `approximate_count`, with the readiness tags so no threshold measures it) and `teardown()` reads it again. Growth goes to the gauge `downstream_dead_letters{downstream:service-bus}`, gated at `value<1`, and a line: `Service Bus stand-in: the gateway's dead-letter queue held 0 messages at the start and 0 at the end: no cascade`. A gateway that does not answer 200 gives `not measured` and no sample. SQS moves a message to the dead-letter queue only after the queue's `maxReceiveCount` receives, and the count is eventually consistent, so a cascade in the last minute may land after `teardown()`; the platform's queue metrics are the backstop
- Defra ID stub: sign-in hops (`endpoint:sign-in`) must fail under 1% in the `spike` phase and in the `recovery` phase (the spike run), judged at the end
- both stubs must still answer at the end: `teardown()` reads `/latency-profiles` from `trade-imports-stub` and `trade-imports-defra-id-stub` and throws on anything but 200 or 404, which fails the run

### With IUU

`LOAD_PROFILE=with-iuu` adds the with-IUU figures as a second profile: 770 sign-ins an hour, 1.5 RPS, 241 concurrent users and a 2.2 RPS burst. It is a separate run, so the gating thresholds never measure with-IUU load (c-007's default). Every threshold in it is reporting-only, so it never fails. Unset is `two-journeys`, the only gating run. IUU's load is generated as INS front-door traffic only, since no IUU journey exists here:

- `iuu-journey-sessions`: 344 sessions an hour. Each signs in, opens the dashboard, then makes 4 more status checks across a 30-minute session
- `iuu-front-door`: 229 dashboard-only sessions an hour
- `iuu-address-book`: 57 address-book sessions an hour

That is about 850 sign-ins an hour, 1.72 RPS and 252 concurrent users, each just above its target. Make it the gate when open item 7 puts IUU in Day One.

### What a local run is

A run in `local` is a script check, never a measurement, and `setup()` logs `Local run: a script check, not a measurement at design conditions`. Outside `local` the suites require the `sla` stub profile in code, and `STUB_PROFILE=zero-delay` is refused. In `local` the run requires what `STUB_PROFILE` says, and Compose defaults it to `zero-delay`. Outside `local` the suites also call `requireBackgroundVolume`. In `local` they report the volume and do not require it, because the workspace stack holds far fewer than 42,000 and 34,000 notifications.

### Achieved against target

Each run prints what it achieved over the steady phase (`hold`, or `peak` for the burst run) against the volumetrics figures. These are reported lines, never thresholds, because the rates are the run's input: whether INS kept up shows in the response-time, failure, check and dropped-iteration thresholds.

```text
Achieved live-animals over the hold (2h): 43.5 notifications an hour against 44, frontend 0.48 RPS against 0.5, backend 0.48 RPS against 0.5 (derived: 1 backend call a page), 21.6 concurrent users against 22 (NFR-VOL-AG-01 to AG-04)
Achieved burst (60s at 1.5x): animals frontend 0.73 RPS against 0.7, plants 0.75 against 0.7, INS 0.66 against 0.6
```

The average-load run states each hour against that hour's target, which is the volumetrics figure times the hour's factor, per journey and for the front door, on the same `phase`-tagged metrics as every other run. The achieved figures are rates per wall-clock hour, so they compare with the target at any compression:

```text
Hour 11:00 (sustained window, 8% of a weekday, 1h): live-animals 10.8 notifications an hour against 11, frontend 0.12 RPS against 0.13, 5.4 concurrent users against 5.5; high-risk-plants 9 notifications an hour against 9, frontend 0.11 RPS against 0.13, 5.3 concurrent users against 5.5; front door (two journeys) 48 sign-ins an hour against 50, core pages 0.1 RPS against 0.1, 12.5 concurrent users against 12.8
```

The spike and endurance runs state their own figures. The spike states each component's rate in the 10 seconds against its stated capacity, then each recovery pair; the endurance run states its two windows, each drift pair, the re-authentications against how many were expected and the transport errors:

```text
Spike (10s): animals frontend 4.9 RPS against 5, backend 4.9 RPS against 5 (derived: 1 backend call a page); plants frontend 5 RPS against 5, backend 5 RPS against 5; INS front door 5.1 RPS against 5 including 3 sign-ins; session path 24.8 RPS against 25 (derived: every frontend page plus 1 backend call a journey page)
Recovery P95 live-animals page: 640ms in the recovered 2m against the baseline's 600ms plus 10% (660ms): within
Drift P95 live-animals page: 812ms in the final hour against 1.2 times the first hour's 700ms (840ms): within
Re-authentication ins: 2 times, about 2 expected (sessions expire at the frontends after 4h)
Re-authentication traffic (auth:re-authentication): 24 requests, P95 310ms, 0% failed
```

The spike's achieved rate is reported, not asserted: at a compressed length only a few users are in each journey, so the 10-second spike undershoots its capacity locally. With IUU the INS part reads `INS front door 19.8 RPS against 20 (5 core and 15 IUU) including 9 sign-ins` and the session path `against 55`, reporting only.

The front door line gives sign-ins an hour, INS core RPS and concurrent users, labelled `(two journeys)` or `(with IUU)`. Concurrent users are the sum of `session_seconds` over the phase's length, which is the time-averaged number of signed-in sessions. The backend line is the frontend's RPS times one backend call a page (T8), not a measured rate: k6 sees only its own requests, so the backends' own rate arrives with inc-014. The run also prints the dashboard-read share against D7, every relative burst verdict, and each endpoint against its limits.

### Report files

| File                                          | What it holds                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `index.html`                                  | The k6 web dashboard, one-second period                                               |
| `summary.json`                                | k6's end-of-test summary as JSON                                                      |
| `timeseries.json.gz`                          | Every sample with its timestamp and tags                                              |
| `design-target.json` and `design-target.html` | The run's report per scenario and per endpoint, tagged by journey, page and call kind |
| `generator-samples.txt` and `generator.json`  | The load generator's samples and verdict                                              |
| `relative-thresholds-failed.txt`              | The burst, recovery and drift pairs that were over, only when the rule fails          |

### Run it locally

```bash
npm run test:docker-compose:sustained-peak
npm run test:docker-compose:p99-burst
npm run test:docker-compose:average-load
npm run test:docker-compose:spike-recovery
npm run test:docker-compose:endurance
LOAD_PROFILE=with-iuu npm run test:docker-compose:sustained-peak
npm run k6:down
```

The workspace stack must be running (see above). Files land in `./reports`. Each local sustained-peak or burst run takes about 12 to 13 minutes. A local spike-and-recovery run takes about 9 minutes at its defaults and a local endurance run about 16; for a shorter script check, shorten the sessions and the windows with `TRAFFIC_MODEL`, for example `TRAFFIC_MODEL='{"liveAnimals":{"sessionMinutes":1},"highRiskPlants":{"sessionMinutes":1},"spikeRecovery":{"baselineDuration":"1m"}}'` for the spike and `TRAFFIC_MODEL='{"liveAnimals":{"sessionMinutes":1},"highRiskPlants":{"sessionMinutes":1},"endurance":{"holdDuration":"3m","comparisonWindow":"1m","sessionLifetime":"1m","visitInterval":"15s"}}'` for endurance. A local average-load run takes about 50 minutes and starts only a few notifications at its own volume; for a busier script check, raise `notificationsPerHour` with `TRAFFIC_MODEL`, for example `TRAFFIC_MODEL='{"averageLoad":{"hourDuration":"12s"},"liveAnimals":{"notificationsPerHour":1440,"sessionMinutes":1},"highRiskPlants":{"notificationsPerHour":1440,"sessionMinutes":1}}'`.

### Nightly in CDP test

Sustained peak (compressed to 2 hours, `nightly` length), P99 burst and spike and recovery run nightly in CDP `test` (c-003's default). A person sets this in the CDP Portal, on the `trade-imports-performance-tests` test suite page, as three schedules in environment `test`: `TEST_SUITE=sustained-peak`, `TEST_SUITE=p99-burst` and `TEST_SUITE=spike-recovery`. They must not overlap. `test` defaults to nightly length and the code requires `sla`, so no other variable is needed. It is Portal configuration, the same kind as the automatic test run above. With-IUU runs (`LOAD_PROFILE=with-iuu`) are on demand until IUU's Day One status is known.

Endurance runs per release in CDP perf-test, at full length (the 8-hour hold, with the frontends' own 4-hour session expiry), once that environment exists (it waits on inc-003), and on demand anywhere with `TEST_SUITE=endurance`. Both new suites run on demand locally at the compressed `local` length. Setting the Portal schedules is a person's work.

Average load runs on demand in every environment (`TEST_SUITE=average-load`), at nightly length (4 hours) in `test` and full length (24 hours) elsewhere, unless `SCENARIO_LENGTH` says otherwise. No Portal schedule is set until the tier-by-environment question (c-003) places it. If the CDP Portal limits how long a test-suite run lasts, `SCENARIO_LENGTH=nightly` is the lever.

## Load generator

The load generator must never be the bottleneck, so each run measures it. A run where it was is marked untrusted.

- **Sampler.** `scripts/sample-generator.sh` runs beside k6 and every 5 seconds appends k6's CPU and memory, the machine's CPU, and its cores, CPU quota and memory limit. k6 cannot read these from JavaScript
- **Judge.** `src/generator/generator-verdict.k6.js` is a second, one-iteration k6 run that reads `generator-samples.txt` and `summary.json`, prints the verdict and writes `generator.json`. The logic is pure and tested in `src/lib/generator.js`
- **CPU rule.** At least 20% idle over any 60 seconds, ignoring the first 60 seconds (virtual-user initialisation). With a CPU quota the idle share is 1 minus k6's CPU over the quota's capacity. Without one it is 1 minus the machine's busy share. Source: the k6 docs, running large tests, "at least 20% idle cycles". Locally the machine is the whole Docker VM, shared with the stack, which is pessimistic and suits a script check
- **Memory rule.** Peak k6 memory no more than a 128 MB base plus 20 MB a virtual user, times the run's `vus_max`. The k6 docs give "~1-5MB per VU" for simple tests and "tens of megabytes per VU" for tests that upload files, and live animals uploads up to 5 MB. Both figures are interim, held in `src/config/generator.js`

```text
Generator: CPU idle at least 41% over any minute (mean 63%) on 2 cores (quota 2); memory peaked at 412MB for 40 virtual users, 10.3MB each, against an allowance of 928MB
Generator trust: trusted: the load generator was not the bottleneck
```

`Generator trust` is `trusted`, `untrusted: <reasons>` or `not judged: <what is missing>`. It is reported, never gated, like `Run trust`. A run is trusted only when both say trusted.

**Shared test data.** The suites load no test-data files. Every value is drawn from the traffic model's distributions or from the options a page offers, so there is no read-only data set to share. A suite that adds one loads it in its init context through `SharedArray` from `k6/data`, so it is held once for all virtual users. The lint rule already stops modules under `src/k6/` calling `open()`. The generator's measured memory per virtual user is what proves the allowance is kept.

## Traffic model

The load is a model, held as values in `src/config/traffic.js` and never fixed in the scripts. Every figure is a working figure from the INS volumetrics page and is still to be confirmed, so a revised figure changes a value, not a script.

| Parameter                                        | Default    | Source                                                    | Smoke |
| ------------------------------------------------ | ---------- | --------------------------------------------------------- | ----- |
| `liveAnimals.notificationsPerHour`               | 44         | design target, section 6.3                                | 20    |
| `liveAnimals.pagesPerNotification`               | 40         | AG1                                                       | 40    |
| `liveAnimals.sessionsPerNotification`            | 1.5        | A2                                                        | 1.5   |
| `liveAnimals.sessionMinutes`                     | 20         | AG2                                                       | 1     |
| `liveAnimals.amendShare`                         | 0.2        | c-012: share of notifications amended                     | 1     |
| `liveAnimals.cancelAmendShare`                   | 0.05       | c-012: share of amendments cancelled                      | 1     |
| `liveAnimals.documentsPerNotification`           | buckets    | c-012: 0–3 documents, mean 1                              | same  |
| `liveAnimals.documentKilobytes`                  | 100–5000   | c-012: 100KB to 5MB, under the 10MB cap                   | same  |
| `liveAnimals.documentTypes`                      | buckets    | c-012: PDF or JPEG, 50% each                              | same  |
| `highRiskPlants.notificationsPerHour`            | 36         | design target, section 7.3                                | 20    |
| `highRiskPlants.pagesPerNotification`            | 50         | PP1                                                       | 50    |
| `highRiskPlants.sessionsPerNotification`         | 1.5        | A2                                                        | 1.5   |
| `highRiskPlants.sessionMinutes`                  | 25         | PP2                                                       | 1     |
| `highRiskPlants.amendShare`                      | 0.2        | c-012: share of notifications amended                     | 1     |
| `highRiskPlants.cancelAmendShare`                | 0.05       | c-012: share of amendments cancelled                      | 0     |
| `highRiskPlants.commodityLinesPerNotification`   | buckets    | NFR-VOL-PP-07: 50% 1–3, 30% 4–10, 15% 11–25, 5% 26–50     | same  |
| `highRiskPlants.commodityTypes`                  | buckets    | interim even split, no volumetrics figure                 | same  |
| `addressBook.worstCaseSearchShare`               | 0.25       | interim, no volumetrics figure                            | 1     |
| `frontDoor.corePagesPerJourneySession`           | 6          | C1                                                        | 6     |
| `frontDoor.dashboardOnlySessionsPerNotification` | 1          | C2                                                        | 1     |
| `frontDoor.dashboardOnlySessionMinutes`          | 5          | C3                                                        | 0.25  |
| `frontDoor.pagesPerDashboardOnlySession`         | 8          | C4                                                        | 8     |
| `frontDoor.addressBookSessionsPerNotification`   | 0.25       | interim, no volumetrics figure                            | 0.25  |
| `iuu.notificationsPerHour`                       | 229        | section 8.2 peak hour 114.3 x A3 (2), rounded up          | same  |
| `iuu.sessionsPerNotification`                    | 1.5        | IUU3                                                      | same  |
| `iuu.sessionMinutes`                             | 30         | IUU2                                                      | same  |
| `sustainedPeak.rampDuration`                     | `3h`       | DR-EUDP-005 scenario shapes, row 1                        | same  |
| `sustainedPeak.holdDuration`                     | `7h`       | DR-EUDP-005 scenario shapes, row 1                        | same  |
| `p99Burst.peakDuration`                          | `30m`      | DR-EUDP-005 scenario shapes, row 2                        | same  |
| `p99Burst.burstDuration`                         | `60s`      | DR-EUDP-005 scenario shapes, row 2                        | same  |
| `p99Burst.burstFactor`                           | 1.5        | T5                                                        | same  |
| `averageLoad.hourDuration`                       | `1h`       | one profile hour (nightly `10m`, local `2m`)              | same  |
| `averageLoad.hourlyShares`                       | 24 shares  | section 4.3 daily profile                                 | same  |
| `averageLoad.seasonalPeakFactor`                 | 2          | A1                                                        | same  |
| `averageLoad.designHeadroom`                     | 2          | A3                                                        | same  |
| `spikeRecovery.baselineDuration`                 | `5m`       | DR-EUDP-005 scenario shapes, row 3 (local `2m`)           | same  |
| `spikeRecovery.spikeDuration`                    | `10s`      | DR-EUDP-005 scenario shapes, row 3; section 4.2           | same  |
| `spikeRecovery.recoveryDuration`                 | `60s`      | c-004 default: back within 60 seconds                     | same  |
| `spikeRecovery.recoveredDuration`                | `2m`       | interim: the window judged after that minute (local `1m`) | same  |
| `spikeRecovery.capacityRps.ins`                  | 5          | section 4.2 Spike capacities, pending open item 2         | same  |
| `spikeRecovery.capacityRps.animals`              | 5          | section 4.2 Spike capacities, pending open item 2         | same  |
| `spikeRecovery.capacityRps.plants`               | 5          | section 4.2 Spike capacities, pending open item 2         | same  |
| `spikeRecovery.capacityRps.iuu`                  | 15         | section 4.2 Spike capacities, pending open item 2         | same  |
| `endurance.holdDuration`                         | `8h`       | DR-EUDP-005 scenario shapes, row 4 (local `12m`)          | same  |
| `endurance.comparisonWindow`                     | `1h`       | c-004 default: final hour against first (local `3m`)      | same  |
| `endurance.sessionExpiry`                        | `frontend` | `frontend` or `client` (local `client`)                   | same  |
| `endurance.sessionLifetime`                      | `4h`       | the frontends' `session.cache.ttl` (local `3m`)           | same  |
| `endurance.visitInterval`                        | `10m`      | interim (local `20s`)                                     | same  |
| `endurance.returningUsersPerFrontend`            | 1          | interim                                                   | same  |
| `mix.dashboardReadShareTarget`                   | 0.25       | D7                                                        | 0.25  |
| `backgroundVolume.liveAnimalsNotifications`      | 42000      | section 6.1, vol-130                                      | same  |
| `backgroundVolume.highRiskPlantsNotifications`   | 34000      | section 7.1, vol-144                                      | same  |
| `backgroundVolume.addressBookEntries`            | 500        | interim, no volumetrics figure                            | same  |
| `backgroundVolume.maxCreatedPerRun`              | 42000      | the largest target, so a run creates the whole gap        | same  |
| `backgroundVolume.virtualUsers`                  | 10         | interim                                                   | same  |
| `backgroundVolume.maxDuration`                   | `24h`      | interim                                                   | same  |
| `duration`                                       | `2m`       | the length of the run                                     | `2m`  |

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

Every page request is recorded under one traffic class: `sign-in`, `dashboard-read` (the INS dashboard and both journey dashboards), `journey` (drafting, check answers before submit, the declaration), `post-submission-read` (the hub and notification view after submit), `amendment` (everything done while amending), `address-book` and `re-authentication` (a returning user's sign-in again after their session expired, in the endurance run). A page request is one navigation, so redirect hops and backend calls are not counted. A sign-in is recorded as a page request of its own, alongside the dashboard read it leads to. That is how the front door's core-page (C1) and dashboard-only session (C4) figures are counted, and it counts in the `dashboard_read_share` denominator.

| Metric                    | What it shows                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dashboard_read_share`    | The share of page requests that are dashboard reads, printed in k6's end-of-test summary                                                                                                                                        |
| `page_requests`           | Page requests, tagged by `traffic_class` and `frontend` (`ins`, `animals` or `plants`)                                                                                                                                          |
| `server_errors`           | The share of responses with a 5xx status. `http_req_failed` also counts 4xx                                                                                                                                                     |
| `transport_errors`        | Requests that failed below HTTP (refused, reset or timed out), counted by status 0: the sign of a crashed service or one stuck behind an exhausted pool                                                                         |
| `reauthentications`       | Times a returning user signed in again after their session expired, tagged by `scenario`                                                                                                                                        |
| `downstream_dead_letters` | How many messages the gateway's dead-letter queue gained over the run, tagged `downstream:service-bus`                                                                                                                          |
| `post_submission_reads`   | Reads after submit                                                                                                                                                                                                              |
| `amendment_pages`         | Pages requested while amending                                                                                                                                                                                                  |
| `pages_per_notification`  | Journey pages one notification took, by scenario                                                                                                                                                                                |
| `session_seconds`         | How long a user session lasted, by scenario                                                                                                                                                                                     |
| `notifications_started`   | Notifications started, tagged by `notification_type`                                                                                                                                                                            |
| `document_scan_duration`  | Milliseconds from a document's upload response until its scan settled                                                                                                                                                           |
| `background_volume`       | The background volume each datastore held when the run started, tagged by `datastore`                                                                                                                                           |
| `stub_profile`            | The latency profile each stubbed integration ran, tagged by `integration` and `profile`                                                                                                                                         |
| `stub_profile_flagged`    | Whether each profile is unagreed or overdue, tagged by `integration` and `flag`                                                                                                                                                 |
| `stub_latency`            | Each stub's target and answered latency, tagged by `integration`, `source` and `quantile`                                                                                                                                       |
| `stub_load`               | The load a stub carried, tagged by `integration` and `measure` (`peak-per-second`, `mean-per-second`)                                                                                                                           |
| `stub_ceiling`            | The recorded ceiling the load was judged against, tagged by `integration`                                                                                                                                                       |
| `stub_headroom`           | 1 when the stub had headroom over the load it carried, 0 when it did not or when the integration carried no load and so was not judged (the summary's per-integration headroom line says 'not judged'), tagged by `integration` |
| `run_trusted`             | 1 when every stub the run went through had headroom, 0 when the run is untrusted                                                                                                                                                |

In a design-target run every journey metric also carries a `phase` tag.

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

Every threshold is scoped to its scenario, and response times are also scoped to an endpoint tag from the catalogue in `src/config/endpoints.js`. Scoping to the scenario keeps the readiness wait in `setup()` out of the measurement. A breached response-time, failed-request or check threshold aborts the run, after a 30 second evaluation delay. Dropped iterations are judged at the end of the run: they do not abort it, but they fail it. So is the document scan: a slow scan fails the run rather than cutting it short. The `notifications_started` thresholds (`count>=0`) are reporting-only and can never fail: they exist so the summary prints the split by notification type. The `background_volume` thresholds (`value>=0`) are reporting-only in the same way: they print each datastore's background volume. The `stub_profile`, `stub_profile_flagged` and `stub_latency` thresholds (`value>=0`) are reporting-only too: they print each stubbed integration's profile, flags and latency. The stub-ceiling suite gates only on the two-journey Defra ID sign-in target, and every other threshold it declares is reporting-only. The `stub_load`, `stub_ceiling`, `stub_headroom` and `run_trusted` thresholds (`value>=0`) are reporting-only too. The background-volume run gates on failed requests, checks and dropped iterations only, never on response times.

The design-target runs follow [Design-target runs](#design-target-runs). Sustained peak scopes response times to the `hold` phase, with the limits above, judged at the end of the run and never aborting (k6 counts the abort delay from the start of the test, so a hold that starts hours in would be judged on its first few samples), and scopes failed requests, checks and dropped iterations to the whole scenario. The burst run gates on 5xx under 1% in the burst minute (no abort), checks over 99% and no dropped iteration, and on the relative burst rule: P95 in the burst minute no worse than twice the peak phase's P95, worked out in `handleSummary` and failing the run with exit code 99. The average-load run judges response times over the whole run with the limits above, never aborting, and failed requests and checks with the same limits, also judged at the end and never aborting, and dropped iterations as sustained peak does; its per-hour `page_requests`, `notifications_started`, `session_seconds` and `dashboard_read_share` keys are reporting-only. The spike run judges response times in the `baseline` phase and failed requests, checks and dropped iterations over the whole scenario, all at the end and never aborting; sign-in failures in the spike and recovery phases and any dead-letter growth fail it, and its spike-phase response times are reported, never gated, because recovery is the rule. The endurance run judges response times, failed requests, checks and dropped iterations over the whole run, never aborting, plus no `transport_errors` in any scenario, at least one `reauthentications` for each returning user and no dead-letter growth. The with-IUU profile's thresholds are all reporting-only. Their per-phase `page_requests`, `session_seconds` and similar keys are reporting-only too, so k6 keeps their figures for the report.

## Add a suite

1. Add `src/suites/<suite>.k6.js`. Name it after the test type and what it covers, for example `load-notification-submit.k6.js`.
2. Get service URLs from `resolveServiceUrl(__ENV, '<service-name>')` in `src/config/target.js`.
3. Give each scenario its thresholds with `scenarioThresholds` in `src/config/thresholds.js`. Tag requests with an endpoint from the catalogue in `src/config/endpoints.js`, which also sets the `name` tag. Follow the workspace's k6 best practices.
4. Put any logic worth testing in `src/config/` (or a new folder under `src/`) with a `*.test.js` beside it.
5. A suite that measures load reports the background volume and calls `requireBackgroundVolume` in `setup()` (both in `src/k6/background-volume.js`), so it never measures an empty environment.
6. Every suite reports the stub profiles at the start and the end of a run (`readStubProfiles` and `reportStubProfiles` in `src/k6/stub-profiles.js`). A design-target, breakpoint or resilience suite that measures INS also calls `requireStubProfiles(stubProfiles, SLA_PROFILE)` in `setup()`, in code, whatever `STUB_PROFILE` says, except in `local`, where a run is a script check, so it never measures against stubs that answer at once. In `setup()`, straight after the start `reportStubProfiles` call (and after `requireStubProfiles` where the suite has one), call `clearStubAnswered({ urls })`, so the end-of-run answered figures cover only this run. A suite that measures INS also takes `Date.now()` straight after that clear, returns it from `setup()` as `stubLoadSince`, and calls `reportStubHeadroom` in `teardown()` with it (`src/k6/stub-ceilings.js`), so the run reports each stub's headroom and whether it can be trusted.
7. Run it with `npm run k6:local -- run --no-usage-report src/suites/<suite>.k6.js`.
8. A design-target shape is added to `src/config/design-target.js` and gets a two-line suite: import `createDesignTargetRun` and re-export what it returns.
9. To make CDP run it by default in an environment, change `default_suite` in `entrypoint.sh`. Otherwise set `TEST_SUITE` to `<suite>` on the run.

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
