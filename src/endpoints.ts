// Asking the plugin: its endpoints, by what each takes and answers.
//
// A plugin written with the Go framework declares its endpoints with their
// types (plugin.Get, plugin.Post…), and `go tool apigen` writes them for
// the app as Api, in ui/src/api.gen.ts. endpoints<Api>(ws) asks through
// that: a path that isn't one of the plugin's, a body of the wrong shape,
// or an answer read as what it isn't, doesn't compile.

/** Each of a plugin's endpoints, by its method and path: what apigen writes as Api. */
export type EndpointMap = Record<string, EndpointShape>;

/** What one endpoint takes and answers. */
export interface EndpointShape {
  /** The values of its path: key, of /api/issues/{key}. */
  params?: Record<string, string>;
  /** What it's asked with after the path's ?: each name, and the type of its value. */
  query?: object;
  /** The body it's sent, as JSON. */
  in?: unknown;
  /** What it answers: void for nothing. */
  out: unknown;
}

/** The methods an endpoint is declared with. */
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** The paths of A's endpoints of one method: "/api/issues/{key}", of "GET /api/issues/{key}". */
export type PathOf<A, M extends Method> = keyof A extends infer K ? (K extends `${M} ${infer P}` ? P : never) : never;

/** The endpoint of A at a method and path. */
export type EndpointAt<A, M extends Method, P extends string> = A[Extract<keyof A, `${M} ${P}`>];

/** What an endpoint answers. */
export type Answer<E> = E extends { out: infer O } ? O : never;

/**
 * What an endpoint is asked with: its path's values, its query and its
 * body, where it has them, and for any, a signal that stops the asking.
 *
 * A query is what goes after the path's ?, by the names and types the
 * plugin declared (plugin.Query). A value left undefined, or null, isn't
 * sent, and a list is sent once for each. It can be left out where every
 * name in it can be.
 */
export type Asking<E> = (E extends { params: infer P } ? { params: P } : { params?: undefined }) &
  (E extends { query: infer Q } ? (Record<never, never> extends Q ? { query?: Q } : { query: Q }) : { query?: undefined }) &
  (E extends { in: infer I } ? { body: I } : { body?: undefined }) & {
    signal?: AbortSignal;
  };

// An endpoint with no path values and no body is asked with nothing: the
// second argument can be left out.
type Rest<E> = Record<never, never> extends Asking<E> ? [asking?: Asking<E>] : [asking: Asking<E>];

/**
 * EndpointError is an endpoint answering that it couldn't: its message is
 * what the plugin said (an error's text, in the Go framework), and status
 * is how it said it: 404 for what isn't there, 400 for a body it couldn't
 * read, 500 for anything else unless the plugin says.
 */
export class EndpointError extends Error {
  /** The HTTP status it answered with. */
  readonly status: number;
  /** The endpoint asked: "GET /api/issues/{key}". */
  readonly endpoint: string;

  constructor(message: string, status: number, endpoint: string) {
    super(message);
    this.name = "EndpointError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

/** Endpoints asks a plugin's endpoints: A is its Api. */
export interface Endpoints<A> {
  /** get reads: it resolves with what the endpoint answers, and rejects with an EndpointError if it couldn't. */
  get<P extends PathOf<A, "GET">>(path: P, ...asking: Rest<EndpointAt<A, "GET", P>>): Promise<Answer<EndpointAt<A, "GET", P>>>;
  /** post sends a body. */
  post<P extends PathOf<A, "POST">>(path: P, ...asking: Rest<EndpointAt<A, "POST", P>>): Promise<Answer<EndpointAt<A, "POST", P>>>;
  /** put sends a body to take the place of what's there. */
  put<P extends PathOf<A, "PUT">>(path: P, ...asking: Rest<EndpointAt<A, "PUT", P>>): Promise<Answer<EndpointAt<A, "PUT", P>>>;
  /** patch sends a change to part of something. */
  patch<P extends PathOf<A, "PATCH">>(path: P, ...asking: Rest<EndpointAt<A, "PATCH", P>>): Promise<Answer<EndpointAt<A, "PATCH", P>>>;
  /** delete removes. */
  delete<P extends PathOf<A, "DELETE">>(path: P, ...asking: Rest<EndpointAt<A, "DELETE", P>>): Promise<Answer<EndpointAt<A, "DELETE", P>>>;
}

export interface EndpointsOptions {
  /** What to fetch with, in place of the page's own fetch: a stand-in for the plugin, in tests. */
  fetch?: typeof fetch;
}

/** As much of the client as asking the plugin needs. */
export interface ApiAt {
  /** A path in the plugin's own HTTP as a URL to fetch. */
  api(path: string): string;
}

/**
 * endpoints asks the plugin's endpoints, by what each takes and answers:
 *
 *   import type { Api } from "./api.gen";
 *   const plugin = endpoints<Api>(ws);
 *   const issue = await plugin.get("/api/issues/{key}", { params: { key: "PROJ-1" } });
 *   await plugin.post("/api/issues/{key}/comment", { params: { key: issue.key }, body: { text: "On it" } });
 *
 * A path is written as the plugin declared it, and its values are given
 * beside it, so they're put in it as an address takes them.
 */
export function endpoints<A>(ws: ApiAt, options: EndpointsOptions = {}): Endpoints<A> {
  const ask = async (method: Method, path: string, asking: LooseAsking = {}): Promise<unknown> => {
    const endpoint = `${method} ${path}`;
    const init: RequestInit = { method };
    if (asking.body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(asking.body);
    }
    if (asking.signal) init.signal = asking.signal;
    // The page's fetch is looked up as it's asked, so a test that stands
    // in for it after this was made is the one used.
    const res = await (options.fetch ?? fetch)(ws.api(filled(endpoint, path, asking.params) + queried(asking.query)), init);
    if (!res.ok) {
      const said = (await res.text().catch(() => "")).trim();
      throw new EndpointError(said || `${endpoint} answered ${res.status}`, res.status, endpoint);
    }
    if (res.status === 204) return undefined;
    return res.json();
  };
  const of = (method: Method) => (path: string, asking?: LooseAsking) => ask(method, path, asking);
  // Each method's types are in Endpoints: here they're one function.
  return { get: of("GET"), post: of("POST"), put: of("PUT"), patch: of("PATCH"), delete: of("DELETE") } as Endpoints<A>;
}

interface LooseAsking {
  params?: Record<string, string>;
  body?: unknown;
  query?: object;
  signal?: AbortSignal;
}

// filled is a path with its values in it: {key} is one part of the path,
// and {rest...} is all that's left of it, its /s kept.
function filled(endpoint: string, path: string, params: Record<string, string> = {}): string {
  return path
    .split("/")
    .map((part) => {
      if (!part.startsWith("{") || !part.endsWith("}")) return part;
      const name = part.slice(1, -1);
      if (name === "$") return ""; // the path's end, in ServeMux's patterns
      const rest = name.endsWith("...");
      const value = params[rest ? name.slice(0, -3) : name];
      if (value === undefined) throw new TypeError(`${endpoint} is asked with no ${rest ? name.slice(0, -3) : name}`);
      return rest ? value.split("/").map(encodeURIComponent).join("/") : encodeURIComponent(value);
    })
    .join("/");
}

// queried is a query as an address has it: a value that's undefined or
// null isn't there, and a list is there once for each.
function queried(query: object = {}): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    for (const one of Array.isArray(value) ? value : [value]) search.append(name, String(one));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
