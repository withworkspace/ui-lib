// A fake host: ws, without ws. It answers a page's ws:connect as ws web
// does, from the same types, and lets a test say what ws would (a move, a
// theme, a change) and see what the page said. Like ws, it follows a
// ws:go into the plugin with a ws:navigate, and answers a ws:refs with
// what it's been told to find. It needs no DOM: it runs on a
// MessageChannel, which Node has.

import { type Connect, type Refuse, TOKENS, type Token, V1, chooseVersion, isConnect } from "./protocol.js";

export interface FakeHostOptions {
  /**
   * The frame protocol versions the host says it speaks. [1] by default.
   * A list without the page's, as [2] is, refuses the page.
   */
  versions?: number[];
  /** Never answer: a ws from before frame protocol 1, or no ws at all. */
  silent?: boolean;
  /** Where in the plugin ws's address is. "/" by default. */
  path?: string;
  /** "light" by default. */
  scheme?: V1.Scheme;
  /** Values in place of the plausible ones each token is given. */
  vars?: SomeVars;
  /** The plugin's name. "fake" by default. */
  name?: string;
  /** The keys ws owns. ws's own, as they were at protocol 1, by default. */
  keys?: V1.Keys;
  /** ws's version, as the welcome says it. */
  ws?: string;
  /**
   * What the host finds in a run of text, as ws finds its names: named()
   * makes one from some names. By default it finds nothing. false is a ws
   * from before it could be asked: its welcome doesn't say it finds
   * names, and a ws:refs gets no answer.
   */
  refs?: FindRefs | false;
  /**
   * false is a ws from before it held conversations about pages: its
   * welcome doesn't say it does, and the page says nothing of them.
   */
  conversations?: boolean;
}

/** FindRefs is the refs in a run of text, in order, none over another. */
export type FindRefs = (text: string) => V1.FoundRef[];

/**
 * named is a finder for the fake host that finds these names wherever
 * they're whole words, each going where it's said to:
 *
 *   fakeHost({ refs: named({ "PROJ-1": "/x/jira/browse/PROJ-1" }) })
 *
 * A name's kind is "thing" unless it says another, and its ref is its
 * name.
 */
export function named(names: Record<string, string | (Partial<Omit<V1.FoundRef, "from" | "to">> & { href: string })>): FindRefs {
  // As ws: a name isn't part of a longer word, a path or an address, and
  // a sentence's full stop after it is no part of it.
  const before = /[\w/.#-]/;
  const after = /[\w/#-]/;
  return (text) => {
    const found: V1.FoundRef[] = [];
    for (const [name, to] of Object.entries(names)) {
      if (!name) continue;
      const how = typeof to === "string" ? { href: to } : to;
      for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + name.length)) {
        const end = at + name.length;
        if ((at > 0 && before.test(text[at - 1]!)) || (end < text.length && after.test(text[end]!))) continue;
        found.push({ ref: name, kind: "thing", ...how, from: at, to: end });
      }
    }
    found.sort((a, b) => a.from - b.from || b.to - a.to);
    return found.filter((f, i) => i === 0 || f.from >= found[i - 1]!.to);
  };
}

/** Some custom properties' values, by name: { "--ws-accent": "#f0f" }. */
export type SomeVars = { [name: `--${string}`]: string };

/** As much of a window as a page sends its ws:connect to. */
export interface FakeWindow {
  postMessage(message: unknown, targetOrigin: string, transfer: Transferable[]): void;
}

export interface FakeHost {
  /** What stands in for window.parent: connect({ host: host.window }). */
  readonly window: FakeWindow;
  /** Every ws:connect a page has sent, in order. */
  readonly connects: readonly Connect[];
  /** Every message the page has sent on its port, in order. */
  readonly sent: readonly V1.PageMessage[];
  /**
   * Where in the plugin ws's address is now: where it started, then each
   * navigate() and each ws:go into the plugin.
   */
  readonly path: string;
  /**
   * here is the name the page last said it shows beyond its address
   * (ws:here), or none.
   */
  readonly here: string | undefined;
  /** chromeLayout is how the page last said it wants ws's chrome laid out (ws:chrome-layout). */
  readonly chromeLayout: V1.ChromeMode;
  /** conversation is what the page last said of conversations about it (ws:conversation), or nothing. */
  readonly conversation: Omit<V1.Conversation, "type"> | undefined;
  /**
   * next resolves with the next message of this type from the page that no
   * earlier next() was given, whether it has arrived already or is still
   * to come. It rejects if none comes within the timeout (1000ms by
   * default).
   */
  next<T extends V1.PageMessage["type"]>(type: T, options?: { timeout?: number }): Promise<Extract<V1.PageMessage, { type: T }>>;

