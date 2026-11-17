// What the tests share: a page as ws's shell serves it, and a way to wait
// for the port.

import { Window } from "happy-dom";
import { afterEach } from "vitest";
import type { Client } from "../src/index.js";
import type { FakeHost } from "../src/testing.js";

const opened: { close(): unknown }[] = [];

// Whatever a test opened is closed after it: clients, hosts and windows.
afterEach(async () => {
  for (const o of opened.splice(0)) await o.close();
});

export function closing<T extends { close(): unknown }>(o: T): T {
  opened.push(o);
  return o;
}

// A page as the shell is: an empty #root, in a window of its own.
export function shell(): { window: Window; document: Document } {
  const window = closing(new Window({ url: "http://ws.test/plugin-frame/fake/" }));
  window.document.body.innerHTML = '<div id="root"></div>';
  // happy-dom's Document is the DOM's in all the client uses of it.
  return { window, document: window.document as unknown as Document };
}

// Whatever the page sent before this has reached the host once it
// resolves: the port keeps order, so a title sent now arrives after them.
// It's looked for in host.sent, and left for next() like any other.
let marks = 0;
export async function settled(ws: Client, host: FakeHost): Promise<void> {
  const mark = `settled ${++marks}`;
  ws.setTitle(mark);
  while (!host.sent.some((m) => m.type === "ws:title" && m.title === mark)) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
