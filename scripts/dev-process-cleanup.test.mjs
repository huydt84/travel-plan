import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanupStaleDevProcesses,
  findStaleDevProcesses,
  parseProcessTable,
} from "./dev-process-cleanup.mjs";
import { createDevEnvironment } from "./dev-server.mjs";

const projectDir = "/workspace/travel-plan";

test("parses the POSIX process table used by the cleanup probe", () => {
  const processes = parseProcessTable(`
  41     1 Ss   node /workspace/travel-plan/node_modules/next/dist/telemetry/detached-flush.js dev /workspace/travel-plan _events_40.json
  42    41 S    /workspace/travel-plan/node_modules/@esbuild/bin/esbuild --service=0.28.2 --ping
`);

  assert.deepEqual(processes, [
    {
      pid: 41,
      ppid: 1,
      command: "node /workspace/travel-plan/node_modules/next/dist/telemetry/detached-flush.js dev /workspace/travel-plan _events_40.json",
    },
    {
      pid: 42,
      ppid: 41,
      command: "/workspace/travel-plan/node_modules/@esbuild/bin/esbuild --service=0.28.2 --ping",
    },
  ]);
});

test("selects only stale telemetry and esbuild processes owned by this project", () => {
  const processes = [
    {
      pid: 100,
      ppid: 1,
      command: `node ${projectDir}/node_modules/next/dist/telemetry/detached-flush.js dev ${projectDir} _events_99.json`,
    },
    {
      pid: 101,
      ppid: 100,
      command: `${projectDir}/node_modules/@esbuild/bin/esbuild --service=0.28.2 --ping`,
    },
    {
      pid: 102,
      ppid: 1,
      command: `${projectDir}/node_modules/@esbuild/bin/esbuild --service=0.28.2 --ping`,
    },
    {
      pid: 200,
      ppid: 199,
      command: `${projectDir}/node_modules/@esbuild/bin/esbuild --service=0.28.2 --ping`,
    },
    {
      pid: 300,
      ppid: 1,
      command: "node /workspace/other/node_modules/next/dist/telemetry/detached-flush.js dev /workspace/other _events_299.json",
    },
    {
      pid: 301,
      ppid: 300,
      command: "/workspace/other/node_modules/@esbuild/bin/esbuild --service=0.28.2 --ping",
    },
  ];

  assert.deepEqual(
    findStaleDevProcesses(processes, projectDir).map(({ pid }) => pid),
    [101, 100, 102],
  );
});

test("terminates the selected processes and leaves active development work alone", () => {
  const killed = [];
  const processes = [
    {
      pid: 100,
      ppid: 1,
      command: `node ${projectDir}/node_modules/next/dist/telemetry/detached-flush.js dev ${projectDir} _events_99.json`,
    },
    {
      pid: 101,
      ppid: 100,
      command: `${projectDir}/node_modules/@esbuild/bin/esbuild --service=0.28.2 --ping`,
    },
    {
      pid: 200,
      ppid: 199,
      command: `${projectDir}/node_modules/@esbuild/bin/esbuild --service=0.28.2 --ping`,
    },
  ];

  const result = cleanupStaleDevProcesses({
    projectDir,
    processes,
    kill: (pid, signal) => killed.push([pid, signal]),
    log: () => {},
  });

  assert.equal(result.terminated, 2);
  assert.deepEqual(killed, [
    [101, "SIGTERM"],
    [100, "SIGTERM"],
  ]);
});

test("forces telemetry off without discarding the caller's development environment", () => {
  assert.deepEqual(createDevEnvironment({ LOCAL_ADMIN_BYPASS: "true" }), {
    LOCAL_ADMIN_BYPASS: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: "--max-old-space-size=3072",
  });
});

test("preserves a developer's explicit heap limit", () => {
  assert.equal(
    createDevEnvironment({ NODE_OPTIONS: "--max-old-space-size=4096 --trace-warnings" }).NODE_OPTIONS,
    "--max-old-space-size=4096 --trace-warnings",
  );
});