  /**
   * navigate sends ws:navigate: ws's address moved within the plugin. The
   * host does it by itself for a ws:go into the plugin, as ws does.
   */
  navigate(path: string): void;
  /**
   * theme sends ws:theme. A scheme brings its own plausible values, and
   * vars are set over them.
   */
  theme(theme?: { scheme?: V1.Scheme; vars?: SomeVars }): void;
  /** changed sends ws:changed: the plugin said view/changed. */
  changed(): void;
  /**
   * refsChanged sends ws:refs-changed: what there is to name changed.
   * Given a finder, that's what the host finds from then on.
   */
  refsChanged(refs?: FindRefs): void;
  /** outside sends ws:outside: a press landed in ws, outside the frame. */
  outside(): void;
  /**
   * conversationState sends ws:conversation-state: the conversation about
   * the page opened, closed, moved, or started or stopped working. The
   * host says nothing of it by itself.
   */
  conversationState(state: { open: boolean; as?: V1.ConversationForm; working?: boolean }): void;
  /**
   * send sends anything at all on the port: a message from a later
   * release, say, to show the page drops it.
   */
  send(message: unknown): void;
  /** close closes the port to the page. */
  close(): void;
}

const colours: Record<V1.Scheme, Record<string, string>> = {
  light: {
    bg: "#ffffff", panel: "#f7f7f8", raised: "#ffffff", fg: "#1a1a1e", dim: "#5c5c66", faint: "#8e8e99",
    line: "#e4e4e8", "line-strong": "#c9c9d1", hover: "#f0f0f3", well: "#f3f3f5", "code-bg": "#f3f3f5",
    accent: "#6e509c", "accent-soft": "#efeaf6", "accent-line": "#cdbfe3",
    primary: "#6e509c", "primary-hover": "#5d4287", "on-primary": "#ffffff",
    danger: "#c0362c", warn: "#a86a00", ok: "#2e7d4f", scrim: "rgb(20 20 28 / 0.32)",
    shadow: "0 1px 3px rgb(0 0 0 / 0.12)",
  },
  dark: {
    bg: "#16161a", panel: "#1c1c21", raised: "#232329", fg: "#ececf0", dim: "#a3a3ad", faint: "#74747e",
    line: "#2e2e35", "line-strong": "#43434c", hover: "#26262c", well: "#121215", "code-bg": "#1f1f24",
    accent: "#a08ad0", "accent-soft": "#2a2438", "accent-line": "#4a3f66",
    primary: "#a08ad0", "primary-hover": "#b29fdc", "on-primary": "#16161a",
    danger: "#f0776c", warn: "#e0a84a", ok: "#6cc490", scrim: "rgb(0 0 0 / 0.55)",
    shadow: "0 1px 3px rgb(0 0 0 / 0.5)",
  },
};

const measures: Record<string, string> = {
  font: "system-ui, sans-serif", mono: "ui-monospace, monospace",
  "text-xs": "11px", "text-sm": "12px", "text-md": "14px", "text-lg": "16px", "text-xl": "20px", "text-2xl": "26px",
  "space-1": "4px", "space-2": "8px", "space-3": "12px", "space-4": "16px", "space-5": "20px", "space-6": "24px",
  "space-8": "32px", "space-10": "40px",
  radius: "6px", "radius-sm": "4px", "radius-lg": "10px",
};

// Every token, with a plausible value for the scheme.
function plausible(scheme: V1.Scheme): V1.Vars {
  const value = (name: Token) => colours[scheme][name] ?? measures[name] ?? "initial";
  return Object.fromEntries(TOKENS.map((name) => [`--ws-${name}`, value(name)])) as V1.Vars;
}

// Which side is behind, as ws says it.
function refusal(name: string, page: readonly number[], host: readonly number[]): string {
  if (!page.length) return `${name} lists no frame protocol version, and this ws speaks ${host.join(", ")}. Update the plugin.`;
  const ahead = Math.max(...page) > Math.max(...host);
  return `${name} speaks frame protocol ${page.join(", ")}, and this ws speaks ${host.join(", ")}. Update ${ahead ? "ws" : "the plugin"}.`;
}

