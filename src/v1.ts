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
  /**
   * ws holds conversations about the page: it answers ws:conversation,
   * ws:conversation-open and ws:conversation-close. A ws from before it
   * did doesn't say so, and a page there shows no ask of its own.
   */
  conversations?: boolean;
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

/**
 * Box is where something is on the page: its box in the frame's own
 * viewport, in CSS pixels, as an element's getBoundingClientRect() gives
 * it. The page says where a thing is in itself, and ws adds where the
 * frame is in its window: what ws draws for it sits by the thing, as if
 * the frame had no edge.
 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Uis is the UIs of ws's own that a page can ask for, by name: what each
 * is given (with), and what comes of it (result). ws defines each one:
 * what it draws, how it behaves, and what it does. A page says only
 * which, what it's about, and where on the page it's asked from. A UI is
 * added here, in ws, and to the client as a method of its own, together.
 */
export interface Uis {
  /**
   * A ref's card: more about what the ref names, shown by its words
   * while the pointer's on them, as for a ref in ws's own pages. It's
   * asked for as the pointer comes to the ref, with the box of its
   * words, and closed as the pointer goes. The card's wait (a moment
   * before it shows, a moment after it's closed, so the pointer can be
   * moved onto it) is ws's.
   */
  "ref-card": {
    with: {
      /** ws's word for the ref, as ws:refs-found gave it. */
      ref: string;
    };
    result: undefined;
  };
}

/** The name of one of ws's UIs. */
export type UiName = keyof Uis;

/** The names of the UIs this release knows of. */
export const UI_NAMES: readonly UiName[] = ["ref-card"];

/**
 * UiOpen asks ws for one of its own UIs, drawn by ws over the frame and
 * past its edge where it needs the room. box is where on the page it's
 * asked from (a button's box, a ref's words): ws places what it draws by
 * it. ws answers only when it closes the UI itself (ws:ui-closed), or
 * can't show it.
 */
export interface UiOpen {
  type: "ws:ui-open";
  /** The page's number for the asking, which ws:ui-close and ws:ui-closed have. */
  id: number;
  /** Which of ws's UIs: one of Uis' names. */
  ui: string;
  box?: Box;
  /** What that UI is given. */
  with?: Record<string, unknown>;
}

