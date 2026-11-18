# The frame protocol

How a plugin's page and ws talk, in ws's web UI. Version 1. The package in this repo (`@withworkspace/ui-lib`) speaks it for a page; this is for ws's side, for a page that speaks it by hand, and for settling an argument.

This is what's built: where ws, the package and this differ, one of them has a bug.

It is not the plugin protocol, which is how ws and a plugin's process talk (JSON-RPC, the registration, the proxy): that's [`PROTOCOL.md` in the plugin framework](https://github.com/withworkspace/plugin/blob/main/PROTOCOL.md). The two have versions of their own.

The types for everything here are in [`src/protocol.ts`](src/protocol.ts) and [`src/v1.ts`](src/v1.ts), published as `@withworkspace/ui-lib/protocol`. ws web types its side from them.

## The shell

A plugin's UI is one client-side app. The plugin serves the app's bundle from its own HTTP and names it in its registration (`ui.script`, and `ui.style` if it has a stylesheet). It serves no HTML: ws serves the page the app runs in, which is the shell.

A view's address in ws is `/x/<name>/<rest>`. ws shows it as a frame whose own address is the same path under another prefix:

```
/x/jira/browse/PROJ-1?tab=links               the address, in ws
/plugin-frame/jira/browse/PROJ-1?tab=links    the frame: the shell
/plugins/jira/…                               the plugin's own HTTP: its bundle and its API
```

ws serves the shell for every path under `/plugin-frame/<name>/`, and doesn't ask the plugin which paths it has. So a link to somewhere deep in the app and a reload both load the app at that path. Opened as a page of its own, not in ws's frame, a shell's address sends the browser to the same path under `/x/<name>/`.

```html
<!doctype html>
<html lang="en" style="--accent-pick: #6e509c">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<script src="/theme.js"></script>
<title>Jira</title>
<style>/* ws's tokens, light and dark, as --ws-* */</style>
<link rel="stylesheet" href="/plugins/jira/ui/app.css?v=3f9c2a">
<script type="module" src="/plugins/jira/ui/app.js?v=3f9c2a"></script>
</head>
<body><div id="root"></div></body>
</html>
```

What a page can rely on:

- **`<div id="root">`** is there and empty. The app renders into it.
- **Every token of this version** ([below](#the-tokens)) is defined as `--ws-<name>` on `:root` before the app's stylesheet or script loads, for the theme ws is in. The first paint is in ws's colours, with nothing of the plugin's having run.
- **`<html>` has `data-theme`**, `light` or `dark`.
- **The stylesheet,** if the registration has one, is in the head, before the first paint.
- **The bundle is a module script.** It runs once the document is parsed, and can import its own chunks by paths relative to its URL.
- **There's no `<base>`.** The app reaches the plugin's HTTP by the path the welcome gives (`plugin.api`), not by relative URLs.
- **The page is ws's origin,** and its content security policy allows scripts, styles, fonts and connections from that origin only, and no inline script. Inline style is allowed. Images may also be `data:` or `https:`.

What it can't:

- **ws's own names for its tokens** (`--bg`, `--red`) are in the shell too, because the `--ws-*` names are defined from them. They aren't part of the protocol, and a page that uses them can break with any release of ws.
- **Anything else in the head,** and how the theme got there.

Where ws can't load the app (there's no such plugin, it needs setting up, it didn't start, or it registered no `ui`), the shell has a message from ws in `#root` and no bundle.

## Versions

- **The frame protocol has a version of its own**, a whole number starting at 1. It isn't ws's version, the package's, or the plugin protocol's.
- **Within a version, changes only add:** a new optional field, or a new message that the other side may drop. Removing something, changing what it means, or requiring what was optional makes a new version.
- **A page lists every version it speaks,** and ws picks the highest that both speak.
- **ws keeps answering old versions.** A page built for version 1 goes on working in a ws that has gone on to 2.
- **The handshake's own two messages, `ws:connect` and `ws:refuse`, hold across versions:** they're said before there's a version to say them in. A version may add fields to them and nothing else.

The package's list is `PROTOCOL_VERSIONS`, fixed in each release: `[1]` in 0.1.0 and 0.2.0.

Version 1 broke that rule once, in the ws release after 0.4.0 and this package's 0.2.0, while only withworkspace's own plugins were built on it: ws took over the history, `ws:go` replaced `ws:path`, `ws:open` and `data-ws` links, and the welcome's `plugin` gained `at`. A page built on 0.1.0 still connects to a later ws, but its moves within the app aren't followed. Rebuilt on 0.2.0, it is.

## The handshake

The page makes a `MessageChannel`, and sends `ws:connect` to its parent window with one of the channel's ports. It keeps the other. Everything after that, in both directions, is on the port.

```js
// page → ws
const { port1, port2 } = new MessageChannel();
window.parent.postMessage(
  { type: "ws:connect", versions: [1], client: "@withworkspace/ui-lib@0.1.0" },
  location.origin,
  [port2],
);
```

| Field | What it is |
|---|---|
| `versions` | The frame protocol versions the page speaks |
| `client` | Optional. Who's speaking, for ws's console and logs. ws decides nothing by it. |

- ws takes a `ws:connect` only from the window of its plugin frame, from its own origin, and only with a port. It ignores any other.
- Each load of the frame connects again, with a new port, and ws drops the one before.
- ws is listening before the frame exists, so a page may connect as soon as it runs.

ws answers on the port, with a welcome or a refusal.

```json
{
  "type": "ws:welcome",
  "version": 1,
  "ws": "0.43.0",
  "plugin": { "name": "jira", "at": "/x/jira", "base": "/plugin-frame/jira", "api": "/plugins/jira" },
  "path": "/browse/PROJ-1?tab=links",
  "theme": { "scheme": "dark", "vars": { "--ws-bg": "#16161a", "--ws-accent": "#a08ad0" } },
  "keys": { "chords": ["k", "p"], "bare": ["?", "g"], "leaders": ["g"], "within": 900 }
}
```

| Field | What it is |
|---|---|
| `version` | The frame protocol version ws chose. Everything after this is in that version. |
| `ws` | ws's own version, for logs and error messages. A page decides nothing by it: the protocol version says what it can rely on. |
| `plugin.name` | The plugin's name |
| `plugin.at` | The path the plugin's pages are under in ws's address: `/x/jira`. A link in the app is to a page under it. |
| `plugin.base` | The path the frame's own address is under: `/plugin-frame/jira`. A relative link resolves against the frame's address, and the page reads one under `base` as the page under `at` of the same path. |
| `plugin.api` | The path the plugin's own HTTP is under: `/plugins/jira`. The plugin's `/issues` is `/plugins/jira/issues`. |
| `path` | Where in the plugin ws's address is, without a base, with its query: `/browse/PROJ-1?tab=links` |
| `theme.scheme` | `light` or `dark` |
| `theme.vars` | Each token's value now, by its `--ws-*` name: every token of this version ([below](#the-tokens)), and any more ws has |
| `keys` | The keys ws owns, which the page passes on ([below](#keys)) |

What ws doesn't send: what a `ws:go` does (that's ws's to decide when it gets one), its routes, its API, or who's signed in.

```json
{
  "type": "ws:refuse",
  "versions": [1],
  "message": "jira speaks frame protocol 2, and this ws speaks 1. Update ws."
}
```

| Field | What it is |
|---|---|
| `versions` | The frame protocol versions ws speaks |
| `message` | A sentence for a person, which says which side is behind |

### When they don't meet

- **No version in common.** ws answers `ws:refuse`. Its message ends "Update ws" when the page's highest version is above ws's, and "Update the plugin" when it isn't. ws shows the message itself too, above the frame. The package's `connect()` rejects with a `ProtocolError`, which has the page's versions (`page`), ws's (`host`) and the message, and logs it with `console.error`.
- **No answer.** A ws from before frame protocol 1 drops `ws:connect` as a message it doesn't know, and a page that isn't in ws's frame has nobody to answer it. The package's `connect()` rejects with a `NoHostError`: at once when the page has no parent window, and otherwise after 5 seconds, or the `timeout` it was given.
- **A message neither side knows,** or one that isn't as its version has it, is dropped. That's what lets a version gain messages.

## The messages

After the welcome. Each is `{ "type": "ws:…", … }` on the port.

| Message | From | Fields | What it's for |
|---|---|---|---|
| `ws:go` | page | `path`, `replace` | Go to this address of ws's: `/x/jira/browse/PROJ-2`, a page in the plugin, or `/missions/token-cache`, one of ws's own. ws decides what it does. `replace`, optional, puts it in place of ws's history entry rather than adding one: for a redirect, or a filter typed into. |
| `ws:title` | page | `title` | The page's title, for the tab and the frame's label. An empty title means the view's own. |
| `ws:key` | page | `key`, `meta`, `ctrl`, `shift`, `alt` | A key ws owns was pressed in the frame. ws acts as if it had been pressed in its own page. |
| `ws:navigate` | ws | `path` | ws's address moved within the plugin: after the page's own `ws:go`, or from the sidebar, a link in ws, back and forward. The app shows that path. It's the only way the app's path changes. |
| `ws:theme` | ws | `scheme`, `vars` | The theme changed: as the welcome's `theme` |
| `ws:changed` | ws | | The plugin said `view/changed`: what the app shows may be stale |

A `path` in the plugin (`ws:navigate`'s, the welcome's) starts with `/`, has no base, and keeps its query. A `ws:go`'s is ws's address, with its query.

ws never loads the frame again to move it: every page is an app that routes itself. An app that wants to load again on `ws:changed` does it itself.

## History

ws keeps the history, and the frame keeps none. Every move, whether it starts in the app or in ws, is one entry in ws's history, so back and forward are ws's alone and come to the app as `ws:navigate`.

- **The page adds nothing to the frame's history.** It doesn't push state, and doesn't let a click on a link move the frame. On `ws:navigate` it replaces the frame's address with the same path under `base`, so a relative link resolves against where the app is, and a reload starts there.
- **A link clicked in the page is `ws:go`,** with its address resolved against the frame's and, if it's under `base`, read as the same path under `at`. So an app's links are ws's addresses (`/x/jira/browse/PROJ-2`): ⌘-click, a middle click and copying the link all give the page in ws.
- **What the browser does better is left to it:** a click with ⌘, Ctrl, Shift or Alt held, another button, a `target` other than `_self`, a `download`, a scheme that isn't http(s), and a click the app's own handler already prevented.
- **Somewhere else on the web, and the plugin's own HTTP** (a path under `api`: an export, say), open in a tab of their own, never in the frame.
- **A place in the page** (`#notes`, in the page as it is) is scrolled to, with no history.
- **A `ws:go` to where ws already is** replaces the entry and doesn't add one, as a link to the page you're on does in a browser.

## Keys

Some keys are ws's wherever they're pressed: the palette, the shortcuts' help, going somewhere. A frame has its own keyboard focus, so the page passes them on. Which keys they are is ws's to say, in the welcome, and a new shortcut in ws reaches every page without the page changing.

```json
{ "chords": ["k", "p"], "bare": ["?", "g"], "leaders": ["g"], "within": 900 }
```

- **`chords`** are taken with ⌘ or Ctrl held, always, even while typing.
- **`bare`** are taken with no ⌘, Ctrl or Alt held, and only when nothing's being typed in: not in an input, a textarea, a select or anything editable.
- **`leaders`** are bare keys after which the next bare letter, `a` to `z`, within `within` milliseconds, is ws's too: `g` then `m`.

Each is compared with the event's `key`. For a key that's ws's, the page stops the default action and sends `ws:key` with the `key` and which of ⌘ (`meta`), Ctrl, Shift and Alt were held.

## The theme

The shell has the theme before anything of the plugin's runs. The welcome gives it again as values, and `ws:theme` gives it each time it changes in ws: the theme switched, or the accent changed.

For each, the page sets on its `<html>`:

- `data-theme` and the `color-scheme` style, to the `scheme`;
- each of `vars`, as a custom property in its `style`.

Those are set over the shell's `<style>`, so CSS that uses `var(--ws-…)` follows without the app doing anything. The welcome's values are the ones the shell already had.

### The tokens

Version 1 promises these, each as `--ws-<name>`:

- **Colour:** `bg`, `panel`, `raised`, `fg`, `dim`, `faint`, `line`, `line-strong`, `hover`, `well`, `code-bg`, `accent`, `accent-soft`, `accent-line`, `primary`, `primary-hover`, `on-primary`, `danger`, `warn`, `ok`
- **Type:** `font`, `mono`, `text-xs`, `text-sm`, `text-md`, `text-lg`, `text-xl`, `text-2xl`
- **Space, corners and depth:** `space-1`, `space-2`, `space-3`, `space-4`, `space-5`, `space-6`, `space-8`, `space-10`, `radius`, `radius-sm`, `radius-lg`, `shadow`

The list is `TOKENS` in `@withworkspace/ui-lib/protocol`. Their values are the running ws's, so they change when ws does, whichever release of the package the page was built with.

A token added later is still version 1, because it only adds: it's in `TOKENS` from the release of the package that adds it, and ws sends it once it's built on that release. A page that needs one that an older ws may not send gives its `var()` a fallback.
