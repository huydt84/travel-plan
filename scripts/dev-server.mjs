import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { cleanupStaleDevProcesses } from "./dev-process-cleanup.mjs";

const DEFAULT_DEV_MAX_OLD_SPACE_SIZE_MB = 3072;

export function createDevEnvironment(environment = process.env) {
  const existingNodeOptions = environment.NODE_OPTIONS?.trim() ?? "";
  const hasExplicitHeapLimit = /(?:^|\s)--max[-_]old[-_]space[-_]size(?:=|\s)/.test(
    existingNodeOptions,
  );
  const nodeOptions = hasExplicitHeapLimit
    ? existingNodeOptions
    : [existingNodeOptions, `--max-old-space-size=${DEFAULT_DEV_MAX_OLD_SPACE_SIZE_MB}`]
        .filter(Boolean)
        .join(" ");

  return {
    ...environment,
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: nodeOptions,
  };
}

export function runDevServer({
  projectDir = process.cwd(),
  args = process.argv.slice(2),
} = {}) {
  cleanupStaleDevProcesses({ projectDir });

  // pnpm forwards flags without `--`, but accepting it avoids treating the
  // separator as a Next.js project directory when developers use npm syntax.
  const nextArgs = args[0] === "--" ? args.slice(1) : args;

  const nextCli = join(projectDir, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextCli)) {
    throw new Error("Next.js is not installed. Run pnpm install --frozen-lockfile first.");
  }

  const child = spawn(process.execPath, [nextCli, "dev", ...nextArgs], {
    cwd: projectDir,
    env: createDevEnvironment(),
    stdio: "inherit",
  });

  let forwardedSignal;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      forwardedSignal = signal;
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    });
  }

  child.once("error", (error) => {
    console.error(`Unable to start the Next.js development server: ${error.message}`);
    process.exitCode = 1;
  });
  child.once("close", (code, signal) => {
    cleanupStaleDevProcesses({ projectDir });
    process.exitCode = code ?? (forwardedSignal || signal ? 0 : 1);
  });

  return child;
}

const isMain = process.argv[1] &&
  pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runDevServer();
}
