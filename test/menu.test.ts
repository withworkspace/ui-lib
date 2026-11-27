import { describe, expect, test } from "vitest";
import { connect, type MenuEntry } from "../src/index.js";
import { fakeHost } from "../src/testing.js";
import * as V1 from "../src/v1.js";
import { closing, settled, shell } from "./page.js";

// The page as ws's shell serves it, connected to a fake host, and a right
// click on something in it: whether ws took it from the browser.
async function page(options: Parameters<typeof fakeHost>[0] = {}) {
  const { window, document } = shell();
  const host = closing(fakeHost(options));
  const ws = closing(await connect({ host: host.window, document }));
  const add = (markup: string) => {
    ws.root.innerHTML = markup;
    return ws.root.firstElementChild as HTMLElement;
  };
  const rightClick = (on: Element, at = { clientX: 40, clientY: 70 }) => {
    const e = new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, ...at }) as unknown as MouseEvent;
    on.dispatchEvent(e);
    return e.defaultPrevented;
  };
  return { window, document, host, ws, add, rightClick };
}

describe("ws's menu, for a right click", () => {
  test("on a ref: ws's menu for it, where it was clicked, in place of the browser's", async () => {
    const { host, ws, add, rightClick } = await page();
    const link = add('<p>See <a class="ws-ref" data-ws-ref="THING-2" href="/x/fake/things/2"><b>the lantern</b></a>.</p>').querySelector("b")!;

    expect(rightClick(link)).toBe(true);
    await settled(ws, host);
    expect(host.menu).toEqual({ id: 1, x: 40, y: 70, ref: "THING-2" });
  });

  test("elsewhere, with nothing to add: the browser's own", async () => {
    const { host, ws, add, rightClick } = await page();
    const p = add("<p>Plain words</p>");

    expect(rightClick(p)).toBe(false);
    await settled(ws, host);
    expect(host.menu).toBeUndefined();
  });

  test("the page's entries come first, and the one chosen is run", async () => {
    const { host, ws, add, rightClick } = await page();
    const card = add('<div class="card" data-ws-ref="THING-3"><span>Compass</span></div>');
    const ran: string[] = [];
    const entries = (label: string): MenuEntry => ({ label, icon: "pencil", run: () => ran.push(label) });
    const stop = ws.ui.onMenu((target, ref) => (target.closest(".card") ? [entries(`Rename ${ref}`), { label: "Throw away", danger: true, run: () => ran.push("thrown") }] : undefined));

    expect(rightClick(card.querySelector("span")!)).toBe(true);
    await settled(ws, host);
    expect(host.menu?.ref).toBe("THING-3");
    expect(host.menu?.items).toEqual([
      { id: "0", label: "Rename THING-3", icon: "pencil" },
      { id: "1", label: "Throw away", danger: true },
    ]);
    host.closeMenu("1");
    await settled(ws, host);
    expect(ran).toEqual(["thrown"]);

    // Taken away, it adds nothing: a ref alone still opens ws's.
    stop();
    rightClick(card);
    await settled(ws, host);
    expect(host.menu?.items).toBeUndefined();
  });

  test("entries alone open it, with no ref", async () => {
    const { host, ws, add, rightClick } = await page();
    const canvas = add('<div class="canvas"></div>');
    ws.ui.onMenu((target) => (target.matches(".canvas") ? [{ label: "Add a note", run() {} }] : undefined));

    expect(rightClick(canvas)).toBe(true);
    await settled(ws, host);
    expect(host.menu).toEqual({ id: 1, x: 40, y: 70, items: [{ id: "0", label: "Add a note" }] });
  });

  test("the app's own handler has it first; words selected and text boxes are the browser's", async () => {
    const { document, host, ws, add, rightClick } = await page();
    const box = add('<div><input data-ws-ref="THING-1"><span class="ref" data-ws-ref="THING-2">Lantern</span><i class="own" data-ws-ref="THING-3">x</i></div>');
    box.querySelector(".own")!.addEventListener("contextmenu", (e) => e.preventDefault());

    expect(rightClick(box.querySelector("input")!)).toBe(false);
    rightClick(box.querySelector(".own")!);
    const words = box.querySelector(".ref")!;
    document.getSelection()!.selectAllChildren(words);
    expect(rightClick(words)).toBe(false);
    await settled(ws, host);
    expect(host.sent.filter((m) => m.type === "ws:menu")).toEqual([]);
  });

  test("menu() from code: at a point, settled as it's put away, without an entry chosen", async () => {
    const { host, ws } = await page();
    const ran: string[] = [];
    const opened = ws.ui.menu({ x: 5, y: 9 }, { ref: "demo#12", entries: [{ label: "Pin here", run: () => ran.push("pin") }] });
    await settled(ws, host);
    expect(host.menu).toEqual({ id: 1, x: 5, y: 9, ref: "demo#12", items: [{ id: "0", label: "Pin here" }] });
    host.closeMenu();

    expect(await opened).toBe(true);
    expect(ran).toEqual([]);
  });

  test("a new one puts away the one that's open", async () => {
    const { host, ws } = await page();
    const first = ws.ui.menu({ x: 1, y: 1 }, { ref: "THING-1" });
    await settled(ws, host);
    ws.ui.menu({ x: 2, y: 2 }, { ref: "THING-2" });
    await settled(ws, host);

    expect(await first).toBe(true);
    expect(host.menu?.ref).toBe("THING-2");
  });

  test("from a ws that opens no menus: none, and the browser's is left be", async () => {
    const { host, ws, add, rightClick } = await page({ menus: false });
    const link = add('<a class="ws-ref" data-ws-ref="THING-2" href="/x/fake/things/2">the lantern</a>');

    expect(await ws.ui.menu({ x: 1, y: 1 }, { ref: "THING-2" })).toBe(false);
    expect(rightClick(link)).toBe(false);
    await settled(ws, host);
    expect(host.sent.filter((m) => m.type === "ws:menu")).toEqual([]);
  });

  test("an entry with no words, or nothing to do, is refused", async () => {
    const { ws } = await page();
    expect(() => ws.ui.menu({ x: 1, y: 1 }, { entries: [{ label: "", run() {} }] })).toThrow(TypeError);
  });

  test("closed, what's open settles, and ws is asked nothing more", async () => {
    const { host, ws } = await page();
    const open = ws.ui.menu({ x: 1, y: 1 }, { ref: "THING-1" });
    await settled(ws, host);
    ws.close();

    expect(await open).toBe(true);
    expect(await ws.ui.menu({ x: 1, y: 1 }, { ref: "THING-1" })).toBe(false);
  });
});

describe("the protocol's menu messages", () => {
  test("are checked by shape", () => {
    expect(V1.isPageMessage({ type: "ws:menu", id: 1, x: 3, y: 4 })).toBe(true);
    expect(V1.isPageMessage({ type: "ws:menu", id: 1, x: 3, y: 4, ref: "THING-2", items: [{ id: "a", label: "Rename", icon: "pencil", danger: false }] })).toBe(true);
    expect(V1.isPageMessage({ type: "ws:menu", id: 1, x: "3", y: 4 })).toBe(false);
    expect(V1.isPageMessage({ type: "ws:menu", id: 1, x: 3, y: 4, items: [{ id: "", label: "x" }] })).toBe(false);
    expect(V1.isPageMessage({ type: "ws:menu", id: 1, x: 3, y: 4, items: [{ id: "a", label: "x", danger: "yes" }] })).toBe(false);
    expect(V1.isHostMessage({ type: "ws:menu-closed", id: 1 })).toBe(true);
    expect(V1.isHostMessage({ type: "ws:menu-closed", id: 1, item: "0" })).toBe(true);
    expect(V1.isHostMessage({ type: "ws:menu-closed", id: 1, item: 0 })).toBe(false);
  });
});
