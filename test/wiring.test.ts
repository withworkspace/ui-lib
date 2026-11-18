import { describe, expect, test, vi } from "vitest";
import { type Theme, connect } from "../src/index.js";
import { TOKENS } from "../src/protocol.js";
import { fakeHost } from "../src/testing.js";
import { closing, settled, shell } from "./page.js";

type Held = { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };

// The page as ws's shell serves it, connected to a fake host.
async function page(options: Parameters<typeof fakeHost>[0] = {}) {
  const { window, document } = shell();
  const host = closing(fakeHost(options));
  const ws = closing(await connect({ host: host.window, document }));
  const html = document.documentElement;
  // A key pressed on something in the page: whether ws took it.
  const press = (on: Element, key: string, held: Held = {}) => {
    const e = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...held }) as unknown as KeyboardEvent;
    on.dispatchEvent(e);
    return e.defaultPrevented;
  };
  const click = (on: Element, held: Held & { button?: number } = {}) => {
    const e = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...held }) as unknown as MouseEvent;
    on.dispatchEvent(e);
    return e.defaultPrevented;
  };
  const add = (markup: string) => {
    ws.root.innerHTML = markup;
    return ws.root.firstElementChild as HTMLElement;
  };
  const keys = async () => {
    await settled(ws, host);
    return host.sent.flatMap((m) => (m.type === "ws:key" ? [m.key] : []));
  };
  // A press on something in the page: the pointer going down.
  const pressOn = (on: Element) => void on.dispatchEvent(new window.Event("pointerdown", { bubbles: true }) as unknown as Event);
  return { window, document, html, host, ws, press, click, add, keys, pressOn };
}

describe("the theme", () => {
  test("the welcome's is applied to <html>", async () => {
    const { html, ws } = await page({ scheme: "dark", vars: { "--ws-accent": "#a08ad0" } });

    expect(html.dataset.theme).toBe("dark");
    expect(html.style.colorScheme).toBe("dark");
    expect(html.style.getPropertyValue("--ws-accent")).toBe("#a08ad0");
    for (const token of TOKENS) expect(html.style.getPropertyValue(`--ws-${token}`), token).toBe(ws.theme.vars[`--ws-${token}`]);
  });

  test("ws:theme is applied to <html> before onTheme hears of it", async () => {
    const { html, host, ws } = await page({ scheme: "light" });
    const seen = new Promise<string>((resolve) => ws.onTheme(() => resolve(html.dataset.theme ?? "")));

    host.theme({ scheme: "dark", vars: { "--ws-accent": "#ff00aa", "--ws-later": "1px" } });

    expect(await seen).toBe("dark");
    expect(html.style.colorScheme).toBe("dark");
    expect(html.style.getPropertyValue("--ws-accent")).toBe("#ff00aa");
    expect(html.style.getPropertyValue("--ws-bg")).toBe(ws.theme.vars["--ws-bg"]);
    // A token from a ws after this release is set too: the names are ws's.
    expect(html.style.getPropertyValue("--ws-later")).toBe("1px");
  });

  test("with no document, nothing is wired and the theme is still given", async () => {
    const host = closing(fakeHost({ scheme: "dark" }));
    const ws = closing(await connect({ host: host.window }));
    const themed = new Promise<Theme>((resolve) => ws.onTheme(resolve));

    host.theme({ scheme: "light" });

    expect((await themed).scheme).toBe("light");
    expect(() => ws.root).toThrow(/no document/);
  });
});

describe("the page", () => {
  test("root is the shell's #root", async () => {
    const { document, ws } = await page();
    expect(ws.root).toBe(document.getElementById("root"));
  });

  test("root says so when the page has none", async () => {
    const { document, ws } = await page();
    document.getElementById("root")!.remove();
    expect(() => ws.root).toThrow(/no <div id="root">/);
  });

  test("setTitle sets the document's title too", async () => {
    const { document, host, ws } = await page();

    ws.setTitle("PROJ-2 Token cache");

    expect(document.title).toBe("PROJ-2 Token cache");
    expect((await host.next("ws:title")).title).toBe("PROJ-2 Token cache");
  });
});

