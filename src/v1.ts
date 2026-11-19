// Frame protocol 1's messages. Each is { type: "ws:…", … }. Apart from
// ws:connect, which goes to the parent window, all of them are on the
// MessagePort the page handed over with it. Within the version these only
// gain: a new optional field, or a new message the other side may drop.

import type { Connect, Refuse, TokenVar } from "./protocol.js";
import { isRecord, isString, isStrings, isVersions } from "./shape.js";

export type { Connect, Refuse };

export type Scheme = "light" | "dark";

/**
 * Vars is each token's value now, by its --ws-* name. Every name in TOKENS
 * is there. ws may send more.
 */
export type Vars = Record<TokenVar, string> & Record<`--${string}`, string>;

/** Theme is ws's theme as a page takes it. */
export interface Theme {
  scheme: Scheme;
  vars: Vars;
}

/** Keys says which keys are ws's, for the page to pass on as ws:key. */
export interface Keys {
  /** Taken with ⌘ or Ctrl held, always, even while typing: "k". */
  chords: string[];
  /** Taken with no modifier, when nothing's being typed in: "?". */
  bare: string[];
  /** Bare keys after which the next bare letter, a to z, is ws's too: "g". */
  leaders: string[];
  /** How long after a leader its letter still counts, in milliseconds. */
  within: number;
}

/** The plugin the page is of, and where it's served. */
export interface Plugin {
  name: string;
  /**
   * The path the plugin's pages are under in ws's address: /x/jira. A link
   * in the app is to a page here, so it opens where it should in a tab of
   * its own.
   */
  at: string;
  /**
   * The path the frame's own address is under: /plugin-frame/jira. Only
   * the client needs it: a relative link resolves against the frame's
   * address, and the client reads it as the page under at it means.
   */
  base: string;
  /** The path the plugin's own HTTP is under: /plugins/jira. */
  api: string;
}

/**
 * Welcome is ws's answer to a ws:connect it can meet: the version it
 * chose, and what the page starts with.
 */
export interface Welcome {
  type: "ws:welcome";
  version: 1;
  /**
   * ws's own version, for logs and error messages. A page decides nothing
   * by it: the protocol version says what it can rely on.
   */
  ws: string;
  plugin: Plugin;
  /**
   * Where in the plugin ws's address is, without a base, with its query:
   * /browse/PROJ-1?tab=links.
   */
  path: string;
  theme: Theme;
  keys: Keys;
  /**
   * ws finds its names in text: it answers ws:refs. A ws from before it
   * did doesn't say so, and a page there asks nothing and finds nothing.
   */
  refs?: boolean;
}

/**
 * FoundRef is one of ws's names in a run of text (a file, a pull request,
 * a mission, a plugin's thing), as ws found it: where it is, what it is,
 * where it goes, and how it's drawn. Which words are names is ws's alone
 * to say: it knows what there is to name.
 */
export interface FoundRef {
  /** Where it starts in the text, as a string's index. */
  from: number;
  /** Where it ends: text.slice(from, to) is the name. */
  to: number;
  /**
   * ws's own word for what's named. A page keeps it with what it draws and
   * says it back when it says something of the ref. It reads nothing in it.
   */
  ref: string;
  /**
   * What kind of thing it is: "file", "dir", "repo", "pr", "mission",
   * "page", "talk", "artifact", or "thing" for a plugin's. More may come.
   */
  kind: string;
  /**
   * Where it goes: an address of ws's (/missions/token-cache), or one
   * outside (https://…) for a thing that opens nowhere in ws.
   */
  href: string;
  /** "pill" for one drawn as a pill. Without it, its words, marked. */
  shape?: string;
  /** A CSS colour of its own: a repo's. */
  accent?: string;
}

// From the page.

/**
 * Go asks ws to go to an address of its own: /x/jira/browse/PROJ-2, a page
 * in the plugin, or /missions/token-cache, a page of ws's. Every link
 * clicked in the app, and every move the app makes, is one: the frame
 * keeps no history of its own. ws decides what it does. When it's in the
 * plugin, ws's address moves and ws says ws:navigate, as it does for any
 * other move.
 */
export interface Go {
  type: "ws:go";
  path: string;
  /** Replace ws's history entry and don't add one: a redirect, a filter. */
  replace?: boolean;
}

/**
 * The page's title, for the tab and the frame's label. An empty title
 * means the view's own.
 */
export interface Title {
  type: "ws:title";
  title: string;
}