export function fakeHost(options: FakeHostOptions = {}): FakeHost {
  const versions = options.versions ?? [1];
  const name = options.name ?? "fake";
  const keys = options.keys ?? { chords: ["k", "p"], bare: ["?", "g"], leaders: ["g"], within: 900 };
  let path = options.path ?? "/";
  let here: string | undefined;
  let chromeLayout: V1.ChromeMode = "standard";
  let conversation: Omit<V1.Conversation, "type"> | undefined;
  const conversations = options.conversations ?? true;
  let theme: V1.Theme = { scheme: options.scheme ?? "light", vars: { ...plausible(options.scheme ?? "light"), ...options.vars } };
  let refs: FindRefs | false = options.refs ?? (() => []);

  const connects: Connect[] = [];
  const sent: V1.PageMessage[] = [];
  // What the page has sent that no next() has been given yet, and the
  // next()s still waiting.
  const unread: V1.PageMessage[] = [];
  const waiting: { type: string; give: (m: V1.PageMessage) => void }[] = [];
  let port: MessagePort | undefined;

  const post = (m: unknown) => {
    if (!port) throw new Error("No page has connected to the fake host: connect({ host: host.window }) first.");
    port.postMessage(m);
  };
  const say = (m: V1.HostMessage) => post(m);

  const heard = (m: unknown) => {
    if (!V1.isPageMessage(m)) return; // as ws does with what it doesn't know
    sent.push(m);
    // As ws: a page of the plugin's is gone to, and the page told.
    const at = `/x/${name}`;
    if (m.type === "ws:go" && (m.path === at || m.path.startsWith(`${at}/`) || m.path.startsWith(`${at}?`))) {
      path = m.path.slice(at.length) || "/";
      if (!path.startsWith("/")) path = `/${path}`;
      say({ type: "ws:navigate", path });
    }
    if (m.type === "ws:here") here = m.name;
    if (m.type === "ws:chrome-layout") chromeLayout = m.mode;
    if (m.type === "ws:conversation") {
      const { type: _, ...said } = m;
      conversation = said;
    }
    // As ws: each text's refs, in the texts' order.
    if (m.type === "ws:refs" && refs) say({ type: "ws:refs-found", id: m.id, found: m.texts.map(refs) });
    const i = waiting.findIndex((w) => w.type === m.type);
    if (i < 0) unread.push(m);
    else waiting.splice(i, 1)[0]!.give(m);
  };

  const window: FakeWindow = {
    postMessage(message, _targetOrigin, transfer) {
      const theirs = transfer?.[0] as MessagePort | undefined;
      // As ws: a ws:connect, with a port, and nothing else.
      if (!isConnect(message) || !theirs) return;
      connects.push(message);
      if (options.silent) return;
      // Each load of the frame connects again, and the old port is dropped.
      port?.close();
      port = theirs;
      // In Node an open port keeps the process running: a test that forgot
      // to close shouldn't hang for it.
      (port as { unref?: () => void }).unref?.();

      const version = chooseVersion(message.versions, versions);
      if (version === undefined) {
        const no: Refuse = { type: "ws:refuse", versions, message: refusal(name, message.versions, versions) };
        say(no);
        return;
      }
      port.onmessage = (e: MessageEvent) => heard(e.data);
      // The fake speaks protocol 1's messages, whichever version it's told
      // to say it chose.
      say({
        type: "ws:welcome",
        version: version as 1,
        ws: options.ws ?? "0.0.0-fake",
        plugin: { name, at: `/x/${name}`, base: `/plugin-frame/${name}`, api: `/plugins/${name}` },
        path,
        theme,
        keys,
        ...(refs ? { refs: true } : {}),
        ...(conversations ? { conversations: true } : {}),
      });
    },
  };

  return {
    window,
    connects,
    sent,
    get path() {
      return path;
    },
    get here() {
      return here;
    },
    get chromeLayout() {
      return chromeLayout;
    },
    get conversation() {
      return conversation;
    },
    next(type, { timeout = 1000 } = {}) {
      type Wanted = Extract<V1.PageMessage, { type: typeof type }>;
      const i = unread.findIndex((m) => m.type === type);
      if (i >= 0) return Promise.resolve(unread.splice(i, 1)[0] as Wanted);
      return new Promise<Wanted>((resolve, reject) => {
        const wait = {
          type,
          give: (m: V1.PageMessage) => {
            clearTimeout(timer);
            resolve(m as Wanted);
          },
        };
        const timer = setTimeout(() => {
          waiting.splice(waiting.indexOf(wait), 1);
          reject(new Error(`The page sent no ${type} within ${timeout}ms.`));
        }, timeout);
        waiting.push(wait);
      });
    },
    navigate(to) {
      path = to;
      say({ type: "ws:navigate", path: to });
    },
    theme(change = {}) {
      const scheme = change.scheme ?? theme.scheme;
      const base = scheme === theme.scheme ? theme.vars : plausible(scheme);
      theme = { scheme, vars: { ...base, ...change.vars } };
      say({ type: "ws:theme", ...theme });
    },
    changed() {
      say({ type: "ws:changed" });
    },
    refsChanged(find) {
      if (find) refs = find;
      say({ type: "ws:refs-changed" });
    },
    outside() {
      say({ type: "ws:outside" });
    },
    conversationState({ open, as, working = false }) {
      say(as === undefined ? { type: "ws:conversation-state", open, working } : { type: "ws:conversation-state", open, as, working });
    },
    send: post,
    close() {
      port?.close();
      port = undefined;
    },
  };
}
