# @withworkspace/ui-lib

The page's side of a ws plugin's UI.

A plugin's UI is one client-side app, which ws shows in a frame. ws serves the page the app runs in, with its theme already there and an empty `<div id="root">`, and the app and ws talk over one `MessagePort`. How they talk is the frame protocol: [`PROTOCOL.md`](PROTOCOL.md).

This package is three things:

| Import | What it is |
|---|---|
| `@withworkspace/ui-lib` | `connect()`, which does the handshake and gives the app a client over the port |
| `@withworkspace/ui-lib/protocol` | The protocol's types, constants and guards. No DOM, and nothing runs when it's imported. ws web types its side from this. |
| `@withworkspace/ui-lib/testing` | `fakeHost()`: ws, without ws, to test an app against |

It's ESM only, has no dependencies, and comes with its types.

```sh
npm install @withworkspace/ui-lib
```

## The client

```ts
import { connect } from "@withworkspace/ui-lib";

const ws = await connect();

ws.root.textContent = `Hello from ${ws.path}`;
ws.setTitle("Hello");

const issues = await fetch(ws.api("/api/issues")).then((r) => r.json());

ws.onChanged(() => refetch());
```

`connect()` shakes hands with ws and resolves with the client. It takes `{ host, document, timeout }`, each optional:

- **`host`** is what to send `ws:connect` to, in place of `window.parent`. Tests give it a fake host's window.
- **`document`** is the document to wire, the page's own by default. Where there's none (in Node), nothing is wired.
- **`timeout`** is how long to wait for ws's answer, in milliseconds: 5000 by default.

What it's given back:

