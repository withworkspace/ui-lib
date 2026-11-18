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

/** What a page sends on the port. */
export type PageMessage = Go | Title | Key;
/** What ws sends on the port. */
export type HostMessage = Welcome | Refuse | Navigate | ThemeChanged | Changed;

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
    isKeys(m.keys)
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
    default:
      return false;
  }
}
