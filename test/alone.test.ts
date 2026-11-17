// @vitest-environment happy-dom
//
// connect() with nothing given, as an app calls it: the page's own
// document and window.parent. Here the page is opened alone, with no frame
// around it.

import { expect, test } from "vitest";
import { NoHostError, connect } from "../src/index.js";

test("a page that isn't in a frame fails at once with a NoHostError", async () => {
  expect(window.parent).toBe(window);
  const started = Date.now();

  const err: unknown = await connect().catch((e: unknown) => e);

  expect(err).toBeInstanceOf(NoHostError);
  expect((err as NoHostError).message).toMatch(/isn't in a frame/);
  expect(Date.now() - started).toBeLessThan(1000); // not the 5 seconds of no answer
});
