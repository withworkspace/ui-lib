import { describe, expect, test } from "vitest";
import { type Theme, connect } from "../src/index.js";
import { fakeHost, named } from "../src/testing.js";
import { closing, settled } from "./page.js";

async function connected(options: Parameters<typeof fakeHost>[0] = {}) {
  const host = closing(fakeHost(options));
  const ws = closing(await connect({ host: host.window }));
  return { host, ws };
}

describe("from the page", () => {
  test("go sends ws:go with ws's address, and the path follows only when ws says so", async () => {
    const { host, ws } = await connected({ name: "jira", path: "/browse/PROJ-1" });
    const moved = new Promise<string>((resolve) => ws.onNavigate(resolve));

    ws.go("/browse/PROJ-2?tab=links");

    expect(await host.next("ws:go")).toEqual({ type: "ws:go", path: "/x/jira/browse/PROJ-2?tab=links" });
    expect(await moved).toBe("/browse/PROJ-2?tab=links");
    expect(ws.path).toBe("/browse/PROJ-2?tab=links");
  });

  test("go with replace says so", async () => {
    const { host, ws } = await connected({ name: "jira" });

    ws.go("/board?q=cache", { replace: true });

    expect(await host.next("ws:go")).toEqual({ type: "ws:go", path: "/x/jira/board?q=cache", replace: true });
  });

  test("go takes only a path in the plugin", async () => {
    const { ws } = await connected();
    expect(() => ws.go("board")).toThrow(TypeError);
    expect(() => ws.go("https://example.com/")).toThrow(/starts with "\/"/);
  });

  test("href is a path in the plugin as ws's address", async () => {
    const { ws } = await connected({ name: "jira" });
    expect(ws.href("/browse/PROJ-2")).toBe("/x/jira/browse/PROJ-2");
    expect(ws.href("board")).toBe("/x/jira/board");
    expect(ws.href("/")).toBe("/x/jira/");
  });

  test("setTitle sends ws:title", async () => {
    const { host, ws } = await connected();

    ws.setTitle("PROJ-2 Token cache");

    expect(await host.next("ws:title")).toEqual({ type: "ws:title", title: "PROJ-2 Token cache" });
  });

  test("open sends ws:go as it's given, and leaves what it does to ws", async () => {
    const { host, ws } = await connected({ path: "/" });

    ws.open("/missions/token-cache");
    ws.open("https://example.com/");

    expect(await host.next("ws:go")).toEqual({ type: "ws:go", path: "/missions/token-cache" });
    expect(await host.next("ws:go")).toEqual({ type: "ws:go", path: "https://example.com/" });
    expect(ws.path).toBe("/"); // neither is in the plugin
  });

  test("the host keeps everything the page sent, in order", async () => {
    const { host, ws } = await connected();

    ws.setTitle("One");
    ws.go("/two");
    ws.open("/three");
    await settled(ws, host);

    expect(host.sent.map((m) => m.type)).toEqual(["ws:title", "ws:go", "ws:go", "ws:title"]);
  });

  test("next gives each message once, whether it came before the asking or after", async () => {
    const { host, ws } = await connected();

    ws.setTitle("One");
    ws.setTitle("Two");
    await settled(ws, host); // both have arrived
    const later = host.next("ws:go");
    ws.go("/later");

    expect((await host.next("ws:title")).title).toBe("One");
    expect((await host.next("ws:title")).title).toBe("Two");
    expect((await later).path).toBe("/x/fake/later");
  });

  test("next says so when the page sends nothing", async () => {
    const { host } = await connected();
    await expect(host.next("ws:go", { timeout: 20 })).rejects.toThrow("The page sent no ws:go within 20ms.");
  });
});

