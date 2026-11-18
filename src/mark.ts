// Refs drawn in a page's own words: an element's text is given to ws,
// which says which words are names, and each is put in a link where it
// stands (a.ws-ref, which ws's shell styles). Nothing else in the element
// changes. The finding is ws's alone: this only asks, and draws.
//
// It's for words the app owns outright (a description's HTML, set as
// innerHTML). Words a framework renders are the framework's to change: an
// app draws those itself, from findRefs.

import type { V1 } from "./protocol.js";

/** Finder is as much of the client as marking uses. */
export interface Finder {
  find(texts: string[]): Promise<V1.FoundRef[][]>;
  onChanged(fn: () => void): () => void;
}

// What's left as it is, with everything in it: a link's words are
// somewhere to go already, code in a block and a heading aren't read for
// names (as in ws), and the rest aren't words to mark at all.
const skipped = "a, pre, h1, h2, h3, h4, h5, h6, script, style, textarea, select, button, svg, [contenteditable]";

const isElement = (n: Node): n is Element => n.nodeType === 1;
const isText = (n: Node) => n.nodeType === 3;

// A run is words side by side in one element: text, and the marks already
// drawn in it, which are read as the words they were. whole is a run in
// inline code, which is a name only when all of it is one.
interface Run {
  nodes: ChildNode[];
  text: string;
  whole: boolean;
}

// The marks this drew, with what each was drawn from: any other link is
// the app's own, and left alone.
const drawn = new WeakMap<Element, string>();

// What an element's marks are kept by, so marking it again looks again
// and doesn't mark twice.
const marked = new WeakMap<Element, { again(): void; stop(): void }>();

function runsIn(root: Element): Run[] {
  const runs: Run[] = [];
  const walk = (parent: Element, whole: boolean) => {
    let run: Run | undefined;
    for (const node of Array.from(parent.childNodes)) {
      if (isText(node) || (isElement(node) && drawn.has(node))) {
        if (!run) runs.push((run = { nodes: [], text: "", whole }));
        run.nodes.push(node);
        run.text += node.textContent ?? "";
        continue;
      }
      run = undefined;
      if (isElement(node) && !node.matches(skipped)) walk(node, whole || node.localName === "code");
    }
  };
  walk(root, root.localName === "code");
  return runs.filter((r) => r.text.trim() !== "");
}

// What a mark is drawn from, but for where it is.
const drawnFrom = (f: V1.FoundRef) => JSON.stringify([f.ref, f.kind, f.href, f.shape ?? "", f.accent ?? ""]);

// The refs to draw in a run, of those ws found: each within the text, in
// order, none over another. In inline code, the one that's all of it, or
// none.
function toDraw(run: Run, found: readonly V1.FoundRef[]): V1.FoundRef[] {
  const out: V1.FoundRef[] = [];
  let at = 0;
  for (const f of found) {
    if (f.from < at || f.to <= f.from || f.to > run.text.length) continue;
    out.push(f);
    at = f.to;
  }
  if (!run.whole) return out;
  const start = run.text.length - run.text.trimStart().length;
  const end = run.text.trimEnd().length;
  return out.length === 1 && out[0]!.from === start && out[0]!.to === end ? out : [];
}

// Whether a run is drawn as these refs already.
function isDrawn(run: Run, refs: readonly V1.FoundRef[]): boolean {
  const have: string[] = [];
  let at = 0;
  for (const n of run.nodes) {
    const length = (n.textContent ?? "").length;
    if (isElement(n)) have.push(`${at}-${at + length} ${drawn.get(n)}`);
    at += length;
  }
  const want = refs.map((f) => `${f.from}-${f.to} ${drawnFrom(f)}`);
  return have.length === want.length && have.every((h, i) => h === want[i]);
}

function link(doc: Document, f: V1.FoundRef, text: string): Element {
  const a = doc.createElement("a");
  a.className = "ws-ref";
  a.setAttribute("href", f.href);
  a.dataset.wsRef = f.ref;
  a.dataset.wsKind = f.kind;
  if (f.shape) a.dataset.wsShape = f.shape;
  if (f.accent) a.style.setProperty("--ws-ref-accent", f.accent);
  a.textContent = text;
  drawn.set(a, drawnFrom(f));
  return a;
}

// draw puts a run's refs in links, in place of the run as it was. A run
// that's changed since it was read is left: whoever changed it marks it
// again.
function draw(run: Run, found: readonly V1.FoundRef[]) {
  const first = run.nodes[0];
  const parent = first?.parentNode;
  if (!first || !parent) return;
  const asRead = run.nodes.every((n, i) => n.parentNode === parent && (i === 0 || run.nodes[i - 1]!.nextSibling === n));
  if (!asRead || run.nodes.map((n) => n.textContent ?? "").join("") !== run.text) return;
  const refs = toDraw(run, found);
  if (isDrawn(run, refs)) return;
  const doc = parent.ownerDocument;
  if (!doc) return;
  const words = doc.createDocumentFragment();
  let at = 0;
  for (const f of refs) {
    if (f.from > at) words.append(doc.createTextNode(run.text.slice(at, f.from)));
    words.append(link(doc, f, run.text.slice(f.from, f.to)));
    at = f.to;
  }
  if (at < run.text.length) words.append(doc.createTextNode(run.text.slice(at)));
  parent.insertBefore(words, first);
  for (const n of run.nodes) n.remove();
}

/**
 * mark draws ws's names in an element's words, and keeps them right as
 * what there is to name changes. Marking the element again looks again:
 * for after the app has put other words in it. It returns what stops it,
 * and makes the names words again.
 */
export function mark(el: Element, finder: Finder): () => void {
  const was = marked.get(el);
  if (was) {
    was.again();
    return was.stop;
  }
  let stopped = false;
  let turn = 0;
  const again = () => {
    if (stopped) return;
    const runs = runsIn(el);
    const mine = ++turn;
    if (!runs.length) return;
    void finder.find(runs.map((r) => r.text)).then((found) => {
      // A later look has these words too, and its answer is the one drawn.
      if (stopped || mine !== turn) return;
      runs.forEach((run, i) => draw(run, found[i] ?? []));
    });
  };
  const unwatch = finder.onChanged(again);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    unwatch();
    marked.delete(el);
    for (const run of runsIn(el)) draw(run, []);
  };
  marked.set(el, { again, stop });
  again();
  return stop;
}
