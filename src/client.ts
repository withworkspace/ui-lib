// The page's side of the frame: connect() does the handshake with ws and
// gives the app a Client over the port. What it wires into the page is
// small, and each part is something ws said in the welcome: the theme on
// <html>, the keys ws owns passed on, and links clicked handed to ws. ws
// keeps the history: the frame never adds to it.

import { PROTOCOL_VERSIONS, type Connect, type ProtocolVersion, V1, isRefuse } from "./protocol.js";
import { isRecord } from "./shape.js";
import { VERSION } from "./version.js";

/**
 * ProtocolError is the handshake failing because the page and ws don't
 * meet: no frame protocol version in common, or an answer that isn't one
 * this page can read. Its message says which side is behind.
 */
export class ProtocolError extends Error {
  /** The versions the page speaks. */
  readonly page: readonly number[];
  /** The versions ws said it speaks. */
  readonly host: readonly number[];

  constructor(message: string, page: readonly number[], host: readonly number[]) {
    super(message);
    this.name = "ProtocolError";
    this.page = page;
    this.host = host;
  }
}

/**
 * NoHostError is the handshake getting no answer: the page isn't in ws's
 * frame (opened alone, or in some other page), or it's in a ws from before
 * frame protocol 1, which drops a ws:connect as a message it doesn't know.
 */
export class NoHostError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NoHostError";
  }
}

/** HostWindow is as much of window.parent as the handshake uses. */
export interface HostWindow {
  postMessage(message: unknown, targetOrigin: string, transfer: Transferable[]): void;
}

export interface ConnectOptions {
  /**
   * What to send ws:connect to, in place of window.parent: a fake host's
   * window, in tests.
   */
  host?: HostWindow;
  /**
   * The document to wire: the theme goes on its <html>, and its keys and
   * link clicks are listened for. The page's own by default. Where
   * there's none (in Node), nothing is wired.
   */
  document?: Document;
  /** How long to wait for ws's answer, in milliseconds. 5000 by default. */
  timeout?: number;
}

export type Theme = V1.Theme;

/** Client is the app's handle on ws, once they've shaken hands. */
export interface Client {
  /** The frame protocol version the handshake chose. */
  readonly version: ProtocolVersion;
  /** The plugin's name. */
  readonly name: string;
  /**
   * The <div id="root"> of ws's shell, to render into. Reading it throws
   * where there's no document, or no #root in it.
   */
  readonly root: HTMLElement;
  /**
   * Where in the plugin ws's address is now, without a base, with its
   * query: /browse/PROJ-1?tab=links. It changes only with ws:navigate,
   * after a go() too: render from it, and from onNavigate.
   */
  readonly path: string;
  /** ws's theme now. It's applied to <html> already. */
  readonly theme: Theme;

  /**
   * api is a path in the plugin's own HTTP as a URL to fetch:
   * api("/issues") is /plugins/jira/issues.
   */
  api(path: string): string;
  /**
   * href is a path in the plugin as ws's address, for a link's href:
   * href("/browse/PROJ-2") is /x/jira/browse/PROJ-2. A click on it is
   * handed to ws, and ⌘-click opens the page in a tab of its own.
   */
  href(path: string): string;

  /**
   * onNavigate runs fn when ws's address moves within the plugin: a link
   * clicked in the app, a go(), the sidebar, back and forward. The app
   * shows that path. Each on… returns a function that stops it.
   */
  onNavigate(fn: (path: string) => void): () => void;
  /** onChanged runs fn when the plugin says what the app shows is stale. */
  onChanged(fn: () => void): () => void;
  /**
   * onTheme runs fn when the theme changes, after it's applied: for an app
   * that draws with the values itself, on a canvas say.
   */
  onTheme(fn: (theme: Theme) => void): () => void;

  /**
   * go asks ws to go to this path in the plugin: /browse/PROJ-2. ws adds
   * it to its history (or, with replace, puts it in place of where it is)
   * and onNavigate follows. The app moves when it's told, not before.
   */
  go(path: string, options?: { replace?: boolean }): void;
  /**
   * setTitle is the page's title, for the tab. An empty one means the
   * view's own.
   */
  setTitle(title: string): void;
  /**
   * open asks ws to go to an address of its own: /missions/token-cache.
   * What it does is ws's to decide.
   */
  open(path: string): void;
  /** close stops listening and closes the port: for tests and hot reload. */
  close(): void;
}

