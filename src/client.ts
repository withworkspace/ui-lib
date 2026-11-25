// The page's side of the frame: connect() does the handshake with ws and
// gives the app a Client over the port. What it wires into the page is
// small, and each part is something ws said in the welcome: the theme on
// <html>, the keys ws owns passed on, and links clicked handed to ws. ws
// keeps the history: the frame never adds to it. Which words are ws's
// names is ws's to say too: the app asks, and draws what it's told. A
// press in ws, outside the frame, is one the page never sees: ws says it,
// and what closes on a press elsewhere closes on it too. What the page
// shows beyond its address (a thing in a panel) the app says, for ws's
// Find to start from. And a page says how it wants ws's chrome laid out
// round it: a canvas has ws fold its sidebar. And ws holds conversations
// about the page in its own chrome: the page says how they may be had,
// what the person's holding and what the agent should know, and asks for
// one to open. And ws has UIs of its own that a page can ask for (ui):
// ws defines each, and draws it over the frame, by where on the page it
// was asked from. A ref's card is the first, asked for as the pointer
// comes to a ref.

import { mark } from "./mark.js";
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

/**
 * UiError is ws not showing a UI a page asked for: this ws has no UI of
 * that name (it's from before the UI was), or it wasn't given what the
 * UI takes. Its message says which.
 */
export class UiError extends Error {
  /** The UI that was asked for. */
  readonly ui: string;

