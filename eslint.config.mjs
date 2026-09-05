import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  { rules: { "no-undef": "error" } },
  globalIgnores([
    ".next/**",
    "app/.well-known/workflow/**",
    ".workflow-data/**",
    ".next-playwright/**",
    "out/**",
    "build/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
]);
