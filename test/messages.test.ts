import { describe, expect, test } from "vitest";
import { type Theme, connect } from "../src/index.js";
import { fakeHost } from "../src/testing.js";
import { closing, settled } from "./page.js";

async function connected(options: Parameters<typeof fakeHost>[0] = {}) {
  const host = closing(fakeHost(options));
  const ws = closing(await connect({ host: host.window }));
  return { host, ws };
}

describe("from the page", () => {
  test("setPath sends ws:path, and the path follows", async () => {
    const { host, ws } = await connected({ path: "/browse/PROJ-1" });

    ws.setPath("/browse/PROJ-2?tab=links");

    expect(await host.next("ws:path")).toEqual({ type: "ws:path", path: "/browse/PROJ-2?tab=links" });
    expect(ws.path).toBe("/browse/PROJ-2?tab=links");
  });

  test("setPath to where ws's address already is sends nothing", async () => {
    const { host, ws } = await connected({ path: "/board" });

    ws.setPath("/board");
    await settled(ws, host);

    expect(host.sent.filter((m) => m.type === "ws:path")).toEqual([]);
  });

  test("setPath takes only a path in the plugin", async () => {
    const { ws } = await connected();
    expect(() => ws.setPath("board")).toThrow(TypeError);
    expect(() => ws.setPath("https://example.com/")).toThrow(/starts with "\/"/);
  });

  test("setTitle sends ws:title", async () => {
    const { host, ws } = await connected();

    ws.setTitle("PROJ-2 Token cache");

    expect(await host.next("ws:title")).toEqual({ type: "ws:title", title: "PROJ-2 Token cache" });
  });

  test("open sends ws:open, and leaves what it does to ws", async () => {
    const { host, ws } = await connected();

    ws.open("/missions/token-cache");
    ws.open("https://example.com/");

    expect(await host.next("ws:open")).toEqual({ type: "ws:open", path: "/missions/token-cache" });
    expect(await host.next("ws:open")).toEqual({ type: "ws:open", path: "https://example.com/" });
  });

  test("the host keeps everything the page sent, in order", async () => {
    const { host, ws } = await connected();

    ws.setTitle("One");
    ws.setPath("/two");
    ws.open("/three");
    await settled(ws, host);

    expect(host.sent.map((m) => m.type)).toEqual(["ws:title", "ws:path", "ws:open", "ws:title"]);
  });

  test("next gives each message once, whether it came before the asking or after", async () => {
    const { host, ws } = await connected();

    ws.setTitle("One");
    ws.setTitle("Two");
    await settled(ws, host); // both have arrived
    const later = host.next("ws:path");
    ws.setPath("/later");

    expect((await host.next("ws:title")).title).toBe("One");
    expect((await host.next("ws:title")).title).toBe("Two");
    expect((await later).path).toBe("/later");
  });

  test("next says so when the page sends nothing", async () => {
    const { host } = await connected();
    await expect(host.next("ws:open", { timeout: 20 })).rejects.toThrow("The page sent no ws:open within 20ms.");
  });
});

describe("from ws", () => {
  test("ws:navigate runs onNavigate, and the path follows", async () => {
    const { host, ws } = await connected({ path: "/" });
    const moved = new Promise<string>((resolve) => ws.onNavigate(resolve));

    host.navigate("/board?mine=1");

    expect(await moved).toBe("/board?mine=1");
    expect(ws.path).toBe("/board?mine=1");
  });

  test("the app saying where ws just sent it sends nothing back", async () => {
    const { host, ws } = await connected({ path: "/" });
    // An app's router, kept in step both ways.
    ws.onNavigate((path) => ws.setPath(path));
    const moved = new Promise<string>((resolve) => ws.onNavigate(resolve));

    host.navigate("/board");
    await moved;
    await settled(ws, host);

    expect(host.sent.filter((m) => m.type === "ws:path")).toEqual([]);
  });

  test("ws:changed runs onChanged", async () => {
    const { host, ws } = await connected();
    let count = 0;
    const twice = new Promise<void>((resolve) => ws.onChanged(() => ++count === 2 && resolve()));

    host.changed();
    host.changed();

    await twice;
    expect(count).toBe(2);
  });

  test("ws:theme runs onTheme with the theme, and the theme follows", async () => {
    const { host, ws } = await connected({ scheme: "light" });
    const light = ws.theme.vars["--ws-bg"];
    const themed = new Promise<Theme>((resolve) => ws.onTheme(resolve));

    host.theme({ scheme: "dark", vars: { "--ws-accent": "#ff00aa" } });

    const theme = await themed;
    expect(theme.scheme).toBe("dark");
    expect(theme.vars["--ws-accent"]).toBe("#ff00aa");
    expect(theme.vars["--ws-bg"]).not.toBe(light);
    expect(ws.theme).toBe(theme);
  });

  test("what an on… returns stops it", async () => {
    const { host, ws } = await connected();
    const heard: string[] = [];
    const stop = ws.onNavigate((path) => heard.push(`stopped ${path}`));
    ws.onNavigate((path) => heard.push(path));

    host.navigate("/one");
    await new Promise<void>((resolve) => ws.onNavigate(() => resolve()));
    stop();
    host.navigate("/two");
    await new Promise<void>((resolve) => ws.onNavigate(() => resolve()));

    expect(heard).toEqual(["stopped /one", "/one", "/two"]);
  });

  test("a message the page doesn't know is dropped", async () => {
    const { host, ws } = await connected({ path: "/" });
    const changed = new Promise<void>((resolve) => ws.onChanged(resolve));
    let moved = false;
    ws.onNavigate(() => (moved = true));

    host.send({ type: "ws:later", much: true }); // from a release after this one
    host.send({ type: "ws:navigate" }); // not as protocol 1 has it
    host.send("not a message");
    host.changed();

    await changed;
    expect(moved).toBe(false);
    expect(ws.path).toBe("/");
  });

  test("after close the page hears nothing more", async () => {
    const { host, ws } = await connected();
    let heard = 0;
    ws.onChanged(() => heard++);

    ws.close();
    host.changed();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(heard).toBe(0);
  });
});