describe("refs", () => {
  const issues = named({ "PROJ-12": "/x/jira/browse/PROJ-12", "PROJ-7": { href: "https://jira.example/browse/PROJ-7", kind: "thing", ref: "seven" } });

  test("findRefs asks ws, and resolves with what it found in each text", async () => {
    const { host, ws } = await connected({ refs: issues });

    const found = await ws.findRefs(["See PROJ-12 for more", "nothing here", "PROJ-7"]);

    expect(await host.next("ws:refs")).toEqual({ type: "ws:refs", id: 1, texts: ["See PROJ-12 for more", "nothing here", "PROJ-7"] });
    expect(found).toEqual([
      [{ from: 4, to: 11, ref: "PROJ-12", kind: "thing", href: "/x/jira/browse/PROJ-12" }],
      [],
      [{ from: 0, to: 6, ref: "seven", kind: "thing", href: "https://jira.example/browse/PROJ-7" }],
    ]);
  });

  test("askings made together go to ws as one, and each gets its own answer", async () => {
    const { host, ws } = await connected({ refs: issues });

    const [rows, title, none] = await Promise.all([ws.findRefs(["PROJ-12 first", "then PROJ-7"]), ws.findRefs(["About PROJ-12"]), ws.findRefs([])]);
    await settled(ws, host);

    expect(host.sent.filter((m) => m.type === "ws:refs")).toEqual([{ type: "ws:refs", id: 1, texts: ["PROJ-12 first", "then PROJ-7", "About PROJ-12"] }]);
    expect(rows.map((of) => of.map((f) => f.from))).toEqual([[0], [5]]);
    expect(title.map((of) => of.map((f) => f.from))).toEqual([[6]]);
    expect(none).toEqual([]);
  });

  test("a later asking is another message, with the next id", async () => {
    const { host, ws } = await connected({ refs: issues });

    await ws.findRefs(["PROJ-12"]);
    await ws.findRefs(["PROJ-7"]);

    expect((await host.next("ws:refs")).id).toBe(1);
    expect((await host.next("ws:refs")).id).toBe(2);
  });

  test("a ws from before it could be asked isn't asked, and nothing is found", async () => {
    const { host, ws } = await connected({ refs: false });

    expect(await ws.findRefs(["See PROJ-12 for more", "PROJ-7"])).toEqual([[], []]);
    await settled(ws, host);

    expect(host.sent.filter((m) => m.type === "ws:refs")).toEqual([]);
  });

  test("a host that finds nothing answers with nothing for each text", async () => {
    const { ws } = await connected();
    expect(await ws.findRefs(["See PROJ-12 for more", "PROJ-7"])).toEqual([[], []]);
  });

  test("ws:refs-changed runs onRefsChanged, and asking again gets what's found now", async () => {
    const { host, ws } = await connected({ refs: named({}) });
    expect(await ws.findRefs(["About PROJ-12"])).toEqual([[]]);
    const changed = new Promise<void>((resolve) => ws.onRefsChanged(resolve));

    host.refsChanged(issues);

    await changed;
    expect((await ws.findRefs(["About PROJ-12"]))[0]).toHaveLength(1);
  });

  test("an answer that isn't as protocol 1 has it is dropped, and one for no asking does nothing", async () => {
    const { host, ws } = await connected({ refs: issues });
    const changed = new Promise<void>((resolve) => ws.onChanged(resolve));

    host.send({ type: "ws:refs-found", id: 9, found: [[{ from: 0, to: 4, ref: "x", kind: "thing", href: "/" }]] });
    host.send({ type: "ws:refs-found", id: 1, found: "PROJ-12" });
    host.changed();
    await changed;

    expect(await ws.findRefs(["PROJ-12"])).toEqual([[{ from: 0, to: 7, ref: "PROJ-12", kind: "thing", href: "/x/jira/browse/PROJ-12" }]]);
  });

  test("closing settles what's still asked for with nothing found, and what's asked after it", async () => {
    const { ws } = await connected({ refs: issues });

    const asked = ws.findRefs(["PROJ-12"]);
    ws.close();

    expect(await asked).toEqual([[]]);
    expect(await ws.findRefs(["PROJ-12"])).toEqual([[]]);
  });

  test("named finds whole names only, none over another", () => {
    const find = named({ PROJ: "/p", "PROJ-1": "/1", "PROJ-12": "/12" });
    expect(find("PROJ-12, PROJ-1 and PROJ; not PROJ-123, xPROJ-1 or docs/PROJ-1.md").map((f) => [f.from, f.to, f.href])).toEqual([
      [0, 7, "/12"],
      [9, 15, "/1"],
      [20, 24, "/p"],
    ]);
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

  test("the app moving when it's told sends nothing back", async () => {
    const { host, ws } = await connected({ path: "/" });
    const moved = new Promise<string>((resolve) => ws.onNavigate(resolve));

    host.navigate("/board");
    await moved;
    await settled(ws, host);

    expect(host.sent.filter((m) => m.type === "ws:go")).toEqual([]);
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

  test("ws:outside runs onOutside: a press in ws, outside the frame", async () => {
    const { host, ws } = await connected();
    let count = 0;
    const twice = new Promise<void>((resolve) => ws.onOutside(() => ++count === 2 && resolve()));

    host.outside();
    host.outside();

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