  constructor(message: string, ui: string) {
    super(message);
    this.name = "UiError";
    this.ui = ui;
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
/** One of the plugin's own things, as a UI of ws's about it is given it. */
export type ThingAsked = V1.ThingAsked;
/** What putting a thing in a repo, or saving it there, did. */
export type ThingSaved = V1.ThingSaved;
/** One of ws's names in a run of text, as ws found it. */
export type FoundRef = V1.FoundRef;

/** A form a conversation about the page can take: "card", "docked", "popover". */
export type ConversationForm = V1.ConversationForm;
/** What the person has in hand on the page: a selection. */
export type Holding = V1.Holding;

/**
 * ConversationSettings is what a page says of conversations about it.
 * Each set() says some of it: a field given takes the place of what it
 * was, and one given as undefined takes it away.
 */
export interface ConversationSettings {
  /** Show ws's ask bar at the foot of the page. */
  ask?: boolean;
  /** The forms it may take here. All three, until the page says. */
  allow?: readonly ConversationForm[];
  /** What the bar says before anything's typed. */
  placeholder?: string;
  /** What the person has in hand: shown as a chip, given to the agent with what's asked next. */
  holding?: Holding;
  /**
   * The page's state as words, for the agent and not the person. ws gives
   * it with a message only when it's changed since the agent was last
   * given it: say it as it is, as often as it changes.
   */
  context?: string;
  /** Things to ask, offered as the conversation starts. */
  suggestions?: readonly string[];
}

/** Where the conversation about the page is now. */
export interface ConversationStatus {
  open: boolean;
  /** The form it's shown in, while it's open. */
  as?: ConversationForm;
  /** Its agent is working on an answer. */
  working: boolean;
}

/** Conversations is the page's say in ws's conversations about it. */
export interface Conversations {
  /**
   * ws holds conversations about pages. In a ws from before it did,
   * everything here does nothing, and a page shows no way to ask.
   */
  readonly available: boolean;
  /** Where it is now. */
  readonly status: ConversationStatus;
  /**
   * set says how conversations about the page may be had: whether ws's
   * ask bar is shown, the forms it may take, what's held, the context.
   * Say it again as any of it changes: ws is told only what changed it,
   * and forgets it all when the page goes.
   */
  set(settings: ConversationSettings): void;
  /**
   * open opens the conversation: in the form asked for (as), or else the
   * one the person last chose for the plugin. A message is said as the
   * person's, and its context given to the agent with it, folded under
   * it where the person can look.
   */
  open(options?: { message?: string; context?: string; as?: ConversationForm }): void;
  /** close closes it. */
  close(): void;
  /** onChange runs fn when it opens, closes, moves, or starts or stops working. */
  onChange(fn: (status: ConversationStatus) => void): () => void;
}

/** Where something is on the page: its box, as getBoundingClientRect() gives it. */
export type Box = V1.Box;

/**
 * One of ws's UIs, once it's been asked for. It's a promise of what came
 * of it, so it's awaited: it resolves once the UI's closed, with what
 * the UI's result is, or with undefined when it was dismissed or the
 * page closed it. It rejects with a UiError when ws couldn't show it.
 */
export type UiOpened<Result> = Promise<Result | undefined> & {
  /** close takes it back: ws takes it down, and it resolves with undefined. */
  close(): void;
};

/**
 * Ui is ws's own UI, asked for by the page and drawn by ws over the
 * frame: what's ws's to know or to do (a ref's card), and what a frame
 * can't draw past its own edge. ws defines each one. The page says which,
 * what it's about, and where on the page it's asked from, and ws places
 * it there as if the frame had no edge.
 */
export interface Ui {
  /**
   * has is whether this ws has the UI of that name: one from before the
   * UI was hasn't. For a page that offers something only where ws can
   * do it (a button that saves).
   */
  has(name: string): boolean;
  /**
   * open asks for one of ws's UIs by its name, with what it's given, from
   * somewhere on the page: an element, whose box is read now, or a box.
   * What it returns is awaited for what came of it, and can be closed.
   * Asked of a ws that hasn't that UI, it rejects at once. Each UI has a
   * method of its own here that says what it's for: this is what they're
   * made of.
   */
  open<N extends V1.UiName>(name: N, options: { target?: Element | Box; with: V1.Uis[N]["with"] }): UiOpened<V1.Uis[N]["result"]>;
  /**
   * refCard shows a ref's card by something on the page: more about what
   * the ref names, as ws shows it for a ref in its own pages. ref is ws's
   * word for it, as findRefs gave it. Call it as the pointer comes, and
   * what it returns as the pointer goes: the card's wait is ws's. A ref
   * drawn as one (markRefs, or a.ws-ref with data-ws-ref) has its card
   * already: this is for what isn't a link, such as words on a canvas.
   */
  refCard(target: Element | Box, ref: string): () => void;
  /**
   * promoteThing asks ws to put one of the plugin's own things in a repo,
   * from a button on the page: ws shows where it's to live, by the
   * button, and does it when the person says. Awaited, it's where the
   * thing is now, or nothing where they thought better of it. The plugin
   * is told too, by ws, as it gives the thing.
   */
  promoteThing(target: Element | Box, thing: ThingAsked): UiOpened<ThingSaved>;
  /**
   * saveThing asks ws to save one of the plugin's own things to the repo
   * it lives in, as the person has it now, from the button they pressed:
   * ws saves it, and says by the button how it went. Awaited, it's the
   * thing as it is there now, or nothing where it wasn't saved.
   */
  saveThing(target: Element | Box, thing: ThingAsked): UiOpened<ThingSaved>;
  /**
   * viewPicture shows a picture over the whole of ws's window, in ws's
   * own viewer, to look around in. src is its address, as an <img>'s:
   * relative to the page, or on the web (https:), or the picture itself
   * (data:image/…). One that's on ws's is the plugin's own (its HTTP, its
   * pages' files): anything else there, and a blob:, is a TypeError.
   * target is what was clicked, if anything was. Awaited, it settles as
   * the person closes it. An <img> with data-ws-view opens in it on a
   * click, with nothing called.
   */
  viewPicture(src: string, options?: { title?: string; target?: Element | Box }): UiOpened<undefined>;
}

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
   * findRefs asks ws which of its names are in some runs of text: a file,
   * a pull request, a mission, a plugin's thing (PROJ-12). It resolves
   * with the refs in each text, in the texts' order: where each is, where
   * it goes and how it's drawn. ws finds only what's there to name, so
   * the answer can change (onRefsChanged). Askings made together go to ws
   * as one. In a ws from before it could be asked, nothing is found.
   */
  findRefs(texts: readonly string[]): Promise<FoundRef[][]>;
  /**
   * onRefsChanged runs fn when what there is to name changed: what
   * findRefs found may be different now, and an app that drew from it
   * asks again.
   */
  onRefsChanged(fn: () => void): () => void;
  /**
   * markRefs draws ws's names in an element's words: each is put in a
   * link (a.ws-ref, which ws's shell styles) where it stands, and a click
   * goes there. Words in a link, a heading or a block of code are left,
   * and inline code is a name only when all of it is one. The marks are
   * kept right as what there is to name changes. It's for words the app
   * owns outright (a description's HTML, set as innerHTML), not for what a
   * framework renders and will render again: draw those from findRefs.
   * After putting other words in the element, mark it again. It returns
   * a function that stops it and makes the names words again.
   */
  markRefs(element: Element): () => void;

  /**
   * onOutside runs fn when a press lands in ws, outside the frame: on the
   * sidebar, say. The page never sees such a press itself.
   */
  onOutside(fn: () => void): () => void;
  /**
   * dismissOutside runs fn when a press lands anywhere but in these
   * elements: elsewhere in the page, or in ws outside the frame. It's what
   * closes a menu or a dialog on a press elsewhere. Give it the button
   * that opens the menu as well as the menu, or a press on the button
   * closes it and the click that follows opens it again. It returns a
   * function that stops it.
   */
  dismissOutside(within: Element | readonly Element[], fn: () => void): () => void;

  /**
   * pushHere says the page is showing one of ws's names now, beyond what
   * its address says: an issue open in a panel over the board, RAM-123.
   * ws's Find (⌘K) starts from it: what can be done to it, and what's
   * linked to it. Only for what the address doesn't say: a page of the
   * thing's own, where its kind said one opens, ws knows already.
   *
   * Several may be pushed (a panel, then a dialog over it): the latest
   * still pushed is the one. It returns a function that takes this one
   * off, in whatever order they're taken off; once all are, ws goes back
   * to the page's address. ws forgets them all when the page goes.
   */
  pushHere(name: string): () => void;

  /**
   * setChromeLayout says how the page wants ws's chrome laid out round it.
   * "expanded": the page takes the room the chrome can give up, for a
   * canvas, say, that's better the wider it is: ws folds its sidebar to a
   * rail beside the frame, as on its own such pages, and the rail opens
   * over the page on hover. "standard": as anywhere else, which is where
   * a page starts. The latest said is the one; ws goes back to standard
   * when the page goes.
   */
  setChromeLayout(mode: V1.ChromeMode): void;

  /**
   * ui is ws's own UI, drawn by ws over the frame where the page asks
   * for it: a ref's card by its words.
   */
  readonly ui: Ui;

  /**
   * conversation is the page's say in ws's conversations about it, held
   * in ws's chrome round the frame: the ask bar at its foot, the card it
   * opens, a pane docked beside it, a popover over its corner.
   */
  readonly conversation: Conversations;

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
  const refsChanged = new Set<() => void>();
  const outside = new Set<() => void>();
  const conversed = new Set<(status: ConversationStatus) => void>();
  const marks = new Set<() => void>();
  const dismissals = new Set<() => void>();
  // What's been asked of ws and not yet answered, by the asking's id; and
  // what's to be asked, once whatever is asking now has all asked.
  const asked = new Map<number, (found: FoundRef[][]) => void>();
  let asking: { texts: readonly string[]; found: (found: FoundRef[][]) => void }[] = [];
  let askings = 0;
  let closed = false;

  const send = (m: V1.PageMessage) => port.postMessage(m);
  // What's been pushed as here, the latest last, and the name ws was last
  // told: it's told again only when the latest changes.
  const here: { name: string }[] = [];
  let told: string | undefined;
  const tellHere = () => {
    const name = here.at(-1)?.name;
    if (name === told || closed) return;
    told = name;
    send(name === undefined ? { type: "ws:here" } : { type: "ws:here", name });
  };
  // The chrome layout ws was last told: it's told again only when it
  // changes.
  let layout: V1.ChromeMode = "standard";
  // What the page has said of conversations, and what ws was last told of
  // it: it's told again only when that changes.
  const talks = !!welcome.conversations;
  let settings: Omit<V1.Conversation, "type"> = { ask: false, allow: [...V1.CONVERSATION_FORMS] };
  let toldTalk = "";
  let status: ConversationStatus = { open: false, working: false };
  const tellTalk = () => {
    const m: V1.Conversation = { type: "ws:conversation", ...settings };
    const said = JSON.stringify(m);
    if (said === toldTalk || closed || !talks) return;
    toldTalk = said;
    send(m);
  };
  const on = <F>(fns: Set<F>, fn: F) => {
    fns.add(fn);
    return () => {
      fns.delete(fn);
    };
  };
  const { at, base } = welcome.plugin;
  const open = (to: string, replace?: boolean) => send(replace ? { type: "ws:go", path: to, replace } : { type: "ws:go", path: to });

  // Every asking of this turn goes as one ws:refs, and the answer is
  // dealt back out: a list of rows that each ask is one message.
  const ask = () => {
    const batch = asking;
    asking = [];
    if (!batch.length) return;
    const id = ++askings;
    asked.set(id, (found) => {
      let at = 0;
      for (const b of batch) {
        b.found(b.texts.map((_, i) => found[at + i] ?? []));
        at += b.texts.length;
      }
    });
    send({ type: "ws:refs", id, texts: batch.flatMap((b) => [...b.texts]) });
  };
  const findRefs = (texts: readonly string[]) =>
    new Promise<FoundRef[][]>((resolve) => {
      // A ws that doesn't say it finds names is never asked: it wouldn't
      // answer.
      if (!welcome.refs || closed || !texts.length) return resolve(texts.map(() => []));
      if (!asking.length) queueMicrotask(ask);
      // As they are now: what the caller does with its list afterwards
      // isn't what was asked.
      asking.push({ texts: [...texts], found: resolve });
    });

  // The UIs of ws's own that have been asked for and aren't closed yet,
  // by the asking's id.
  const uis = new Map<number, { ui: string; done: (result: unknown) => void; failed: (err: UiError) => void }>();
  let uiAskings = 0;
  // The UIs this ws said it has. One from before it had any said none.
  const hasUi = new Set(welcome.uis ?? []);
  const openUi = <N extends V1.UiName>(name: N, options: { target?: Element | Box; with: V1.Uis[N]["with"] }): UiOpened<V1.Uis[N]["result"]> => {
    type Result = V1.Uis[N]["result"] | undefined;
    // Nobody's there to show it.
    if (closed) return Object.assign(Promise.resolve<Result>(undefined), { close() {} });
    // A ws that hasn't this UI wouldn't answer, or would only say so: it
    // fails now, so what's awaiting it isn't left waiting.
    if (!hasUi.has(name)) return Object.assign(Promise.reject<Result>(new UiError(`This ws has no UI called ${name}. Update ws.`, name)), { close() {} });
    const id = ++uiAskings;
    const result = new Promise<Result>((resolve, reject) => uis.set(id, { ui: name, done: (r) => resolve(r as Result), failed: reject }));
    const box = boxOf(options.target);
    send({ type: "ws:ui-open", id, ui: name, ...(box ? { box } : {}), with: { ...options.with } });
    return Object.assign(result, {
      close() {
        const asked = uis.get(id);
        if (!asked) return;
        uis.delete(id);
        send({ type: "ws:ui-close", id });
        asked.done(undefined);
      },
    });
  };
  const refCard = (target: Element | Box, ref: string) => {
    if (!ref) throw new TypeError('ui.refCard(target, ""): a ref is ws\'s word for it, as findRefs gave it.');
    const card = openUi("ref-card", { target, with: { ref } });
    // A ws that has no card for it shows none: there's nothing to do about it here.
    card.catch(() => {});
    return () => card.close();
  };

  const aboutThing = (how: string, thing: ThingAsked) => {
    if (!thing?.kind || !thing.ref) throw new TypeError(`ui.${how}(target, thing): a thing is its kind and the plugin's name for it, { kind: "sketch", ref: "sketch-12" }.`);
    return { kind: thing.kind, ref: thing.ref, ...(thing.title ? { title: thing.title } : {}) };
  };
  const promoteThing = (target: Element | Box, thing: ThingAsked) => openUi("thing-promote", { target, with: aboutThing("promoteThing", thing) });
  const saveThing = (target: Element | Box, thing: ThingAsked) => openUi("thing-save", { target, with: aboutThing("saveThing", thing) });

  const viewPicture = (src: string, options: { title?: string; target?: Element | Box } = {}) => {
    // ws is given the full address: a relative one is the page's.
    let full = src;
    try {
      full = new URL(src, doc?.defaultView?.location.href).href;
    } catch {
      // Not an address at all: said below.
    }
    const page = doc?.defaultView?.location.origin;
    const why = V1.pictureRefused(full, page && page !== "null" ? page : "", welcome.plugin);
    if (why) throw new TypeError(`ui.viewPicture(src): ${why}`);
    return openUi("picture", { target: options.target, with: { src: full, ...(options.title ? { title: options.title } : {}) } });
  };
  // A click on a picture drawn to be viewed: it's shown, if this ws can.
  // What it's in (a link to the file) is followed where it can't.
  const viewClicked = (el: Element) => {
    if (!hasUi.has("picture")) return false;
    const img = el.tagName === "IMG" ? (el as HTMLImageElement) : el.querySelector("img");
    const src = img && (img.currentSrc || img.getAttribute("src"));
    if (!img || !src) return false;
    const title = el.getAttribute("data-ws-view") || img.getAttribute("alt") || img.getAttribute("title") || undefined;
    try {
      viewPicture(src, { title, target: img }).catch(() => {});
    } catch {
      return false;
    }
    return true;
  };

  if (doc) applyTheme(doc, theme);
  const wired = doc ? wire(doc, welcome, send, open, refCard, viewClicked) : undefined;

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
        // What the pointer was on is the page before's.
        wired?.left();
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
      case "ws:refs-found": {
        const found = asked.get(m.id);
        asked.delete(m.id);
        found?.(m.found);
        break;
      }
      case "ws:refs-changed":
        for (const fn of [...refsChanged]) fn();
        break;
      case "ws:outside":
        for (const fn of [...outside]) fn();
        break;
      case "ws:ui-closed": {
        const asked = uis.get(m.id);
        uis.delete(m.id);
        if (m.error !== undefined) asked?.failed(new UiError(m.error, asked.ui));
        else asked?.done(m.result);
        break;
      }
      case "ws:conversation-state":
        status = m.as === undefined ? { open: m.open, working: m.working } : { open: m.open, as: m.as, working: m.working };
        for (const fn of [...conversed]) fn(status);
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
    findRefs,
    onRefsChanged: (fn) => on(refsChanged, fn),
    markRefs(element) {
      const stop = mark(element, { find: (texts) => findRefs(texts), onChanged: (fn) => on(refsChanged, fn) });
      marks.add(stop);
      return () => {
        marks.delete(stop);
        stop();
      };
    },
    onOutside: (fn) => on(outside, fn),
    dismissOutside(within, fn) {
      const els: readonly Element[] = "nodeType" in within ? [within] : within;
      // A press in the page, heard before whatever it lands on can stop
      // it; and one in ws, which ws says. A function of its own for each,
      // so stopping one leaves another that was given the same fn.
      const pressed = (e: Event) => {
        const on = e.target as Node | null;
        if (on && els.some((el) => el.contains(on))) return;
        fn();
      };
      doc?.addEventListener("pointerdown", pressed, true);
      const unheard = on(outside, () => fn());
      const stop = () => {
        dismissals.delete(stop);
        doc?.removeEventListener("pointerdown", pressed, true);
        unheard();
      };
      dismissals.add(stop);
      return stop;
    },
    go(to, options = {}) {
      if (!to.startsWith("/")) throw new TypeError(`go("${to}"): a path in the plugin starts with "/".`);
      open(at + to, options.replace);
    },
    pushHere(name) {
      if (!name) throw new TypeError("pushHere(\"\"): a name says what the page shows.");
      const entry = { name };
      here.push(entry);
      tellHere();
      let gone = false;
      return () => {
        if (gone) return;
        gone = true;
        here.splice(here.indexOf(entry), 1);
        tellHere();
      };
    },
    ui: { has: (name) => hasUi.has(name), open: openUi, refCard, promoteThing, saveThing, viewPicture },
    setChromeLayout(mode) {
      if (mode !== "expanded" && mode !== "standard") throw new TypeError(`setChromeLayout("${String(mode)}"): the layout is "expanded" or "standard".`);
      if (mode === layout || closed) return;
      layout = mode;
      send({ type: "ws:chrome-layout", mode });
    },
    conversation: {
      available: talks,
      get status() {
        return status;
      },
      set(say) {
        const next: Record<string, unknown> = { ...settings };
        for (const [key, value] of Object.entries(say)) {
          if (!["ask", "allow", "placeholder", "holding", "context", "suggestions"].includes(key)) continue;
          if (value === undefined) delete next[key];
          else next[key] = Array.isArray(value) ? [...value] : value;
        }
        if (next.ask === undefined) next.ask = false;
        if (next.allow === undefined) next.allow = [...V1.CONVERSATION_FORMS];
        const allow = next.allow as unknown[];
        const bad = allow.find((f) => !V1.isConversationForm(f));
        if (bad !== undefined) throw new TypeError(`conversation.set({ allow }): "${String(bad)}" isn't a form: they're ${V1.CONVERSATION_FORMS.join(", ")}.`);
        const holding = next.holding as Holding | undefined;
        if (holding && !holding.label) throw new TypeError("conversation.set({ holding }): a holding has a label, for its chip.");
        settings = next as typeof settings;
        tellTalk();
      },
      open(options = {}) {
        if (options.as !== undefined && !V1.isConversationForm(options.as)) throw new TypeError(`conversation.open({ as: "${String(options.as)}" }): the forms are ${V1.CONVERSATION_FORMS.join(", ")}.`);
        if (!talks || closed) return;
        // What it opens with is what the page has said, so ws hears that first.
        tellTalk();
        const m: V1.ConversationOpen = { type: "ws:conversation-open" };
        if (options.message?.trim()) m.message = options.message;
        if (options.context?.trim()) m.context = options.context;
        if (options.as) m.as = options.as;
        send(m);
      },
      close() {
        if (talks && !closed) send({ type: "ws:conversation-close" });
      },
      onChange: (fn) => on(conversed, fn),
    },
    setTitle(title) {
      if (doc) doc.title = title;
      send({ type: "ws:title", title });
    },
    open: (to) => open(to),
    close() {
      wired?.stop();
      for (const stop of [...marks]) stop();
      marks.clear();
      for (const stop of [...dismissals]) stop();
      // ws forgets what's here when the page goes: it isn't told.
      here.length = 0;
      // Nobody's left to answer: what's still asked for finds nothing.
      closed = true;
      for (const b of asking.splice(0)) b.found(b.texts.map(() => []));
      for (const found of [...asked.values()]) found([]);
      asked.clear();
      // ws takes down what was asked for when the page goes: it isn't told.
      for (const ui of [...uis.values()]) ui.done(undefined);
      uis.clear();
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
// clicks on links, and the pointer on a ref. It returns what undoes it
// (stop), and what says the pointer's on nothing now (left).
function wire(
  doc: Document,
  welcome: V1.Welcome,
  send: (m: V1.PageMessage) => void,
  open: (address: string) => void,
  refCard: (target: Element, ref: string) => () => void,
  viewClicked: (el: Element) => boolean,
): { stop(): void; left(): void } {
  const { keys } = welcome;
  let leaderAt = 0;

  // The ref the pointer's on, or the keys are: its card is asked of ws as
  // the pointer comes, from where the ref's words are, and closed as it
  // goes. A ref is whatever's drawn as one, by markRefs or by the app.
  // How long the card waits is ws's: this says only that the pointer came,
  // and that it went.
  let over: Element | undefined;
  let closeCard = () => {};
  const tell = (el: Element | undefined) => {
    closeCard();
    closeCard = () => {};
    over = el;
    const ref = el?.getAttribute("data-ws-ref");
    if (el && ref) closeCard = refCard(el, ref);
  };
  const hover = (el: Element | undefined) => {
    if (el !== over) tell(el);
  };
  const onOver = (e: Event) => hover(refOn(e.target));
  // The pointer left the page: for ws, or for the card ws drew over it.
  const onOut = (e: MouseEvent) => {
    if (!e.relatedTarget) hover(undefined);
  };
  // The keys' focus is as the pointer: a press's isn't, since the press
  // is about to follow the ref.
  const onFocus = (e: Event) => {
    const el = refOn(e.target);
    if (el && focusShown(el)) hover(el);
  };
  const onBlur = (e: Event) => {
    if (over && refOn(e.target) === over) hover(undefined);
  };
  // Pressed, the ref is being followed, or something else is being done.
  const left = () => hover(undefined);
  // Scrolled, the words aren't where ws was told. The pointer's on
  // something else now, which the page hears next. The keys' focus is
  // still on its ref (a ref focused past the page's edge is scrolled to):
  // its card is asked for again, from where its words are now.
  const onScroll = () => {
    if (over && doc.activeElement === over) tell(over);
    else left();
  };

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
    // A picture drawn to be viewed is, before the link it's in is followed.
    const viewable = target?.closest?.("[data-ws-view]");
    if (viewable && viewClicked(viewable)) {
      e.preventDefault();
      return;
    }
    const a =target?.closest?.("a[href]") as HTMLAnchorElement | null | undefined;
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
  doc.addEventListener("mouseover", onOver);
  doc.addEventListener("mouseout", onOut);
  doc.addEventListener("focusin", onFocus);
  doc.addEventListener("focusout", onBlur);
  doc.addEventListener("scroll", onScroll, true);
  doc.addEventListener("pointerdown", left, true);
  return {
    stop() {
      doc.removeEventListener("keydown", onKey);
      doc.removeEventListener("click", onClick);
      doc.removeEventListener("mouseover", onOver);
      doc.removeEventListener("mouseout", onOut);
      doc.removeEventListener("focusin", onFocus);
      doc.removeEventListener("focusout", onBlur);
      doc.removeEventListener("scroll", onScroll, true);
      doc.removeEventListener("pointerdown", left, true);
    },
    left,
  };
}

// The ref something in the page is in, if it's in one: an element drawn
// as a ref is, with ws's word for it.
function refOn(target: EventTarget | null): Element | undefined {
  const el = (target as Partial<Element> | null)?.closest?.(".ws-ref[data-ws-ref]");
  return el && el.getAttribute("data-ws-ref") ? el : undefined;
}

// Where on the page a UI is asked from: an element's box as it is now, or
// the box given.
function boxOf(target: Element | Box | undefined): Box | undefined {
  if (!target) return undefined;
  const { x, y, width, height } = "getBoundingClientRect" in target ? target.getBoundingClientRect() : target;
  return { x, y, width, height };
}

// Whether the focus on an element is one that's shown: the keys', and not
// a press's. A browser that can't say is taken to show it.
function focusShown(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
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
