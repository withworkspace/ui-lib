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
| `ws.path` | Where in the plugin ws's address is now: `/browse/PROJ-1?tab=links`. It follows `onNavigate` and `setPath`. |
| `ws.name` | The plugin's name |
| `ws.base` | The path the frame's own address is under: `/plugin-frame/jira`. A router's basename. |
| `ws.api(path)` | A path in the plugin's own HTTP, as a URL to fetch: `ws.api("/issues")` is `/plugins/jira/issues` |
| `ws.theme` | `{ scheme, vars }`: `light` or `dark`, and each token's value. It's applied already. |
| `ws.version` | The frame protocol version the handshake chose |
| `ws.onNavigate(fn)` | ws's address moved within the plugin without the app saying so: the sidebar, a link in ws, back and forward. `fn` is given the path, and the app goes there, replacing its own history entry. |
| `ws.onChanged(fn)` | The plugin said what the app shows is stale (`p.Changed()` in the Go framework) |
| `ws.onTheme(fn)` | The theme changed. It's applied before `fn` runs, so this is only for an app that draws with the values itself. |
| `ws.setPath(path)` | The app moved to this path in the plugin: ws's address follows. Saying where ws's address already is sends nothing. |
| `ws.setTitle(title)` | The page's title, for the tab |
| `ws.open(path)` | Go to a page of ws's own: `ws.open("/missions/token-cache")` |
| `ws.close()` | Stop listening and close the port: for tests and hot reload |

Each `on…` returns a function that stops it.

### What it does to the page

Three things, and nothing more:

- **The theme.** ws's shell has the theme's tokens in a `<style>` before the app loads, as `--ws-bg`, `--ws-fg`, `--ws-accent` and [the rest](PROTOCOL.md#the-tokens). When the theme changes in ws, the client sets the new values on `<html>`, so CSS that uses `var(--ws-…)` follows by itself.
- **Keys.** The keys ws owns (the palette on ⌘K, say) are passed on to ws when they're pressed in the frame. Which keys those are comes from ws in the handshake, not from this package.
- **Links to ws.** A click on `<a data-ws="/missions/token-cache">` goes there in ws, as `ws.open` does.

### Routing

The client doesn't route. An app keeps ws's address in step with its own in two lines: it says when it moves, and it moves when it's told.

```ts
function go(path: string) {
  render(path);
  ws.setPath(path);
}
ws.onNavigate((path) => render(path));
render(ws.path);
```

With a router that uses the frame's history, `ws.base` is its basename. With React Router:

```tsx
const router = createBrowserRouter(routes, { basename: ws.base });
ws.onNavigate((path) => router.navigate(path, { replace: true }));
createRoot(ws.root).render(<RouterProvider router={router} />);

// In the root route's component:
const { pathname, search } = useLocation();
useEffect(() => ws.setPath(pathname + search), [pathname, search]);
```

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

await host.next("ws:title");         // the next ws:title from the page
host.sent;                           // everything the page has sent
host.connects;                       // each ws:connect, with its versions

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

A release is a `v<version>` tag, which `.github/workflows/release.yml` publishes to npm by trusted publishing: npm trusts that workflow in this repo, and no token is stored anywhere.

1. Set the version in `package.json` and `src/version.ts` (a test checks they agree), and merge it.
2. Tag that commit `v<version>` and push the tag. A version with a hyphen (`v0.2.0-rc.1`) is published as `next`, not `latest`.
