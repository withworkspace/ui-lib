import { describe, expect, test, vi } from "vitest";
import { NoHostError, ProtocolError, connect } from "../src/index.js";
import { type Connect, TOKENS, V1, isRefuse } from "../src/protocol.js";
import { fakeHost } from "../src/testing.js";
import { VERSION } from "../src/version.js";
import { closing } from "./page.js";

// A page that isn't the package's: a ws:connect by hand, and the first
// thing the host says back.
function connectByHand(host: ReturnType<typeof fakeHost>, versions: number[]): Promise<unknown> {
  const { port1, port2 } = channel();
  const hello: Connect = { type: "ws:connect", versions };
  return new Promise((resolve) => {
    port1.onmessage = (e) => resolve(e.data);
    host.window.postMessage(hello, "http://ws.test", [port2]);
  });
}

// A channel that's closed after the test: closing one port closes both.
function channel(): MessageChannel {
  const made = new MessageChannel();
  closing({ close: () => made.port1.close() });
  return made;
}

describe("the handshake", () => {
  test("connects: the page lists its versions and ws welcomes it in one", async () => {
    const host = closing(fakeHost({ name: "jira", path: "/browse/PROJ-1?tab=links", scheme: "dark" }));
    const ws = closing(await connect({ host: host.window }));

    expect(host.connects).toEqual([{ type: "ws:connect", versions: [1], client: `@withworkspace/ui-lib@${VERSION}` }]);
    expect(ws.version).toBe(1);
    expect(ws.name).toBe("jira");
    expect(ws.path).toBe("/browse/PROJ-1?tab=links");
    expect(ws.base).toBe("/plugin-frame/jira");
    expect(ws.api("/issues")).toBe("/plugins/jira/issues");
    expect(ws.api("issues")).toBe("/plugins/jira/issues");
    expect(ws.theme.scheme).toBe("dark");
  });

  test("the welcome's theme has a value for every token", async () => {
    const host = closing(fakeHost());
    const ws = closing(await connect({ host: host.window }));
    for (const token of TOKENS) expect(ws.theme.vars[`--ws-${token}`], token).toBeTruthy();
  });

  test("picks the highest version both speak", async () => {
    // A ws that has gone on to protocol 2 still answers a page that speaks 1.
    const ahead = closing(fakeHost({ versions: [1, 2] }));
    const ws = closing(await connect({ host: ahead.window }));
    expect(ws.version).toBe(1);

    // And a page that speaks more is welcomed in the highest ws speaks too.
    expect(await connectByHand(closing(fakeHost({ versions: [1, 2] })), [3, 1, 2])).toMatchObject({ type: "ws:welcome", version: 2 });
    expect(await connectByHand(closing(fakeHost()), [2, 1])).toMatchObject({ type: "ws:welcome", version: 1 });
  });

  test("refuses when no version is in common: the page is behind ws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = closing(fakeHost({ name: "jira", versions: [2] }));

    const err: unknown = await connect({ host: host.window }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProtocolError);
    const refused = err as ProtocolError;
    expect(refused.name).toBe("ProtocolError");
    expect(refused.page).toEqual([1]);
    expect(refused.host).toEqual([2]);
    expect(refused.message).toBe("jira speaks frame protocol 1, and this ws speaks 2. Update the plugin.");
    expect(logged).toHaveBeenCalledWith(refused);
  });

  test("refuses when no version is in common: the page is ahead of ws", async () => {
    const host = closing(fakeHost({ name: "jira" }));

    const answer = await connectByHand(host, [2]);

    expect(isRefuse(answer)).toBe(true);
    expect(answer).toEqual({ type: "ws:refuse", versions: [1], message: "jira speaks frame protocol 2, and this ws speaks 1. Update ws." });
    expect(host.connects).toEqual([{ type: "ws:connect", versions: [2] }]);
  });

  test("fails with a ProtocolError when ws welcomes it in a version it didn't offer", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // A host that answers every page in protocol 2, whatever it listed.
    const rude = {
      postMessage(_m: unknown, _origin: string, transfer: Transferable[]) {
        (transfer[0] as MessagePort).postMessage({ type: "ws:welcome", version: 2 });
      },
    };

    const err: unknown = await connect({ host: rude }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProtocolError);
    expect((err as ProtocolError).page).toEqual([1]);
    expect((err as ProtocolError).host).toEqual([2]);
    expect((err as ProtocolError).message).toMatch(/frame protocol 2/);
    expect(logged).toHaveBeenCalledOnce();
  });

  test("no answer within the timeout is a NoHostError", async () => {
    const host = closing(fakeHost({ silent: true }));
    const started = Date.now();

    const err: unknown = await connect({ host: host.window, timeout: 30 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NoHostError);
    expect((err as NoHostError).name).toBe("NoHostError");
    expect((err as NoHostError).message).toMatch(/didn't answer within 30ms/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    expect(host.connects).toHaveLength(1); // it asked, and nothing came back
  });

  test("waits 5 seconds for an answer unless it's told otherwise", async () => {
    vi.useFakeTimers();
    try {
      const host = closing(fakeHost({ silent: true }));
      let err: unknown;
      void connect({ host: host.window }).catch((e: unknown) => (err = e));

      await vi.advanceTimersByTimeAsync(4999);
      expect(err).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(err).toBeInstanceOf(NoHostError);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a message that isn't an answer doesn't end the wait", async () => {
    let port: MessagePort | undefined;
    const slow = {
      postMessage(_m: unknown, _origin: string, transfer: Transferable[]) {
        port = transfer[0] as MessagePort;
        port.postMessage({ type: "ws:later" });
        port.postMessage("not a message at all");
      },
    };
    const connecting = connect({ host: slow, timeout: 500 });
    const welcome: V1.Welcome = {
      type: "ws:welcome",
      version: 1,
      ws: "0.43.0",
      plugin: { name: "jira", base: "/plugin-frame/jira", api: "/plugins/jira" },
      path: "/",
      theme: { scheme: "light", vars: Object.fromEntries(TOKENS.map((t) => [`--ws-${t}`, "0"])) as V1.Vars },
      keys: { chords: [], bare: [], leaders: [], within: 0 },
    };
    port!.postMessage(welcome);

    const ws = closing(await connecting);
    expect(ws.version).toBe(1);
  });

  test("a host that's sent something other than ws:connect, or no port, ignores it", async () => {
    const host = closing(fakeHost());
    const { port2 } = channel();
    host.window.postMessage({ type: "ws:ready", path: "/" }, "http://ws.test", [port2]);
    host.window.postMessage({ type: "ws:connect", versions: [1] }, "http://ws.test", []);
    expect(host.connects).toEqual([]);
    expect(() => host.changed()).toThrow(/No page has connected/);
  });

  test("each connect has a port of its own, and the host drops the one before", async () => {
    const host = closing(fakeHost({ path: "/a" }));
    const first = closing(await connect({ host: host.window }));
    first.setPath("/b");
    await host.next("ws:path");

    // The frame loads again: a new page, which starts where ws's address is.
    const second = closing(await connect({ host: host.window }));
    expect(host.connects).toHaveLength(2);
    expect(second.path).toBe("/b");

    const moved = new Promise<string>((resolve) => second.onNavigate(resolve));
    let stale = false;
    first.onNavigate(() => (stale = true));
    host.navigate("/c");
    expect(await moved).toBe("/c");
    expect(stale).toBe(false);
  });
});
