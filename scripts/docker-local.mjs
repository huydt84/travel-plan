import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const commands = {
  up: ["compose", "up", "-d", "--wait", "db"],
  down: ["compose", "down"],
};

const action = process.argv[2];
if (!commands[action]) {
  console.error("Usage: node scripts/docker-local.mjs <up|down>");
  process.exit(1);
}

const env = { ...process.env };
const rancherSocket = join(homedir(), ".rd", "docker.sock");
const defaultDockerAvailable = !env.DOCKER_HOST && spawnSync("docker", ["info"], {
  env,
  stdio: "ignore",
}).status === 0;
if (!env.DOCKER_HOST && !defaultDockerAvailable && existsSync(rancherSocket)) {
  env.DOCKER_HOST = `unix://${rancherSocket}`;
}

const child = spawn("docker", commands[action], { cwd: process.cwd(), env, stdio: "inherit" });
child.on("error", (error) => {
  console.error(`Unable to start Docker CLI: ${error.message}`);
  process.exitCode = 1;
});
child.on("close", (code) => {
  process.exitCode = code ?? 1;
});