describe("the keys ws owns", () => {
  test("a chord is passed on, with what was held", async () => {
    const { document, host, press } = await page();

    expect(press(document.body, "k", { metaKey: true })).toBe(true);
    expect(press(document.body, "p", { ctrlKey: true, shiftKey: true })).toBe(true);

    expect(await host.next("ws:key")).toEqual({ type: "ws:key", key: "k", meta: true, ctrl: false, shift: false, alt: false });
    expect(await host.next("ws:key")).toEqual({ type: "ws:key", key: "p", meta: false, ctrl: true, shift: true, alt: false });
  });

  test("a chord is passed on even while typing", async () => {
    const { add, press, keys } = await page();
    const input = add("<input>");

    expect(press(input, "k", { metaKey: true })).toBe(true);

    expect(await keys()).toEqual(["k"]);
  });

  test("a bare key is passed on", async () => {
    const { document, press, keys } = await page();

    expect(press(document.body, "?")).toBe(true);

    expect(await keys()).toEqual(["?"]);
  });

  test("a bare key is not passed on while typing", async () => {
    const { add, press, keys } = await page();

    expect(press(add("<input>"), "?")).toBe(false);
    expect(press(add("<textarea></textarea>"), "g")).toBe(false);
    expect(press(add("<select><option>a</option></select>"), "?")).toBe(false);
    expect(press(add('<div contenteditable="true">words</div>'), "?")).toBe(false);

    expect(await keys()).toEqual([]);
  });

  test("a bare key with a modifier held is the page's own", async () => {
    const { document, press, keys } = await page();

    expect(press(document.body, "?", { altKey: true })).toBe(false);
    expect(press(document.body, "g", { metaKey: true })).toBe(false);

    expect(await keys()).toEqual([]);
  });

  test("a key that isn't ws's is the page's own", async () => {
    const { document, press, keys } = await page();

    expect(press(document.body, "m")).toBe(false);
    expect(press(document.body, "s", { metaKey: true })).toBe(false);
    expect(press(document.body, "Enter")).toBe(false);

    expect(await keys()).toEqual([]);
  });

  test("a leader and the letter after it are both passed on", async () => {
    const { document, press, keys } = await page();

    expect(press(document.body, "g")).toBe(true);
    expect(press(document.body, "m")).toBe(true);
    expect(press(document.body, "m")).toBe(false); // the leader's letter was taken

    expect(await keys()).toEqual(["g", "m"]);
  });

  test("a letter that comes too long after its leader is the page's own", async () => {
    const { document, press, keys } = await page();
    const now = vi.spyOn(Date, "now");

    now.mockReturnValue(10_000);
    press(document.body, "g");
    now.mockReturnValue(10_899);
    expect(press(document.body, "m")).toBe(true);

    now.mockReturnValue(20_000);
    press(document.body, "g");
    now.mockReturnValue(20_900);
    expect(press(document.body, "m")).toBe(false);

    expect(await keys()).toEqual(["g", "m", "g"]);
  });

  test("the keys are the welcome's, not the package's", async () => {
    const { document, press, keys } = await page({ keys: { chords: ["j"], bare: ["/"], leaders: [], within: 0 } });

    expect(press(document.body, "j", { ctrlKey: true })).toBe(true);
    expect(press(document.body, "/")).toBe(true);
    expect(press(document.body, "k", { metaKey: true })).toBe(false);
    expect(press(document.body, "?")).toBe(false);
    expect(press(document.body, "g")).toBe(false);

    expect(await keys()).toEqual(["j", "/"]);
  });
});