| | |
|---|---|
| `ws.root` | The shell's `<div id="root">`, to render into |
| `ws.path` | Where in the plugin ws's address is now: `/browse/PROJ-1?tab=links`. It changes only when ws says so (`onNavigate`). |
| `ws.name` | The plugin's name |
| `ws.href(path)` | A path in the plugin as ws's address, for a link: `ws.href("/browse/PROJ-2")` is `/x/jira/browse/PROJ-2` |
| `ws.api(path)` | A path in the plugin's own HTTP, as a URL to fetch: `ws.api("/issues")` is `/plugins/jira/issues` |
| `ws.theme` | `{ scheme, vars }`: `light` or `dark`, and each token's value. It's applied already. |
| `ws.version` | The frame protocol version the handshake chose |
| `ws.onNavigate(fn)` | ws's address moved within the plugin: a link clicked in the app, a `go`, the sidebar, back and forward. `fn` is given the path, and the app shows it. |
| `ws.onChanged(fn)` | The plugin said what the app shows is stale (`p.Changed()` in the Go framework) |
| `ws.onTheme(fn)` | The theme changed. It's applied before `fn` runs, so this is only for an app that draws with the values itself. |
| `ws.markRefs(element)` | Draw ws's names in an element's words: `PROJ-12`, a file, a mission, each a link to where it goes ([Refs](#refs)) |
| `ws.findRefs(texts)` | Ask ws which of its names are in some runs of text, to draw them yourself. It resolves with the refs in each. |
| `ws.onRefsChanged(fn)` | What there is to name changed: what `findRefs` found may be different now |
| `ws.dismissOutside(elements, fn)` | A press landed anywhere but in these elements, in the page or in ws: what closes a menu or a dialog ([Menus and dialogs](#menus-and-dialogs)) |
| `ws.onOutside(fn)` | A press landed in ws, outside the frame: on the sidebar, say |
| `ws.go(path, { replace })` | Ask ws to go to this path in the plugin: `ws.go("/browse/PROJ-2")`. ws adds it to its history (or, with `replace`, puts it in place of the entry it's on) and `onNavigate` follows. |
| `ws.setTitle(title)` | The page's title, for the tab |
| `ws.open(address)` | Ask ws to go to an address of its own: `ws.open("/missions/token-cache")` |
| `ws.close()` | Stop listening and close the port: for tests and hot reload |

Each `on…` returns a function that stops it.

### Asking the plugin

`ws.api(path)` is a URL to fetch, and what comes back is whatever the plugin sends. A plugin written with the [Go framework](https://github.com/withworkspace/plugin) can say what each of its endpoints takes and answers (`plugin.Get`, `plugin.Post`…), and `go tool apigen` writes that for the app as `Api`, in `ui/src/api.gen.ts`. `endpoints` asks through it:

```ts
import { EndpointError, endpoints } from "@withworkspace/ui-lib";
import type { Api } from "./api.gen";

const plugin = endpoints<Api>(ws);

const issue = await plugin.get("/api/issues/{key}", { params: { key: "PROJ-1" } });
await plugin.post("/api/issues/{key}/comment", { params: { key: issue.key }, body: { text: "On it" } });
const open = await plugin.get("/api/issues", { query: { open: true } });
```

A path is written as the plugin declared it, and what comes back is the type the plugin answers with. A path that isn't one of the plugin's, a value of the path left out, a body of the wrong shape, a name its query hasn't: none of them compile. So when the plugin's Go changes, `go tool apigen` then `tsc` says what in the app has to follow.

| | |
|---|---|
| `plugin.get`, `post`, `put`, `patch`, `delete` | Ask an endpoint of that method. Each resolves with what it answers: nothing, for one that answers nothing. |
| `params` | The values of the path, each put in it as an address takes it: `{ key: "PROJ-1" }` for `/api/issues/{key}`. It's asked for only where the path has some. |
| `body` | What's sent, as JSON. It's asked for only where the endpoint takes one. |
| `query` | What goes after the `?`, by the names and types the plugin declared for it (`plugin.Query`). A value that's `undefined` or `null` isn't sent, and a list is sent once for each. It's taken only where the endpoint has one, and it can be left out where every name in it can be. |
| `signal` | An `AbortSignal` that stops the asking |

An endpoint that couldn't answer rejects with an `EndpointError`: its `message` is what the plugin said, and `status` how it said it (404 for what isn't there, 400 for a body it couldn't read, 500 unless the plugin says otherwise).

```ts
try {
  await plugin.get("/api/issues/{key}", { params: { key } });
} catch (err) {
  if (err instanceof EndpointError && err.status === 404) return none();
  throw err;
}
```

In a test, give it what to fetch with: `endpoints<Api>(ws, { fetch })`. Without one it uses the page's `fetch` as it is when it asks, so a test that stubs the global works too.

### What it does to the page

Three things, and nothing more unless it's asked (`markRefs` changes the element it's given):

- **The theme.** ws's shell has the theme's tokens in a `<style>` before the app loads, as `--ws-bg`, `--ws-fg`, `--ws-accent` and [the rest](PROTOCOL.md#the-tokens). When the theme changes in ws, the client sets the new values on `<html>`, so CSS that uses `var(--ws-…)` follows by itself.
- **Keys.** The keys ws owns (the palette on ⌘K, say) are passed on to ws when they're pressed in the frame. Which keys those are comes from ws in the handshake, not from this package.
- **Links.** A link clicked in the app is ws's to follow, so the frame never adds to history: a link to `ws.href(…)` (or a relative one) moves the app, by way of ws, and one to `/missions/token-cache` goes to that page of ws's. A click with a key held or another button, a `target`, or a `download` is left to the browser, and a link elsewhere on the web opens in a tab of its own. [`PROTOCOL.md`](PROTOCOL.md#history) has the whole of it.

### Routing

ws keeps the history. The app renders `ws.path`, renders again when it's told to, and moves by asking: a link to `ws.href(…)`, or `ws.go(…)`. It doesn't move first and tell ws after.

```ts
ws.onNavigate((path) => render(path));
render(ws.path);

// A link: a click is ws's, and ⌘-click opens it in a tab of its own.
`<a href="${ws.href("/browse/PROJ-2")}">PROJ-2</a>`;

// After saving, say. replace, for a redirect or a filter typed into.
ws.go("/browse/PROJ-3");
ws.go("/board?q=cache", { replace: true });
```

A router of its own, if the app has one, takes the path from the client and not from `location`: its memory mode, fed by `onNavigate`. With Preact, which we suggest for a plugin's UI:

```tsx
function usePath(ws: Client): string {
  const [path, setPath] = useState(ws.path);
  useEffect(() => ws.onNavigate(setPath), [ws]);
  return path;
}
```

### Refs

ws draws the names in what it shows as somewhere to go: a file (`demo/main.go:12`), a pull request (`demo#12`), a mission, a plugin's thing by the name its plugin registered (`PROJ-12`). An app's own text can have them too. Which words are names is ws's to say, since only ws knows what there is to name: the app asks, over the port, and draws what it's told.

For words the app owns outright, such as a description's HTML:

```ts
description.innerHTML = issue.descriptionHtml;
const stop = ws.markRefs(description);
```

Each name becomes a link where it stands (`<a class="ws-ref">`, which ws's shell styles as a ref looks in ws), and a click goes there, as with any link. Words in a link, a heading or a block of code are left, and inline code is a name only when all of it is one. The marks follow what there is to name: a mission that begins later is marked when it does. After putting other words in the element, mark it again; `stop()` makes the names words again.

`markRefs` changes the DOM under the element, so it isn't for what a framework renders and will render again. There, ask, and render the links yourself:

```tsx
function Words({ ws, text }: { ws: Client; text: string }) {
  const [found, setFound] = useState<FoundRef[]>([]);
  useEffect(() => {
    let on = true;
    const ask = () => void ws.findRefs([text]).then(([refs]) => on && setFound(refs ?? []));
    ask();
    const stop = ws.onRefsChanged(ask);
    return () => ((on = false), stop());
  }, [ws, text]);
  const out = [];
  let at = 0;
  for (const f of found) {
    out.push(text.slice(at, f.from));
    out.push(
      <a class="ws-ref" href={f.href} data-ws-ref={f.ref} data-ws-kind={f.kind} data-ws-shape={f.shape} style={f.accent && { "--ws-ref-accent": f.accent }}>
        {text.slice(f.from, f.to)}
      </a>,
    );
    at = f.to;
  }
  return <>{[...out, text.slice(at)]}</>;
}
```

Askings made together go to ws as one message, so a list whose rows each ask costs one. In a ws from before it found names for a page, nothing is found, and the words stay words. [`PROTOCOL.md`](PROTOCOL.md#refs) has what a ref is given as.

### Menus and dialogs

The frame is a window of its own, and whoever's looking shouldn't be able to tell.

**A press elsewhere.** A menu closes when something else is pressed, and a press on ws's sidebar never reaches the page. `dismissOutside` hears both: a press in the page outside the elements it's given, and a press in ws.

```ts
const stop = ws.dismissOutside([button, menu], close);
```

Give it the button that opens the menu as well as the menu, or a press on the button closes it and the click that follows opens it again. In a component:

```tsx
useEffect(() => (open ? ws.dismissOutside([button.current!, menu.current!], () => setOpen(false)) : undefined), [ws, open]);
```

`ws.onOutside(fn)` is ws's presses alone, for an app that already has its own way of hearing the page's.

**A dialog's backdrop.** A backdrop in a frame can only dim the frame. Draw it with the shell's class, and ws dims what's beside the frame for as long as it's in the document, in the same colour, so the two read as one:

```tsx
<div class="ws-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
  <div role="dialog" aria-modal="true">…</div>
</div>
```

The class makes it cover the frame, in ws's scrim, fading in as ws's own does. Where the dialog sits in it is the app's to style. There's nothing to call, and nothing of this package's in it: ws watches the page for the class, so both halves come and go in the same frame. A press on ws's dimmed side comes as any press in ws does, so `dismissOutside(dialog, close)` closes on either half. ws's keys and back still work while it's dimmed: it isn't a lock. [`PROTOCOL.md`](PROTOCOL.md#the-frames-edge) has the rest.

### What's open beyond the address

ws's Find (⌘K) starts from what the page is of: what can be done to it, and what's linked to it. For a page of a thing's own, ws knows that from the address already, by where the thing's kind said one opens (`/issue/{ref}`), and there's nothing to do.

What the address doesn't say, the app does: an issue open in a panel over the board, say. `pushHere` takes one of ws's names, and returns what takes it off:

```tsx
useEffect(() => (issue ? ws.pushHere(issue.key) : undefined), [ws, issue?.key]);
```

They stack: a panel, then a dialog over it, and the latest still pushed is the one. They can be taken off in any order, and once all are, ws goes back to the address. ws forgets them all when the page goes, so a page that's left never needs to.

### The chrome's layout

A canvas or a board is better the wider it is. ws folds its sidebar to a rail on its own such pages, and an app asks for the same with `setChromeLayout`:

```tsx
useEffect(() => {
  ws.setChromeLayout("expanded"); // while this screen is up
  return () => ws.setChromeLayout("standard");
}, [ws]);
```

`"expanded"` folds the sidebar to a rail, which opens over the page on hover, as on ws's own pages. `"standard"` is ws's chrome as anywhere else, where a page starts. The latest said is the one, and ws goes back to standard when the page goes.

### Conversations about the page

ws holds conversations about the page in its own chrome: an ask bar at the page's foot, the card it opens, a pane docked beside the frame, a popover over its corner. The page says how they may be had, what the person's holding, and what the agent should know:

```tsx
useEffect(() => {
  ws.conversation.set({
    ask: true,                                 // ws's ask bar at the foot
    allow: ["card", "docked", "popover"],      // the forms it may take
    placeholder: "Ask about this sketch",
    holding: selection.length ? { label: `${selection.length} selected`, text: describe(selection) } : undefined,
    context: describe(scene),                  // for the agent, not the person
  });
}, [ws, selection, scene]);
```

Each `set()` says some of it: a field given takes the place of what it was, and one given as `undefined` goes. ws is told only when something changed, and forgets it all when the page goes.

`context` is standing context: say it as it is, as often as it changes. ws gives it to the agent with a message only when it's changed since that conversation's agent last had it, and folds it under the message for the person to look at.

The person moves the conversation between the forms, and ws remembers their choice for the plugin. The page can open it too, with a message said as the person's:

```ts
ws.conversation.open({ message: "Tidy the layout", context: "Selected: `plan`" });
ws.conversation.open({ as: "docked" });   // just open it, docked
ws.conversation.close();
ws.conversation.onChange(({ open, as, working }) => …);
```

In a ws from before it held conversations, `ws.conversation.available` is `false` and the rest does nothing.

### When it can't connect

`connect()` rejects with one of two errors, and an app shows either in the page:

```ts
import { connect, NoHostError, ProtocolError } from "@withworkspace/ui-lib";

try {
  const ws = await connect();
  start(ws);
} catch (err) {
  if (err instanceof ProtocolError || err instanceof NoHostError) {
    document.getElementById("root")!.textContent = err.message;
  } else throw err;
}
```

- **`ProtocolError`**: the page and ws speak no frame protocol version in common. `err.page` is the versions the page speaks, `err.host` is ws's, and `err.message` says which to update: "jira speaks frame protocol 1, and this ws speaks 2. Update the plugin." It's logged with `console.error` too.
- **`NoHostError`**: nothing answered. The page isn't in ws's frame (it was opened alone, or in some other page), or it's in a ws from before the frame protocol.

## Testing an app

`fakeHost()` answers the handshake as ws does and speaks the same protocol, from the same types, with every token filled in with a plausible value. It runs on Node's own `MessageChannel`, so a test that doesn't touch the DOM needs no DOM.

```ts
import { connect } from "@withworkspace/ui-lib";
import { fakeHost } from "@withworkspace/ui-lib/testing";

const host = fakeHost({ path: "/browse/PROJ-1", scheme: "dark" });
const ws = await connect({ host: host.window, document });

host.navigate("/board");             // ws:navigate
host.theme({ scheme: "light" });     // ws:theme, with every token
host.changed();                      // ws:changed
host.refsChanged();                  // ws:refs-changed
host.outside();                      // ws:outside: a press in ws, outside the frame
host.conversationState({ open: true, as: "card", working: true });   // ws:conversation-state
host.conversation;                   // what the page last said in ws:conversation

await host.next("ws:title");         // the next ws:title from the page
host.sent;                           // everything the page has sent
host.connects;                       // each ws:connect, with its versions

ws.go("/board");                     // ws:go, and the host says ws:navigate back, as ws does
host.path;                           // "/board"

ws.close();
host.close();
```

`fakeHost` takes:

| Option | What it is | By default |
|---|---|---|
| `path` | Where in the plugin ws's address is | `/` |
| `scheme` | `light` or `dark` | `light` |
| `vars` | Values in place of the plausible ones: `{ "--ws-accent": "#f0f" }` | |
| `name` | The plugin's name | `fake` |
| `keys` | The keys ws owns | ws's own |
| `versions` | The frame protocol versions the host says it speaks | `[1]` |
| `silent` | Never answer | `false` |
| `refs` | What the host finds in a run of text, as ws finds its names. `false` is a ws from before it could be asked. | Nothing |
| `conversations` | `false` is a ws from before it held conversations about pages | `true` |

`named()` makes a finder from some names, each with where it goes. It finds them wherever they're whole words:

```ts
import { fakeHost, named } from "@withworkspace/ui-lib/testing";

const host = fakeHost({ refs: named({ "PROJ-12": "/x/jira/browse/PROJ-12" }) });

host.refsChanged(named({ "PROJ-13": "/x/jira/browse/PROJ-13" }));   // what it finds from now on
```

The two ways a handshake fails:

```ts
fakeHost({ versions: [2] });   // connect() rejects with a ProtocolError
fakeHost({ silent: true });    // connect() rejects with a NoHostError, after its timeout
```

`host.next(type)` resolves with the next message of that type that no earlier `next` was given, whether it arrived before the call or comes after it. It rejects if none comes within a second, or the `{ timeout }` it's given, so a test fails with a sentence and doesn't hang.

`host.send(message)` puts anything at all on the port: a message from a later release, say, to show the page drops it.

## Working on it

```sh
npm install
npm test             # the tests, against the fake host
npm run typecheck
npm run build        # into dist/
```

The tests run on the fake host, and under [happy-dom](https://github.com/capricorn86/happy-dom) where they need a page.

A change to the protocol is made in `PROTOCOL.md`, `src/protocol.ts` and `src/v1.ts` together. Within a version it only adds.

## Releasing

A release is a `v<version>` tag, which `.github/workflows/release.yml` stages on npm, and a maintainer then approves. The workflow stages by trusted publishing: npm trusts that workflow in this repo, and no token is stored anywhere. npm lets it stage a version and not publish one, so nothing is public until someone with 2FA approves it.

The version is the tag's: `v0.4.0` is 0.4.0. `package.json` and `src/version.ts` say 0.0.0 in the repo, and the workflow writes the tag's version into both before it tests and builds, so no change sets a version.

1. Tag the commit on `main` `v<version>` and push the tag. The workflow stages the version with `npm stage publish`. A version with a hyphen (`v0.2.0-rc.1`) is staged as `next`, not `latest`.
2. Approve the stage, which publishes it. The workflow's Publish step prints the stage's id, and `npm stage list @withworkspace/ui-lib` lists it too:

   ```sh
   npm stage approve <stage-id>
   ```

   npm asks for your 2FA. `npm stage` needs npm 11.15.0 or later: with an older one, `npx npm@11 stage approve <stage-id>`.

A staged version holds its number and its tag. To stage that version again, from another commit or under another tag, reject the first with `npm stage reject <stage-id>`.
