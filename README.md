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

`setup` installs the pinned official LVCE Editor `v0.118.23` amd64 Debian release after verifying its published SHA-256 digest. It verifies the TypeScript language-features `v5.24.0` release, checks out the pinned `about-view` revision, and installs that fixture's dependencies. Each trial uses a new LVCE profile and opens `packages/about-view/src/aboutWorkerMain.ts` in the fixture workspace.

## Measurement boundaries

Readiness is measured from application launch until the `typescript.showPerformanceTrace` command returns a fresh diagnostic trace for the opened fixture file with no diagnostic error. The timer includes worker discovery, command dispatch, and the diagnostic response. A Chromium CPU profile is active during that same request. Every trial gets a new Chromium user-data directory and isolated XDG config, data, cache, and state paths; the editor process tree is stopped before those files are removed.

Memory is the worker's V8 `Runtime.getHeapUsage().usedSize` after profile collection. It excludes native and external memory and must not be read as total extension process RSS. Missing worker targets, CDP failures, invalid memory readings, and timeouts are recorded as failed trials and fail the run; no missing reading is presented as zero.

The dashboard shows median values from successful cold launches, raw trials and their version metadata. `breakdown.html` shows the extension's trace stages and synchronous RPC methods alongside CPU profile sampled self time grouped by function and URL. It does not add nested wall-clock durations or present CPU samples as blocked wall time. CI pins the Ubuntu 26.04 runner, Node 26, editor tag, extension release and fixture commit. Update these versions intentionally when refreshing the benchmark baseline.
