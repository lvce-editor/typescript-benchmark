# TypeScript language features benchmark

This Node 26 npm-workspace monorepo measures the startup responsiveness and JavaScript heap of the TypeScript language-features worker in the official LVCE Editor Debian package. It also captures a Chromium CPU profile of the worker and publishes separate readiness/memory and CPU breakdown pages.

## Run locally

On Ubuntu 26.04 with Node 26, npm, `sudo`, and an X server or Xvfb:

```sh
npm ci
npm run setup
xvfb-run -a npm run benchmark -- --iterations 5
npm run report
```

`setup` installs the pinned official LVCE Editor `v0.119.1` amd64 Debian release after verifying its published SHA-256 digest. The Debian package bundles TypeScript language-features `v5.25.2`; trials use that bundled extension. Setup checks out the pinned `about-view` revision and installs that fixture's dependencies. Each trial uses a new LVCE profile and opens `packages/about-view/src/aboutWorkerMain.ts` in the fixture workspace.

## Measurement boundaries

Readiness is measured from application launch until the TypeScript worker returns a fresh `Diagnostic.getPerformanceTrace` response for the opened fixture file with no diagnostic error. The timer includes worker discovery and the diagnostic response. A Chromium CPU profile is collected during a second, warm trace request so profiling does not change the cold readiness measurement. Each request has a five-minute timeout, adjustable with `--timeout-ms`. Every trial gets a new Chromium user-data directory and isolated XDG config, data, cache, and state paths; the editor process tree is stopped before those files are removed.

Memory is the worker's V8 `Runtime.getHeapUsage().usedSize` after profile collection. It excludes native and external memory and must not be read as total extension process RSS. Missing worker targets, CDP failures, invalid memory readings, and timeouts are recorded as failed trials and fail the run; no missing reading is presented as zero.

The dashboard shows median values from successful cold launches, raw trials and their version metadata. `breakdown.html` shows the extension's trace stages and synchronous RPC methods alongside CPU profile sampled self time grouped by function and URL. It does not add nested wall-clock durations or present CPU samples as blocked wall time. CI pins the Ubuntu 26.04 runner, Node 26, editor tag, extension release and fixture commit. Update these versions intentionally when refreshing the benchmark baseline.

The CPU breakdown page also lists the distinct files in the TypeScript compiler program after semantic diagnostics, ordered by UTF-8 source-text size. This includes loaded declaration libraries (including cached TypeScript libraries); project files that were only discovered but not loaded are excluded. The chart uses the first successful cold trial and reports exact byte counts alongside readable sizes.