/** A key ws owns was pressed in the frame. */
export interface Key {
  type: "ws:key";
  key: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

/**
 * Refs asks ws which of its names are in some runs of text. ws answers
 * with a ws:refs-found of the same id.
 */
export interface Refs {
  type: "ws:refs";
  /** The page's number for the asking, which the answer has. */
  id: number;
  texts: string[];
}

/**
 * Here is what the page shows now that its address doesn't say: a thing
 * open in a panel over a list, say. name is one of ws's names (RAM-123, a
 * mission's slug, demo#12); none, when the page shows nothing beyond its
 * address. Until a page says one, and once it says none, ws reads what the
 * page is of from its address, as the thing's kind said its pages are.
 * ws's Find (⌘K) starts from it: what can be done to it, and what's linked
 * to it. ws forgets it when the page goes.
 */
export interface Here {
  type: "ws:here";
  name?: string;
}

/** The layouts of ws's chrome a page may ask for. */
export type ChromeMode = "expanded" | "standard";

/**
 * ChromeLayout is how the page wants ws's chrome laid out round it.
 * expanded: the page takes the room the chrome can give up (a canvas, a
 * board, an editor that's better the wider it is): ws folds its sidebar
 * to a rail beside the frame, as it does for its own such pages (a
 * mission, a review), and the rail opens over the page on hover.
 * standard: ws's chrome as it is anywhere else. ws goes back to standard
 * when the page goes.
 */
export interface ChromeLayout {
  type: "ws:chrome-layout";
  mode: ChromeMode;
}

// From ws.

/**
 * ws's address moved within the plugin: a ws:go from the page, the
 * sidebar, a link in ws, back and forward. The app shows that path. It's
 * the only way the app's path changes.
 */
export interface Navigate {
  type: "ws:navigate";
  path: string;
}

/** The theme changed: as the welcome's theme. */
export interface ThemeChanged extends Theme {
  type: "ws:theme";
}

/** The plugin said view/changed: what the app shows may be stale. */
export interface Changed {
  type: "ws:changed";
}

/**
 * The answer to a ws:refs: for each of its texts, in their order, the refs
 * in it, in the order they're in, none over another.
 */
export interface RefsFound {
  type: "ws:refs-found";
  id: number;
  found: FoundRef[][];
}

/**
 * What there is to name changed (a mission began, a repo's files were
 * read): what a ws:refs found may be different now. A page that drew refs
 * asks again. ws says it only to a page that has asked.
 */
export interface RefsChanged {
  type: "ws:refs-changed";
}

/**
 * A press landed in ws, outside the frame: on the sidebar, say. A page
 * never sees such a press itself, so whatever it closes on a press
 * elsewhere (a menu, a dialog) closes on this too.
 */
export interface Outside {
  type: "ws:outside";
}

/** What a page sends on the port. */
export type PageMessage = Go | Title | Key | Refs | Here | ChromeLayout;
/** What ws sends on the port. */
export type HostMessage = Welcome | Refuse | Navigate | ThemeChanged | Changed | RefsFound | RefsChanged | Outside;

// The guards check a message's shape: that it's one of this version's,
// with each field it must have. A message that fails is dropped, which is
// what lets a version gain messages.

function isTheme(m: unknown): m is Theme {
  return isRecord(m) && (m.scheme === "light" || m.scheme === "dark") && isRecord(m.vars) && Object.values(m.vars).every(isString);
}

function isKeys(m: unknown): m is Keys {
  return isRecord(m) && isStrings(m.chords) && isStrings(m.bare) && isStrings(m.leaders) && typeof m.within === "number";
}

function isPlugin(m: unknown): m is Plugin {
  return isRecord(m) && isString(m.name) && isString(m.at) && isString(m.base) && isString(m.api);
}

export function isWelcome(m: unknown): m is Welcome {
  return (
    isRecord(m) &&
    m.type === "ws:welcome" &&
    m.version === 1 &&
    isString(m.ws) &&
    isPlugin(m.plugin) &&
    isString(m.path) &&
    isTheme(m.theme) &&
    isKeys(m.keys) &&
    (m.refs === undefined || typeof m.refs === "boolean")
  );
}

const isIndex = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

export function isFoundRef(m: unknown): m is FoundRef {
  return (
    isRecord(m) &&
    isIndex(m.from) &&
    isIndex(m.to) &&
    m.to > m.from &&
    isString(m.ref) &&
    isString(m.kind) &&
    isString(m.href) &&
    (m.shape === undefined || isString(m.shape)) &&
    (m.accent === undefined || isString(m.accent))
  );
}

export function isPageMessage(m: unknown): m is PageMessage {
  if (!isRecord(m)) return false;
  switch (m.type) {
    case "ws:go":
      return isString(m.path) && (m.replace === undefined || typeof m.replace === "boolean");
    case "ws:title":
      return isString(m.title);
    case "ws:key":
      return isString(m.key) && [m.meta, m.ctrl, m.shift, m.alt].every((v) => typeof v === "boolean");
    case "ws:refs":
      return isIndex(m.id) && isStrings(m.texts);
    case "ws:here":
      return m.name === undefined || (isString(m.name) && m.name !== "");
    case "ws:chrome-layout":
      return m.mode === "expanded" || m.mode === "standard";
    default:
      return false;
  }
}

export function isHostMessage(m: unknown): m is HostMessage {
  if (!isRecord(m)) return false;
  switch (m.type) {
    case "ws:welcome":
      return isWelcome(m);
    case "ws:refuse":
      return isVersions(m.versions) && isString(m.message);
    case "ws:navigate":
      return isString(m.path);
    case "ws:theme":
      return isTheme(m);
    case "ws:changed":
      return true;
    case "ws:refs-found":
      return isIndex(m.id) && Array.isArray(m.found) && m.found.every((of) => Array.isArray(of) && of.every(isFoundRef));
    case "ws:refs-changed":
      return true;
    case "ws:outside":
      return true;
    default:
      return false;
  }
}
