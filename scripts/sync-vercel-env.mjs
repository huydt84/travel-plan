import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const template = await readFile(new URL("../.env.template", import.meta.url), "utf8");
const variableNames = [...template.matchAll(/^([A-Z][A-Z0-9_]*)\s*=/gm)]
  .map((match) => match[1])
  .filter((name) => !name.startsWith("LOCAL_"));
if (!variableNames.length) throw new Error(".env.template does not declare any deployable environment variables.");

for (const name of variableNames) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing from the process environment.`);
  const child = spawn(
    "npx",
    ["vercel", "env", "add", name, "production,preview", "--force", "--sensitive", "--yes"],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  child.stdin.end(value);
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) throw new Error(`Vercel CLI exited with code ${exitCode}.`);
}
