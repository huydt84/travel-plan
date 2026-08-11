import { spawn } from "node:child_process";

const variables = {
  POSTGRES_URI: process.env.POSTGRES_URI,
  AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
  AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
  AUTH_SECRET: process.env.AUTH_SECRET,
  AUTH_OWNER_EMAIL: process.env.AUTH_OWNER_EMAIL,
  APP_URL: process.env.APP_URL,
};

for (const [name, value] of Object.entries(variables)) {
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
