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
- **A ref is styled,** in a ws that finds them: a link drawn as [a ref is](#refs) looks as a ref does in ws, with no styles of the app's.
- **A backdrop is styled, and ws dims beside it,** in a ws that does: an element of the class `ws-backdrop` covers the frame in ws's own scrim, and for as long as the page has one ws dims what's beside the frame ([A backdrop](#a-backdrop)).

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

The package's list is `PROTOCOL_VERSIONS`, fixed in each release: `[1]` in every release so far, 0.1.0 to 0.3.0.

Version 1 has gained since it began:

- [Refs](#refs) (`ws:refs`, `ws:refs-found`, `ws:refs-changed`, and the welcome's `refs`), in this package's 0.3.0 and the ws built on it.
- [The frame's edge](#the-frames-edge) (`ws:outside`, the shell's `.ws-backdrop`, and the token `scrim`), in the release after 0.3.0 and the ws built on it. The welcome doesn't say whether ws has them: in a ws from before, a page hears no `ws:outside`, and a backdrop dims the frame alone.

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
  "keys": { "chords": ["k", "p"], "bare": ["?", "g"], "leaders": ["g"], "within": 900 },
  "refs": true
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
| `refs` | Optional. `true` when ws finds its names in text: it answers `ws:refs` ([below](#refs)). A ws from before it did leaves it out, and a page there doesn't ask. |

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
| `ws:refs` | page | `id`, `texts` | Which of ws's names are in these runs of text? `id` is the page's number for the asking. ([Refs](#refs)) |
| `ws:refs-found` | ws | `id`, `found` | The answer to the `ws:refs` of that `id`: for each of its texts, in their order, the refs in it |
| `ws:refs-changed` | ws | | What there is to name changed: what a `ws:refs` found may be different now. ws says it only to a page that has asked. |
| `ws:outside` | ws | | A press landed in ws, outside the frame. ([A press outside](#a-press-outside)) |
| `ws:here` | page | `name` | What the page shows now that its address doesn't say: one of ws's names, or none. ([What's open](#whats-open)) |
| `ws:chrome-layout` | page | `mode` | How the page wants ws's chrome laid out: `expanded` (ws folds its sidebar to a rail) or `standard`. ([The chrome's layout](#the-chromes-layout)) |

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

## Refs

A ref is a name in some words for something ws can go to: a file (`demo/main.go:12`), a pull request (`demo#12`), a mission by its slug, a page, a conversation, an artifact, and a plugin's thing by a name its plugin registered (`PROJ-12`). ws draws them wherever it shows text, each as somewhere to go. A page draws them in its own text by asking ws which words are names.

Only ws can say. A name is one only when what it names is there (a file in its repo, a mission the workspace has, a prefix some plugin registered), and that changes while the page is open. So the page holds no grammar and no list: it sends text, and draws what comes back.

```json
{ "type": "ws:refs", "id": 7, "texts": ["See PROJ-12 for more", "demo is a repo"] }
```

```json
{
  "type": "ws:refs-found",
  "id": 7,
  "found": [
    [{ "from": 4, "to": 11, "ref": "…", "kind": "thing", "href": "/x/jira/browse/PROJ-12" }],
    [{ "from": 0, "to": 4, "ref": "…", "kind": "repo", "href": "/files/demo", "shape": "pill", "accent": "#6e509c" }]
  ]
}
```

`found` has a list for each of `texts`, in their order. Each list is the refs in that text, in the order they're in, none over another:

| Field | What it is |
|---|---|
| `from`, `to` | Where the name is in the text, as indices into the string (UTF-16 code units, as JavaScript counts): `text.slice(from, to)` is the name |
| `ref` | ws's own word for what's named. The page keeps it with what it draws, and says it back when it says something of the ref. It reads nothing in it: what's in it can change with any release of ws. |
| `kind` | What kind of thing: `file`, `dir`, `repo`, `pr`, `mission`, `page`, `talk`, `artifact`, or `thing` for a plugin's. More may come: a page draws a kind it doesn't know like any other. |
| `href` | Where it goes: an address of ws's (`/missions/token-cache`, `/x/jira/browse/PROJ-12`), or one outside (`https://…`) for a thing that opens nowhere in ws |
| `shape` | Optional. `pill` for one drawn as a pill. Without it, its words, marked. |
| `accent` | Optional. A CSS colour of its own: a repo's. |

- **ws answers every `ws:refs`,** in the order they came, once it says `refs` in the welcome. A text with no names has an empty list.
- **The answer is for now.** When what there is to name changes (a mission began, a plugin registered its names, a repo's files were read), ws says `ws:refs-changed`, and a page that drew refs asks again about what it shows. A file is found only once its repo's files are read, which ws starts when a text first names the repo: so a file's name is often words in the first answer and a ref after the `ws:refs-changed` that follows.
- **What isn't read for names** is the page's to decide. ws doesn't find them in its own headings, links' words or blocks of code, and takes inline code as a name only when all of it is one; the package's `markRefs` does the same.

### Drawing one

A ref is a link, so it's followed as any link in the page is ([History](#history)): a click is `ws:go`, or a tab of its own for an address outside. The shell styles one drawn like this, as a ref looks in ws:

```html
<a class="ws-ref" href="/x/jira/browse/PROJ-12" data-ws-ref="…" data-ws-kind="thing">PROJ-12</a>
<a class="ws-ref" href="/files/demo" data-ws-ref="…" data-ws-kind="repo" data-ws-shape="pill" style="--ws-ref-accent: #6e509c">demo</a>
```

| | |
|---|---|
| `class="ws-ref"` and `data-ws-ref` | The ref, with ws's word for it. Both are needed for the shell's styles. |
| `href` | The ref's `href` |
| `data-ws-kind` | Its `kind` |
| `data-ws-shape` | Its `shape`, if it has one |
| `--ws-ref-accent` | Its `accent`, if it has one |

The link's words are the name as it was written.

## The frame's edge

A frame is a window of its own, and two things stop at its edge that shouldn't seem to: a press, and a backdrop.

### A press outside

A page closes a menu when something else is pressed. A press in ws, on the sidebar say, never reaches the page's document, so ws says it:

```json
{ "type": "ws:outside" }
```

- **ws says it for every press in its own page** while the frame is there: the pointer going down (`pointerdown`), wherever in ws it lands and whatever it does there. It has no fields: what was pressed is ws's own business.
- **It's said to every page,** asked for or not. A page with nothing open does nothing with it.
- **A press in the frame isn't one.** The page has those itself.

The package's `dismissOutside` joins the two: it runs for a press in the page outside some elements, and for a press in ws.

### A backdrop

A dialog's backdrop dims the page behind it. In a frame it can only dim the frame, so ws dims what's beside the frame for as long as the page has one up, in the same colour, and the two read as one.

The page draws its backdrop as the shell's:

```html
<div class="ws-backdrop">
  <div role="dialog" aria-modal="true">…</div>
</div>
```

The shell styles `.ws-backdrop`: fixed, over the whole frame, in ws's own scrim (the token `scrim`), fading in as ws's does. Where the dialog sits in it, and what's over what (`z-index`), is the app's.

That's all of it: there's no message, and nothing for the page to call.

- **ws watches the page's document for an element of the class,** from when the page connects, and dims what's beside the frame while there's one: its sidebar, or on a narrow window the bar across the top. The class on an element that's there counts as an element that came with it.
- **Why ws looks, and isn't told.** The page is ws's origin, so ws sees the element in the same turn the app put it there, and both halves are drawn in the same frame, coming and going. A message on the port arrives a turn later, and ws's half would follow the app's by a frame every time.
- **While ws is dimmed, nothing in what it dimmed can be pressed or tabbed to.** A press there is a `ws:outside` like any other, and takes no focus from the frame: whether it closes the dialog is the page's to decide.
- **ws's half is there for as long as the element is.** Both fade in, and both are cut when they go: an app that fades its backdrop out keeps the element, and ws's half, until it's done.
- **It isn't a lock.** ws's keys still work, and back and forward still move.
- **ws ends it itself** when the page is gone: the frame loaded again, another page connected, or ws went somewhere else.

## What's open

ws's Find starts from what the page is of. ws reads that from the page's address, as the thing's kind said its pages are (`/issue/{ref}`): a page of a thing's own needs to say nothing. What the address doesn't say, the page does:

```json
{ "type": "ws:here", "name": "PROJ-12" }
```

- **`name` is one of ws's names,** as ws reads names anywhere: a plugin's thing (`PROJ-12`), a mission's slug, `demo#12`. Without it (`{ "type": "ws:here" }`), the page shows nothing beyond its address, and ws reads the address again.
- **The latest said is what's open.** The package keeps a stack, so a panel and then a dialog over it each push and pop their own, and it says only the top when it changes. ws keeps no stack: it takes what it's told.
- **ws forgets it when the page goes:** the frame loaded again, another page connected, or ws went somewhere outside the plugin. A move within the plugin (`ws:navigate`) isn't one: the page is still there, and what it said stands until it says otherwise, so a panel open over a list stays what's open while a filter changes the address.
- **A name ws can't read is as none:** ws goes by the address.

## The chrome's layout

Some pages are better the wider they are: a canvas, a board, an editor. ws folds its sidebar to a rail on its own such pages (a mission, a review), and the rail opens over the page on hover. A plugin's page asks for the same:

```json
{ "type": "ws:chrome-layout", "mode": "expanded" }
```

- **`mode` is `expanded` or `standard`.** `expanded`: the page takes the room ws's chrome can give up, which is the sidebar folded to a rail. `standard`: ws's chrome as anywhere else, which is where a page starts. A mode a ws doesn't know is dropped, as any message it doesn't know is.
- **The latest said is the one.** The package says it only when it changes.
- **It's the page's, not the path's.** A move within the plugin (`ws:navigate`) leaves it as it was: the page says when it changes, as a sketch closes back to a list.
- **ws goes back to standard when the page goes:** the frame loaded again, another page connected, or ws went somewhere outside the plugin.
- **It isn't a lock.** The rail is still there, and opens on hover, as on ws's own pages. On a window too narrow for a sidebar, there's nothing to fold.

## The theme

The shell has the theme before anything of the plugin's runs. The welcome gives it again as values, and `ws:theme` gives it each time it changes in ws: the theme switched, or the accent changed.

For each, the page sets on its `<html>`:

- `data-theme` and the `color-scheme` style, to the `scheme`;
- each of `vars`, as a custom property in its `style`.

Those are set over the shell's `<style>`, so CSS that uses `var(--ws-…)` follows without the app doing anything. The welcome's values are the ones the shell already had.

### The tokens

Version 1 promises these, each as `--ws-<name>`:

- **Colour:** `bg`, `panel`, `raised`, `fg`, `dim`, `faint`, `line`, `line-strong`, `hover`, `well`, `code-bg`, `accent`, `accent-soft`, `accent-line`, `primary`, `primary-hover`, `on-primary`, `danger`, `warn`, `ok`, `scrim`
- **Type:** `font`, `mono`, `text-xs`, `text-sm`, `text-md`, `text-lg`, `text-xl`, `text-2xl`
- **Space, corners and depth:** `space-1`, `space-2`, `space-3`, `space-4`, `space-5`, `space-6`, `space-8`, `space-10`, `radius`, `radius-sm`, `radius-lg`, `shadow`

The list is `TOKENS` in `@withworkspace/ui-lib/protocol`. Their values are the running ws's, so they change when ws does, whichever release of the package the page was built with.

A token added later is still version 1, because it only adds: it's in `TOKENS` from the release of the package that adds it, and ws sends it once it's built on that release. A page that needs one that an older ws may not send gives its `var()` a fallback.
