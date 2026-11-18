import { describe, expect, test } from "vitest";
import { connect } from "../src/index.js";
import { type FindRefs, fakeHost, named } from "../src/testing.js";
import { closing, settled, shell } from "./page.js";

// markRefs, in a page as ws's shell serves it: ws (the fake host) says
// which words are names, and the client draws them where they stand.

const issues = named({
  "PROJ-12": "/x/fake/browse/PROJ-12",
  "PROJ-7": { href: "https://jira.example/browse/PROJ-7", ref: "seven" },
  demo: { href: "/files/demo", kind: "repo", shape: "pill", accent: "#6e509c" },
});

async function page(refs: FindRefs | false = issues) {
  const { window, document } = shell();
  const host = closing(fakeHost({ refs }));
  const ws = closing(await connect({ host: host.window, document }));
  const add = (markup: string) => {
    ws.root.innerHTML = markup;
    return ws.root.firstElementChild as HTMLElement;
  };
  // Whatever was asked of ws before this has been answered, and drawn: an
  // asking of its own, a turn later, is answered after them.
  const drawn = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await ws.findRefs(["settle"]);
  };
  // ws said what there is to name changed, and the marks have followed.
  const renamed = async (find: FindRefs) => {
    const heard = new Promise<void>((resolve) => {
      const stop = ws.onRefsChanged(() => (stop(), resolve()));
    });
    host.refsChanged(find);
    await heard;
    await drawn();
  };
  const marks = (el: Element) => [...el.querySelectorAll("a.ws-ref")] as HTMLAnchorElement[];
  const click = (on: Element) => {
    const e = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }) as unknown as MouseEvent;
    on.dispatchEvent(e);
    return e.defaultPrevented;
  };
  return { host, ws, add, drawn, renamed, marks, click };
}