/** UiClose takes back a UI the page asked for: the pointer went, the page moved on. */
export interface UiClose {
  type: "ws:ui-close";
  id: number;
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

/**
 * The forms a conversation about the page can take, in ws's chrome round
 * the frame. card: a card over the foot of the page, where the ask bar
 * is. docked: a pane beside the frame, which the page gives up room to.
 * popover: a panel floating over the page's corner, and a launcher when
 * it's closed.
 */
export type ConversationForm = "card" | "docked" | "popover";

export const CONVERSATION_FORMS: readonly ConversationForm[] = ["card", "docked", "popover"];

/**
 * Holding is what the person has in hand on the page: a selection. ws
 * shows it as a chip on the ask bar, and gives it to the agent with the
 * next thing asked.
 */
export interface Holding {
  /** What it is, in a few words, for the chip: "2 selected". */
  label: string;
  /** ws's names in it (RAM-12, sketch-3), drawn as refs on the chip. */
  names?: string[];
  /** It as words, for the agent: what's selected, and what it says. */
  text?: string;
}

/**
 * Conversation is all the page says of conversations about it, each time
 * any of it changes: ws takes it in place of what it was told before.
 * What a conversation is about is what the page is of (its address, or
 * ws:here). ws forgets it when the page goes.
 */
export interface Conversation {
  type: "ws:conversation";
  /** Show ws's ask bar at the foot of the page: a passive way in. */
  ask: boolean;
  /**
   * The forms the conversation may take here. The person moves it among
   * them and ws remembers their choice; ws fits it to the window (too
   * narrow to dock, it floats). Empty: ws offers none on this page.
   */
  allow: ConversationForm[];
  /** What the bar says before anything's typed: "Ask about this sketch". */
  placeholder?: string;
  holding?: Holding;
  /**
   * Standing context: the page's state as words (what's on a canvas, the
   * filter a board is under), for the agent, not the person. ws gives it
   * with a message only when it's changed since the agent was last given
   * it, and folds it under the message, so the person can see what the
   * agent was told.
   */
  context?: string;
  /** Things to ask, offered as the conversation starts. */
  suggestions?: string[];
}

/**
 * ConversationOpen opens the conversation about the page. With a message,
 * it's said as the person's, and with context, that's given to the agent
 * with it (and folded under it, as standing context is). as asks for a
 * form; without it, the person's own choice is used, as ws remembers it
 * for the plugin.
 */
export interface ConversationOpen {
  type: "ws:conversation-open";
  message?: string;
  context?: string;
  as?: ConversationForm;
}

/** ConversationClose closes it: it folds back to the bar, or away. */
export interface ConversationClose {
  type: "ws:conversation-close";
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

/**
 * UiClosed is ws closing a UI the page asked for: it was dismissed, or it
 * finished, with what came of it (result, as that UI's has it). With an
 * error, it was never shown: this ws has no UI of that name, or it
 * wasn't given what the UI takes; the sentence is for whoever's writing
 * the page. ws says none of this for a UI the page closed itself.
 */
export interface UiClosed {
  type: "ws:ui-closed";
  id: number;
  result?: unknown;
  error?: string;
}

/**
 * ConversationState is where the conversation about the page is now,
 * said each time it changes: open or not, the form it's in, and whether
 * its agent is working on an answer. A canvas, say, keeps clear of a
 * docked pane, or shows that changes are coming.
 */
export interface ConversationState {
  type: "ws:conversation-state";
  open: boolean;
  /** The form it's shown in, while it's open. */
  as?: ConversationForm;
  working: boolean;
}

/** What a page sends on the port. */
export type PageMessage = Go | Title | Key | Refs | UiOpen | UiClose | Here | ChromeLayout | Conversation | ConversationOpen | ConversationClose;
/** What ws sends on the port. */
export type HostMessage = Welcome | Refuse | Navigate | ThemeChanged | Changed | RefsFound | RefsChanged | Outside | UiClosed | ConversationState;

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
    (m.refs === undefined || typeof m.refs === "boolean") &&
    (m.conversations === undefined || typeof m.conversations === "boolean")
  );
}

const isIndex = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

const isSize = (v: unknown): v is number => Number.isFinite(v) && (v as number) >= 0;

export function isBox(m: unknown): m is Box {
  return isRecord(m) && Number.isFinite(m.x) && Number.isFinite(m.y) && isSize(m.width) && isSize(m.height);
}

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

export const isConversationForm = (v: unknown): v is ConversationForm => CONVERSATION_FORMS.includes(v as ConversationForm);

const optional = <T>(v: unknown, is: (v: unknown) => v is T) => v === undefined || is(v);

function isHolding(m: unknown): m is Holding {
  return isRecord(m) && isString(m.label) && optional(m.names, isStrings) && optional(m.text, isString);
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
    case "ws:ui-open":
      return isIndex(m.id) && isString(m.ui) && m.ui !== "" && optional(m.box, isBox) && optional(m.with, isRecord);
    case "ws:ui-close":
      return isIndex(m.id);
    case "ws:here":
      return m.name === undefined || (isString(m.name) && m.name !== "");
    case "ws:chrome-layout":
      return m.mode === "expanded" || m.mode === "standard";
    case "ws:conversation":
      return (
        typeof m.ask === "boolean" &&
        Array.isArray(m.allow) &&
        m.allow.every(isConversationForm) &&
        optional(m.placeholder, isString) &&
        optional(m.holding, isHolding) &&
        optional(m.context, isString) &&
        optional(m.suggestions, isStrings)
      );
    case "ws:conversation-open":
      return optional(m.message, isString) && optional(m.context, isString) && optional(m.as, isConversationForm);
    case "ws:conversation-close":
      return true;
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
    case "ws:ui-closed":
      return isIndex(m.id) && optional(m.error, isString);
    case "ws:conversation-state":
      return typeof m.open === "boolean" && optional(m.as, isConversationForm) && typeof m.working === "boolean";
    default:
      return false;
  }
}