/**
 * connect shakes hands with ws and resolves with the Client. It rejects
 * with a ProtocolError when the page and ws have no version in common, and
 * with a NoHostError when nothing answers.
 */
export function connect(options: ConnectOptions = {}): Promise<Client> {
  const doc = options.document ?? (typeof document === "undefined" ? undefined : document);
  const view = doc?.defaultView ?? undefined;
  const timeout = options.timeout ?? 5000;

  let host = options.host;
  if (!host) {
    if (!view || view.parent === view) {
      return Promise.reject(new NoHostError("This page isn't in a frame, so there's no ws to connect to. Open it in ws, at /x/<plugin>/."));
    }
    host = view.parent;
  }
  // ws is the frame's own origin. An origin that can't be named ("null")
  // has no ws to reach: "/" is this origin too, and such a message is
  // never delivered.
  const origin = view?.location?.origin;
  const target = origin && origin !== "null" ? origin : "/";

  const versions: number[] = [...PROTOCOL_VERSIONS];
  const hello: Connect = { type: "ws:connect", versions, client: `@withworkspace/ui-lib@${VERSION}` };

  return new Promise<Client>((resolve, reject) => {
    const { port1: port, port2 } = new MessageChannel();
    const fail = (err: Error) => {
      clearTimeout(timer);
      port.onmessage = null;
      port.close();
      reject(err);
    };
    const refuse = (err: ProtocolError) => {
      console.error(err);
      fail(err);
    };
    const timer = setTimeout(() => {
      fail(new NoHostError(`ws didn't answer within ${timeout}ms. This page isn't in ws's frame, or it's in a ws from before frame protocol ${Math.min(...versions)}: update ws.`));
    }, timeout);

    port.onmessage = (e: MessageEvent) => {
      const m: unknown = e.data;
      if (isRefuse(m)) {
        refuse(new ProtocolError(m.message, versions, m.versions));
      } else if (V1.isWelcome(m)) {
        clearTimeout(timer);
        resolve(client(port, m, doc));
      } else if (isRecord(m) && m.type === "ws:welcome") {
        // A welcome this page can't read: in a version it didn't offer, or
        // not as that version has it.
        const said = typeof m.version === "number" ? [m.version] : [];
        refuse(new ProtocolError(`ws welcomed this page in frame protocol ${String(m.version)}, and not as this page reads it: it speaks ${versions.join(", ")}.`, versions, said));
      }
      // Anything else is a message this page doesn't know: dropped.
    };

    try {
      host.postMessage(hello, target, [port2]);
    } catch (err) {
      fail(new NoHostError("ws:connect couldn't be sent to the page's parent.", { cause: err }));
    }
  });
}

function client(port: MessagePort, welcome: V1.Welcome, doc: Document | undefined): Client {
  let path = welcome.path;
  let theme = welcome.theme;
  const navigated = new Set<(path: string) => void>();
  const changed = new Set<() => void>();
  const themed = new Set<(theme: Theme) => void>();

  const send = (m: V1.PageMessage) => port.postMessage(m);
  const on = <F>(fns: Set<F>, fn: F) => {
    fns.add(fn);
    return () => {
      fns.delete(fn);
    };
  };
  const { at, base } = welcome.plugin;
  const open = (to: string, replace?: boolean) => send(replace ? { type: "ws:go", path: to, replace } : { type: "ws:go", path: to });

  if (doc) applyTheme(doc, theme);
  const unwire = doc ? wire(doc, welcome, send, open) : () => {};

  port.onmessage = (e: MessageEvent) => {
    const m: unknown = e.data;
    if (!V1.isHostMessage(m)) return;
    switch (m.type) {
      case "ws:navigate":
        path = m.path;
        // The frame's address follows, in place: a relative link resolves
        // against it, and a reload starts there. It adds no history.
        try {
          doc?.defaultView?.history.replaceState(doc.defaultView.history.state, "", base + m.path);
        } catch {
          // A frame whose address can't be set (in a test, say) still moves.
        }
        for (const fn of [...navigated]) fn(m.path);
        break;
      case "ws:theme":
        theme = { scheme: m.scheme, vars: m.vars };
        if (doc) applyTheme(doc, theme);
        for (const fn of [...themed]) fn(theme);
        break;
      case "ws:changed":
        for (const fn of [...changed]) fn();
        break;
    }
  };

  return {
    version: welcome.version,
    name: welcome.plugin.name,
    get root() {
      const root = doc?.getElementById("root");
      if (!root) throw new Error(doc ? 'There\'s no <div id="root"> in the page: ws\'s shell has one.' : "There's no document, so there's no #root: give connect() one.");
      return root;
    },
    get path() {
      return path;
    },
    get theme() {
      return theme;
    },
    api: (p) => welcome.plugin.api + (p.startsWith("/") ? p : `/${p}`),
    href: (p) => at + (p.startsWith("/") ? p : `/${p}`),
    onNavigate: (fn) => on(navigated, fn),
    onChanged: (fn) => on(changed, fn),
    onTheme: (fn) => on(themed, fn),
    go(to, options = {}) {
      if (!to.startsWith("/")) throw new TypeError(`go("${to}"): a path in the plugin starts with "/".`);
      open(at + to, options.replace);
    },
    setTitle(title) {
      if (doc) doc.title = title;
      send({ type: "ws:title", title });
    },
    open: (to) => open(to),
    close() {
      unwire();
      port.onmessage = null;
      port.close();
    },
  };
}

