# TypeScript language features benchmark

This Node 26 npm-workspace monorepo measures the startup responsiveness and JavaScript heap of the TypeScript language-features worker in the official LVCE Editor Debian package. It also captures a Chromium CPU profile of the worker and publishes separate readiness/memory and CPU breakdown pages.

## Run locally

On Ubuntu 26.04 with Node 26, npm, `dpkg-deb`, `tar`, `strace`, Electron runtime libraries, and an X server or Xvfb:

```sh
npm ci
npm run setup
npm run setup:comparison
xvfb-run -a npm run benchmark -- --iterations 5
xvfb-run -a npm run benchmark:comparison
npm run report
```

`setup` extracts the pinned official LVCE Editor `v0.119.1` amd64 Debian release after verifying its published SHA-256 digest, then downloads and verifies TypeScript language-features `v5.25.3`. The extracted binary runs without replacing the system installation. Each fresh trial profile installs that extension over the editor's bundled copy so the benchmark uses the pinned producer release. Setup checks out the pinned `about-view` revision and installs that fixture's dependencies. Each trial opens `packages/about-view/src/aboutWorkerMain.ts` in the fixture workspace.

## Measurement boundaries

Readiness is measured from application launch until the TypeScript worker returns a fresh `Diagnostic.getPerformanceTrace` response for the opened fixture file with no diagnostic error. The timer includes worker discovery and the diagnostic response. A Chromium CPU profile is collected during a second, warm trace request so profiling does not change the cold readiness measurement. Each request has a five-minute timeout, adjustable with `--timeout-ms`. Every trial gets a new Chromium user-data directory and isolated XDG config, data, cache, and state paths; the editor process tree is stopped before those files are removed.

Memory is the worker's V8 `Runtime.getHeapUsage().usedSize` after profile collection. It excludes native and external memory and must not be read as total extension process RSS. Missing worker targets, CDP failures, invalid memory readings, and timeouts are recorded as failed trials and fail the run; no missing reading is presented as zero.

The dashboard shows median values from successful cold launches, raw trials and their version metadata. Its startup chart breaks the readiness stopwatch into sequential launch-to-CDP, page, worker-discovery, protocol, fixture-read and first-diagnostic intervals, plus any remaining time. `breakdown.html` charts total duration and stages from the first actual diagnostic pass, and links each raw first-pass trace. A successful cold trace must report a newly created language service; a reused service is not accepted as a cold measurement. The report charts per-method synchronous RPC call counts and durations alongside the separate warm CPU profile. Diagnostic stages may nest, and RPC calls occur inside those stages, so their durations overlap and are not summed. RPC duration includes transport and waiting; it does not isolate filesystem-process execution time. The CPU profile remains a separate warm measurement. CI pins the Ubuntu 26.04 runner, Node 26, editor tag, extension release and fixture commit. Update these versions intentionally when refreshing the benchmark baseline.

The CPU breakdown page also lists the distinct files in the TypeScript compiler program after semantic diagnostics, ordered by UTF-8 source-text size. This includes loaded declaration libraries (including cached TypeScript libraries); project files that were only discovered but not loaded are excluded. The chart uses the first successful cold trial and reports exact byte counts alongside readable sizes.

## LVCE Editor / VS Code comparison

`comparison.html` adds paired launch-to-visible-error, files-read and stat-call charts while retaining the original LVCE worker reports. Setup pins VS Code 1.140.0 (commit `07f806f999227108933c2e30515b26eecc1fda74`) and verifies its archive SHA-256. Both editors use the same generated fixture version 1: 5,000 independent exported TypeScript modules plus `benchmark.ts`, which imports them all and contains exactly one deliberate TS2322 error on line 1. The content digest, editor/extension/TypeScript versions, platform, and Node version accompany `results/comparison.json`. This synthetic large project is reproducible, but is not representative of every real repository.

Three iterations each run both editors with fresh profiles, alternating editor order. Each pair has an untraced timing trial and a separate traced filesystem trial. The operating-system page cache is retained; these are cold editor profiles, not cold disk-cache measurements. All shipped built-in extensions remain enabled. No user-installed extensions are included. VS Code trust prompts, welcome content, telemetry and updates are disabled in the isolated profile. LVCE diagnostics are enabled explicitly.

The stopwatch starts immediately before launching the executable and stops at CDP observation of a visible error underline. It includes startup, project loading, TypeScript activation and observer overhead; it is not isolated extension activation time. After stopping the stopwatch, VS Code must show the expected error message on hover. LVCE's pinned diagnostic hover is unavailable, so its visible underline is validated against the sole first-line TS2322 diagnostic returned by the worker API, after the measured boundary. Neither adapter makes a diagnostic request to trigger readiness. Screenshots retain visible evidence.

Linux `strace -f -yy -ttt` follows the entire editor process tree, including threads, language servers and filesystem workers. The filesystem interval starts before the traced launch and ends at the visible underline, before verification or screenshots. Both syscall entry and completion must fall within the interval. Counts include successful and failed `stat`, `lstat`, `fstat`, `newfstatat`, and `statx` attempts. “Files read” counts distinct absolute descriptor paths with positive `read`, `pread64`, `readv`, `preadv` or `preadv2` results. Repeated calls are reported separately. This includes application, library, project and profile paths, and excludes descriptor-less reads, memory-mapped accesses and IPC. It does not measure physical disk I/O, inode identity, or the compiler's loaded-file list. Trace strings are suppressed to avoid storing read buffers. Wall-clock boundaries have millisecond resolution.

Raw traces, screenshots, exact diagnostic evidence and launch logs accompany the CI artifact. Traced elapsed times never enter the timing chart. Failures/timeouts fail the benchmark, retain null readings and remain visible in reports; they are never converted to zeros. `COMPARISON_ITERATIONS=1` gives a short run; `COMPARISON_MODE=timing` or `filesystem` isolates a measurement for diagnosis; `COMPARISON_TIMEOUT_MS` adjusts the bounded per-launch readiness timeout (default five minutes). CI requires all four test platforms and the Ubuntu benchmark before merging and deploying Pages.