describe("markRefs", () => {
  test("puts each name in a link where it stands, and leaves the words around it", async () => {
    const { ws, add, drawn, marks } = await page();
    const el = add("<p>See PROJ-12 and <b>PROJ-7</b>, in demo.</p>");

    ws.markRefs(el);
    await drawn();

    expect(el.textContent).toBe("See PROJ-12 and PROJ-7, in demo.");
    expect(el.innerHTML).toBe(
      'See <a class="ws-ref" href="/x/fake/browse/PROJ-12" data-ws-ref="PROJ-12" data-ws-kind="thing">PROJ-12</a> and ' +
        '<b><a class="ws-ref" href="https://jira.example/browse/PROJ-7" data-ws-ref="seven" data-ws-kind="thing">PROJ-7</a></b>, in ' +
        '<a class="ws-ref" href="/files/demo" data-ws-ref="demo" data-ws-kind="repo" data-ws-shape="pill" style="--ws-ref-accent: #6e509c;">demo</a>.',
    );
    expect(marks(el).map((a) => a.textContent)).toEqual(["PROJ-12", "PROJ-7", "demo"]);
  });

  test("asks ws once for all of an element's words", async () => {
    const { host, ws, add, drawn } = await page();
    const el = add("<div><p>See PROJ-12.</p><ul><li>PROJ-7 first</li><li>   </li><li>then demo</li></ul></div>");

    ws.markRefs(el);
    await drawn();

    expect(host.sent.filter((m) => m.type === "ws:refs")[0]).toEqual({ type: "ws:refs", id: 1, texts: ["See PROJ-12.", "PROJ-7 first", "then demo"] });
  });

  test("leaves a link's words, a heading's and a block of code's as they are", async () => {
    const { ws, add, drawn, marks } = await page();
    const el = add('<div><h2>PROJ-12 in short</h2><p><a href="/elsewhere">PROJ-12</a> and PROJ-7</p><pre><code>PROJ-12</code></pre><button>PROJ-12</button></div>');

    ws.markRefs(el);
    await drawn();

    expect(marks(el).map((a) => a.textContent)).toEqual(["PROJ-7"]);
  });

  test("inline code is a name only when all of it is one", async () => {
    const { ws, add, drawn, marks } = await page();
    const el = add("<p><code>PROJ-12</code>, <code> PROJ-7 </code> and <code>git log PROJ-12</code></p>");

    ws.markRefs(el);
    await drawn();

    expect(marks(el).map((a) => a.parentElement?.outerHTML)).toEqual([
      '<code><a class="ws-ref" href="/x/fake/browse/PROJ-12" data-ws-ref="PROJ-12" data-ws-kind="thing">PROJ-12</a></code>',
      '<code> <a class="ws-ref" href="https://jira.example/browse/PROJ-7" data-ws-ref="seven" data-ws-kind="thing">PROJ-7</a> </code>',
    ]);
  });

  test("a click on a name is ws's to follow, like any link", async () => {
    const { host, ws, add, drawn, marks, click } = await page();
    const el = add("<p>See PROJ-12.</p>");
    ws.markRefs(el);
    await drawn();

    expect(click(marks(el)[0]!)).toBe(true);

    expect(await host.next("ws:go")).toEqual({ type: "ws:go", path: "/x/fake/browse/PROJ-12" });
  });

  test("follows what there is to name: a new name is marked, one that's gone is words again, and the rest are left as they were", async () => {
    const { ws, add, drawn, renamed, marks } = await page();
    const el = add("<p>See PROJ-12 and PROJ-7, then PROJ-30.</p>");
    ws.markRefs(el);
    await drawn();
    const [twelve] = marks(el);

    await renamed(named({ "PROJ-12": "/x/fake/browse/PROJ-12", "PROJ-30": "/x/fake/browse/PROJ-30" }));

    expect(marks(el).map((a) => a.textContent)).toEqual(["PROJ-12", "PROJ-30"]);
    expect(el.textContent).toBe("See PROJ-12 and PROJ-7, then PROJ-30.");
    expect(marks(el)[0]).not.toBe(twelve); // its run was drawn again, with PROJ-30 in it

    const [, thirty] = marks(el);
    await renamed(named({ "PROJ-12": "/x/fake/browse/PROJ-12", "PROJ-30": "/x/fake/browse/PROJ-30", other: "/other" }));

    expect(marks(el)[1]).toBe(thirty); // nothing in it changed: it wasn't touched
  });

  test("a name that goes somewhere else now is drawn again", async () => {
    const { ws, add, drawn, renamed, marks } = await page();
    const el = add("<p>See PROJ-12.</p>");
    ws.markRefs(el);
    await drawn();

    await renamed(named({ "PROJ-12": "/x/fake/issue/PROJ-12" }));

    expect(marks(el).map((a) => a.getAttribute("href"))).toEqual(["/x/fake/issue/PROJ-12"]);
  });

  test("marking an element again reads the words it has now, and marks nothing twice", async () => {
    const { host, ws, add, drawn, marks } = await page();
    const el = add("<div><p>See PROJ-12.</p></div>");
    const stop = ws.markRefs(el);
    await drawn();

    el.innerHTML = "<p>Now PROJ-7, and PROJ-12 still.</p>";
    ws.markRefs(el);
    await drawn();

    expect(marks(el).map((a) => a.textContent)).toEqual(["PROJ-7", "PROJ-12"]);

    stop();
    expect(marks(el)).toEqual([]);
    // One marking is kept for the element, so one stop ends it.
    host.refsChanged();
    await settled(ws, host);
    expect(host.sent.filter((m) => m.type === "ws:refs").map((m) => m.texts)).toEqual([["See PROJ-12."], ["settle"], ["Now PROJ-7, and PROJ-12 still."], ["settle"]]);
  });

  test("what it returns stops it, and makes the names words again", async () => {
    const { ws, add, drawn, renamed, marks } = await page();
    const el = add("<p>See PROJ-12 and <b>PROJ-7</b>.</p>");
    const stop = ws.markRefs(el);
    await drawn();

    stop();

    expect(el.innerHTML).toBe("See PROJ-12 and <b>PROJ-7</b>.");
    expect(el.childNodes).toHaveLength(3);
    await renamed(issues);
    expect(marks(el)).toEqual([]);
  });

  test("closing the client stops every marking", async () => {
    const { ws, add, drawn, marks } = await page();
    const el = add("<p>See PROJ-12.</p>");
    ws.markRefs(el);
    await drawn();

    ws.close();

    expect(marks(el)).toEqual([]);
    expect(el.innerHTML).toBe("See PROJ-12.");
  });

  test("words that changed while ws was asked are left for whoever changed them", async () => {
    const { ws, add, drawn, marks } = await page();
    const el = add("<p>See PROJ-12.</p>");

    ws.markRefs(el);
    el.firstChild!.textContent = "See nothing at all.";
    await drawn();

    expect(marks(el)).toEqual([]);
    expect(el.innerHTML).toBe("See nothing at all.");
  });

  test("a link the app drew itself, as a ref is drawn, is the app's", async () => {
    const { ws, add, drawn, marks } = await page();
    const el = add('<p>See <a class="ws-ref" data-ws-ref="mine" href="/mine">PROJ-12</a> and PROJ-7.</p>');
    const own = marks(el)[0];

    const stop = ws.markRefs(el);
    await drawn();
    expect(marks(el).map((a) => a.dataset.wsRef)).toEqual(["mine", "seven"]);

    stop();
    expect(marks(el)).toEqual([own]);
  });

  test("in a ws from before it could be asked, the words stay as they are", async () => {
    const { host, ws, add, drawn, marks } = await page(false);
    const el = add("<p>See PROJ-12.</p>");

    ws.markRefs(el);
    await drawn();
    await settled(ws, host);

    expect(marks(el)).toEqual([]);
    expect(host.sent.filter((m) => m.type === "ws:refs")).toEqual([]);
  });
});