// The theme goes on <html>: over the shell's <style>, so the app's CSS,
// which uses var(--ws-…), follows.
function applyTheme(doc: Document, theme: Theme) {
  const root = doc.documentElement;
  root.dataset.theme = theme.scheme;
  root.style.colorScheme = theme.scheme;
  for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value);
}

// wire listens in the page for what's ws's: the keys the welcome named,
// and clicks on links. It returns what undoes it.
function wire(doc: Document, welcome: V1.Welcome, send: (m: V1.PageMessage) => void, open: (address: string) => void): () => void {
  const { keys } = welcome;
  let leaderAt = 0;

  const onKey = (e: KeyboardEvent) => {
    const typing = isTypedIn(e.target);
    const chord = (e.metaKey || e.ctrlKey) && keys.chords.includes(e.key);
    const plain = !typing && !e.metaKey && !e.ctrlKey && !e.altKey;
    // A leader, then a letter: both are ws's.
    const after = plain && Date.now() - leaderAt < keys.within && /^[a-z]$/.test(e.key);
    const bare = plain && (keys.bare.includes(e.key) || after);
    if (bare) leaderAt = keys.leaders.includes(e.key) ? Date.now() : 0;
    if (!chord && !bare) return;
    e.preventDefault();
    send({ type: "ws:key", key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
  };

  // A link clicked is ws's to follow, so the frame never adds to history.
  // What the browser does better is left to it: a click with a key held or
  // another button (a tab of its own), a target, a download.
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = e.target as Partial<Element> | null;
    const a = target?.closest?.("a[href]") as HTMLAnchorElement | null | undefined;
    if (!a || typeof a.href !== "string" || a.hasAttribute("download")) return;
    const named = a.getAttribute("target");
    if (named && named !== "_self") return;
    const view = doc.defaultView;
    if (!view) return;
    let url: URL;
    let here: URL;
    try {
      url = new URL(a.href, view.location.href);
      here = new URL(view.location.href);
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return; // mailto:, say
    e.preventDefault();
    const api = welcome.plugin.api;
    if (url.origin !== here.origin || url.pathname === api || url.pathname.startsWith(`${api}/`)) {
      // Somewhere else on the web, or a file from the plugin's own HTTP:
      // in a tab of its own, never in the frame.
      view.open(url.href, "_blank", "noopener");
      return;
    }
    if (url.hash && url.pathname === here.pathname && url.search === here.search) {
      // A place in this page: scrolled to, with no history.
      doc.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView();
      return;
    }
    open(address(url, welcome.plugin));
  };

  doc.addEventListener("keydown", onKey);
  doc.addEventListener("click", onClick);
  return () => {
    doc.removeEventListener("keydown", onKey);
    doc.removeEventListener("click", onClick);
  };
}

// address is a link's URL as ws's address. A link resolved against the
// frame's own (a relative href) is to the plugin's page of that path.
function address(url: URL, plugin: V1.Plugin): string {
  const { pathname, search, hash } = url;
  const inFrame = pathname === plugin.base || pathname.startsWith(`${plugin.base}/`);
  const path = inFrame ? plugin.at + (pathname.slice(plugin.base.length) || "/") : pathname;
  return path + search + hash;
}

// Whether a key pressed here is being typed into something.
function isTypedIn(target: EventTarget | null): boolean {
  const el = target as Partial<HTMLElement> | null;
  return !!el && (el.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ""));
}