describe("links", () => {
  // What the page has asked ws to go to.
  const gone = async (ws: Parameters<typeof settled>[0], host: Parameters<typeof settled>[1]) => {
    await settled(ws, host);
    return host.sent.flatMap((m) => (m.type === "ws:go" ? [m.path] : []));
  };

  test("a link to a page of ws's is ws's to follow", async () => {
    const { add, click, host, ws } = await page();
    const link = add('<a href="/missions/token-cache"><b>Token cache</b></a>');

    expect(click(link.firstElementChild!)).toBe(true);

    expect(await gone(ws, host)).toEqual(["/missions/token-cache"]);
  });

  test("a link to the plugin's own page is ws's too, and ws says where the app is", async () => {
    const { add, click, host, ws } = await page({ path: "/" });
    const moved = new Promise<string>((resolve) => ws.onNavigate(resolve));
    const link = add(`<a href="${ws.href("/browse/PROJ-2?tab=links")}">PROJ-2</a>`);

    expect(click(link)).toBe(true);

    expect(await moved).toBe("/browse/PROJ-2?tab=links");
    expect(await gone(ws, host)).toEqual(["/x/fake/browse/PROJ-2?tab=links"]);
  });

  test("a relative link is to the plugin's page it means", async () => {
    const { add, click, host, ws } = await page();
    const link = add('<a href="browse/PROJ-2">PROJ-2</a>');

    expect(click(link)).toBe(true);

    expect(await gone(ws, host)).toEqual(["/x/fake/browse/PROJ-2"]);
  });

  test("the frame's address follows ws, adding no history", async () => {
    const { window, add, click, host, ws } = await page({ path: "/" });
    const before = window.history.length;
    const moved = new Promise<string>((resolve) => ws.onNavigate(resolve));

    host.navigate("/browse/PROJ-1");
    await moved;
    expect(window.location.pathname).toBe("/plugin-frame/fake/browse/PROJ-1");
    expect(window.history.length).toBe(before);

    // So a relative link resolves against where the app is now.
    click(add('<a href="PROJ-2">PROJ-2</a>'));
    expect(await gone(ws, host)).toEqual(["/x/fake/browse/PROJ-2"]);
  });

  test("a click with a modifier held, or another button, is left to the browser", async () => {
    const { add, click, host, ws } = await page();
    const link = add('<a href="/missions/token-cache">Token cache</a>');

    expect(click(link, { metaKey: true })).toBe(false);
    expect(click(link, { ctrlKey: true })).toBe(false);
    expect(click(link, { shiftKey: true })).toBe(false);
    expect(click(link, { altKey: true })).toBe(false);
    expect(click(link, { button: 1 })).toBe(false);

    expect(await gone(ws, host)).toEqual([]);
  });

  test("a target, a download, or a link the app handled is left alone", async () => {
    const { add, click, host, ws } = await page();
    expect(click(add('<a href="/missions/x" target="_blank">x</a>'))).toBe(false);
    expect(click(add('<a href="/missions/x" download>x</a>'))).toBe(false);
    expect(click(add('<a href="mailto:someone@example.com">mail</a>'))).toBe(false);

    const handled = add('<a href="/missions/x">x</a>');
    handled.addEventListener("click", (e) => e.preventDefault());
    click(handled);

    expect(await gone(ws, host)).toEqual([]);
  });

  test("a link to elsewhere on the web, or to the plugin's own HTTP, opens in a tab of its own", async () => {
    const { window, add, click, host, ws } = await page();
    const opened = vi.spyOn(window, "open").mockReturnValue(null);

    expect(click(add('<a href="https://example.com/a">a</a>'))).toBe(true);
    expect(click(add('<a href="/plugins/fake/export.csv">export</a>'))).toBe(true);

    expect(opened.mock.calls.map((c) => c[0])).toEqual(["https://example.com/a", "http://ws.test/plugins/fake/export.csv"]);
    expect(await gone(ws, host)).toEqual([]);
  });

  test("a link to a place in the page scrolls there, adding no history", async () => {
    const { window, document, add, click, host, ws } = await page();
    add('<div><a href="#notes">Notes</a><h2 id="notes">Notes</h2></div>');
    const heading = document.getElementById("notes")!;
    const scrolled = vi.spyOn(heading, "scrollIntoView").mockImplementation(() => {});
    const before = window.history.length;

    expect(click(document.querySelector("a")!)).toBe(true);

    expect(scrolled).toHaveBeenCalled();
    expect(window.history.length).toBe(before);
    expect(await gone(ws, host)).toEqual([]);
  });
});

