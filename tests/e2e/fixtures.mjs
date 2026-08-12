import { expect, test as base } from "@playwright/test";

export const test = base.extend({
  runtimeHealth: [async ({ page }, use) => {
    const failures = [];

    page.on("console", (message) => {
      if (message.type() === "error") failures.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
    page.on("response", (response) => {
      if (response.status() >= 500) failures.push(`http ${response.status()}: ${response.url()}`);
    });

    await use(failures);

    expect(failures, "browser runtime and same-app responses must stay healthy").toEqual([]);
  }, { auto: true }],
});

export { expect };

export async function gotoHealthy(page, path) {
  const response = await page.goto(path);
  expect(response, `navigation to ${path} should return a response`).not.toBeNull();
  expect(response.status(), `navigation to ${path} should not be an HTTP error`).toBeLessThan(400);
  return response;
}
