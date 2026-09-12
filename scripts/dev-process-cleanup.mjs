import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/\/$/, "");
}

export function parseProcessTable(output) {
  return output
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+\S+\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      command: match[3],
    }));
}

function isProjectDetachedFlush(processInfo, projectDir) {
  const command = normalizePath(processInfo.command);
  const normalizedProjectDir = normalizePath(projectDir);
  return (
    processInfo.ppid === 1 &&
    command.includes("/next/dist/telemetry/detached-flush.js") &&
    (command.includes(` dev ${normalizedProjectDir} `) ||
      command.endsWith(` dev ${normalizedProjectDir}`))
  );
}

function isOrphanedProjectEsbuild(processInfo, projectDir) {
  const command = normalizePath(processInfo.command);
  const normalizedProjectDir = normalizePath(projectDir);
  return (
    processInfo.ppid === 1 &&
    command.startsWith(`${normalizedProjectDir}/node_modules/`) &&
    command.includes("/esbuild --service=")
  );
}

export function findStaleDevProcesses(processes, projectDir) {
  const childrenByParent = new Map();
  for (const processInfo of processes) {
    const children = childrenByParent.get(processInfo.ppid) ?? [];
    children.push(processInfo);
    childrenByParent.set(processInfo.ppid, children);
  }

  const selected = [];
  const selectedPids = new Set();
  const selectTreeChildrenFirst = (processInfo) => {
    for (const child of childrenByParent.get(processInfo.pid) ?? []) {
      selectTreeChildrenFirst(child);
    }
    if (!selectedPids.has(processInfo.pid)) {
      selected.push(processInfo);
      selectedPids.add(processInfo.pid);
    }
  };

  for (const processInfo of processes) {
    if (isProjectDetachedFlush(processInfo, projectDir)) {
      selectTreeChildrenFirst(processInfo);
    }
  }
  for (const processInfo of processes) {
    if (
      !selectedPids.has(processInfo.pid) &&
      isOrphanedProjectEsbuild(processInfo, projectDir)
    ) {
      selected.push(processInfo);
      selectedPids.add(processInfo.pid);
    }
  }

  return selected;
}

export function readProcessTable() {
  if (process.platform === "win32") {
    return [];
  }
  const output = execFileSync("ps", ["-axo", "pid=,ppid=,stat=,command="], {
    encoding: "utf8",
  });
  return parseProcessTable(output);
}

export function cleanupStaleDevProcesses({
  projectDir = process.cwd(),
  processes = readProcessTable(),
  kill = process.kill,
  log = console.log,
} = {}) {
  const staleProcesses = findStaleDevProcesses(processes, projectDir);
  let terminated = 0;

  for (const processInfo of staleProcesses) {
    try {
      kill(processInfo.pid, "SIGTERM");
      terminated += 1;
    } catch (error) {
      if (error?.code !== "ESRCH") {
        throw error;
      }
    }
  }

  if (terminated > 0) {
    log(`Cleaned up ${terminated} stale development process${terminated === 1 ? "" : "es"}.`);
  }
  return { terminated, staleProcesses };
}

const isMain = process.argv[1] &&
  pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(process.argv[1]).href;
if (isMain) {
  cleanupStaleDevProcesses();
}
