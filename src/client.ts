// The page's side of the frame: connect() does the handshake with ws and
// gives the app a Client over the port. What it wires into the page is
// small, and each part is something ws said in the welcome: the theme on
// <html>, the keys ws owns passed on, and data-ws links opened in ws.

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
   * data-ws links are listened for. The page's own by default. Where
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
   * The path the frame's own address is under: /plugin-frame/jira. The
   * basename for a router that uses the frame's history.
   */
  readonly base: string;
  /**
   * The <div id="root"> of ws's shell, to render into. Reading it throws
   * where there's no document, or no #root in it.
   */
  readonly root: HTMLElement;
  /**
   * Where in the plugin ws's address is now, without a base, with its
   * query: /browse/PROJ-1?tab=links. It follows ws:navigate and setPath.
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
   * onNavigate runs fn when ws's address moves within the plugin without
   * the app having said so (the sidebar, a link in ws, back and forward).
   * The app goes there, replacing its own history entry. Each on… returns
   * a function that stops it.
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
   * setPath says the app moved to this path in the plugin: ws's address
   * follows. Saying where ws's address already is sends nothing.
   */
  setPath(path: string): void;
  /**
   * setTitle is the page's title, for the tab. An empty one means the
   * view's own.
   */
  setTitle(title: string): void;
  /** open goes to a page of ws's own: /missions/token-cache. */
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
  const open = (to: string) => send({ type: "ws:open", path: to });

  if (doc) applyTheme(doc, theme);
  const unwire = doc ? wire(doc, welcome.keys, send, open) : () => {};

  port.onmessage = (e: MessageEvent) => {
    const m: unknown = e.data;
    if (!V1.isHostMessage(m)) return;
    switch (m.type) {
      case "ws:navigate":
        path = m.path;
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
    base: welcome.plugin.base,
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
    onNavigate: (fn) => on(navigated, fn),
    onChanged: (fn) => on(changed, fn),
    onTheme: (fn) => on(themed, fn),
    setPath(to) {
      if (!to.startsWith("/")) throw new TypeError(`setPath("${to}"): a path in the plugin starts with "/".`);
      if (to === path) return;
      path = to;
      send({ type: "ws:path", path: to });
    },
    setTitle(title) {
      if (doc) doc.title = title;
      send({ type: "ws:title", title });
    },
    open,
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
// and clicks on links to ws's own pages. It returns what undoes it.
function wire(doc: Document, keys: V1.Keys, send: (m: V1.PageMessage) => void, open: (path: string) => void): () => void {
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

  // <a data-ws="/missions/x"> goes there in ws, not in the frame.
  const onClick = (e: MouseEvent) => {
    const target = e.target as Partial<Element> | null;
    const a = target?.closest?.("a[data-ws]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    open(a.getAttribute("data-ws") ?? "");
  };

  doc.addEventListener("keydown", onKey);
  doc.addEventListener("click", onClick);
  return () => {
    doc.removeEventListener("keydown", onKey);
    doc.removeEventListener("click", onClick);
  };
}

// Whether a key pressed here is being typed into something.
function isTypedIn(target: EventTarget | null): boolean {
  const el = target as Partial<HTMLElement> | null;
  return !!el && (el.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ""));
}
