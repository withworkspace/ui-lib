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
  return { window, document, html, host, ws, press, click, add, keys };
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

describe("data-ws links", () => {
  test("a click opens the page in ws, not in the frame", async () => {
    const { add, click, host } = await page();
    const link = add('<a data-ws="/missions/token-cache" href="/missions/token-cache"><b>Token cache</b></a>');

    expect(click(link.firstElementChild!)).toBe(true);

    expect(await host.next("ws:open")).toEqual({ type: "ws:open", path: "/missions/token-cache" });
  });

  test("a click with a modifier held, or another button, is left to the browser", async () => {
    const { add, click, host, ws } = await page();
    const link = add('<a data-ws="/missions/token-cache" href="/missions/token-cache">Token cache</a>');

    expect(click(link, { metaKey: true })).toBe(false);
    expect(click(link, { ctrlKey: true })).toBe(false);
    expect(click(link, { shiftKey: true })).toBe(false);
    expect(click(link, { button: 1 })).toBe(false);

    await settled(ws, host);
    expect(host.sent.filter((m) => m.type === "ws:open")).toEqual([]);
  });

  test("any other link is the page's own", async () => {
    const { add, click, host, ws } = await page();
    const link = add('<a href="#here">Here</a>');

    expect(click(link)).toBe(false);

    await settled(ws, host);
    expect(host.sent.filter((m) => m.type === "ws:open")).toEqual([]);
  });
});

describe("close", () => {
  test("stops passing on keys and links", async () => {
    const { document, add, press, click, ws } = await page();
    const link = add('<a data-ws="/missions/token-cache" href="#">Token cache</a>');

    ws.close();

    expect(press(document.body, "k", { metaKey: true })).toBe(false);
    expect(click(link)).toBe(false);
  });
});