describe("a press elsewhere", () => {
  test("dismissOutside runs for a press in the page outside the element, and not for one in it", async () => {
    const { add, pressOn, ws } = await page();
    const app = add('<div><div id="menu"><button>Rename</button></div><p id="elsewhere">Elsewhere</p></div>');
    const menu = app.querySelector("#menu")!;
    let dismissed = 0;
    ws.dismissOutside(menu, () => dismissed++);

    pressOn(menu.querySelector("button")!);
    pressOn(menu);
    expect(dismissed).toBe(0);

    pressOn(app.querySelector("#elsewhere")!);
    expect(dismissed).toBe(1);
  });

  test("it hears the press before what's pressed can stop it", async () => {
    const { add, pressOn, ws } = await page();
    const app = add('<div><div id="menu"></div><p id="elsewhere">Elsewhere</p></div>');
    const elsewhere = app.querySelector("#elsewhere")!;
    elsewhere.addEventListener("pointerdown", (e) => e.stopPropagation());
    let dismissed = 0;
    ws.dismissOutside(app.querySelector("#menu")!, () => dismissed++);

    pressOn(elsewhere);

    expect(dismissed).toBe(1);
  });

  test("dismissOutside runs for a press in ws, outside the frame", async () => {
    const { add, host, ws } = await page();
    const menu = add('<div id="menu"></div>');
    const dismissed = new Promise<void>((resolve) => ws.dismissOutside(menu, resolve));

    host.outside();

    await dismissed;
  });

  test("given several elements, a press in any of them is in", async () => {
    const { add, pressOn, ws } = await page();
    const app = add('<div><button id="opens">Menu</button><div id="menu"></div><p id="elsewhere">Elsewhere</p></div>');
    let dismissed = 0;
    ws.dismissOutside([app.querySelector("#opens")!, app.querySelector("#menu")!], () => dismissed++);

    pressOn(app.querySelector("#opens")!);
    pressOn(app.querySelector("#menu")!);
    expect(dismissed).toBe(0);

    pressOn(app.querySelector("#elsewhere")!);
    expect(dismissed).toBe(1);
  });

  test("what it returns stops it, for the page's presses and for ws's, and leaves another given the same fn", async () => {
    const { add, pressOn, host, ws } = await page();
    const app = add('<div><div id="a"></div><div id="b"></div><p id="elsewhere">Elsewhere</p></div>');
    let dismissed = 0;
    const fn = () => void dismissed++;
    const stop = ws.dismissOutside(app.querySelector("#a")!, fn);
    ws.dismissOutside(app.querySelector("#b")!, fn);

    stop();
    pressOn(app.querySelector("#elsewhere")!);
    expect(dismissed).toBe(1);

    const heard = new Promise<void>((resolve) => ws.onOutside(resolve));
    host.outside();
    await heard;
    expect(dismissed).toBe(2);
  });
});

describe("close", () => {
  test("stops hearing presses elsewhere", async () => {
    const { add, pressOn, ws } = await page();
    const app = add('<div><div id="menu"></div><p id="elsewhere">Elsewhere</p></div>');
    let dismissed = 0;
    ws.dismissOutside(app.querySelector("#menu")!, () => dismissed++);

    ws.close();
    pressOn(app.querySelector("#elsewhere")!);

    expect(dismissed).toBe(0);
  });

  test("stops passing on keys and links", async () => {
    const { document, add, press, click, ws } = await page();
    const link = add('<a href="/missions/token-cache">Token cache</a>');

    ws.close();

    expect(press(document.body, "k", { metaKey: true })).toBe(false);
    expect(click(link)).toBe(false);
  });
});
