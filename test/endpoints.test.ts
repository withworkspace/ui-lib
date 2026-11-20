// Asking a plugin's endpoints: what's fetched for each, what comes back,
// and that what doesn't fit the plugin's Api doesn't compile.

import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { EndpointError, endpoints } from "../src/index.js";

interface Issue {
  key: string;
  comments: string[];
}

// A query each name of which can be left out.
interface Open {
  open?: boolean;
  label?: string[];
  limit?: number;
  after?: string | null;
}

// As `go tool apigen` writes it, from the plugin's Go.
interface Api {
  "GET /api/issues": { query: Open; out: Issue[] };
  "GET /api/search": { query: { q: string; limit?: number }; out: Issue[] };
  "GET /api/issues/{key}": { params: { key: string }; out: Issue | null };
  "PUT /api/issues/{key}": { params: { key: string }; in: Issue; out: Issue };
  "PATCH /api/issues/{key}": { params: { key: string }; in: Record<string, string>; out: Issue };
  "DELETE /api/issues/{key}": { params: { key: string }; out: void };
  "POST /api/issues/{key}/comment": { params: { key: string }; in: { text: string }; out: Issue };
  "POST /api/sync": { out: void };
  "GET /api/files/{path...}": { params: { path: string }; out: string };
}

const ws = { api: (path: string) => `/plugins/jira${path}` };

// A stand-in for the plugin: it keeps what was fetched, and answers each
// with the next of what it's given.
function plugin(...answers: Response[]) {
  const asked: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit = {}) => {
    asked.push({ url, init });
    const answer = answers.shift();
    if (!answer) throw new Error(`nothing to answer ${url} with`);
    return answer;
  }) as typeof globalThis.fetch;
  return { asked, api: endpoints<Api>(ws, { fetch }) };
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("asking", () => {
  it("reads at the path, with its values and a query in it", async () => {
    const p = plugin(json({ key: "PROJ/1", comments: [] }), json([]));
    const issue = await p.api.get("/api/issues/{key}", { params: { key: "PROJ/1" } });
    expect(issue).toEqual({ key: "PROJ/1", comments: [] });
    expect(p.asked[0]).toEqual({ url: "/plugins/jira/api/issues/PROJ%2F1", init: { method: "GET" } });

    await p.api.get("/api/issues", { query: { open: true, label: ["a b", "c"], limit: 20, after: null } });
    expect(p.asked[1]?.url).toBe("/plugins/jira/api/issues?open=true&label=a+b&label=c&limit=20");
  });

  it("sends a body as JSON", async () => {
    const p = plugin(json({ key: "PROJ-1", comments: ["On it"] }), json({ key: "PROJ-1", comments: [] }), json({ key: "PROJ-1", comments: [] }));
    const issue = await p.api.post("/api/issues/{key}/comment", { params: { key: "PROJ-1" }, body: { text: "On it" } });
    expect(issue.comments).toEqual(["On it"]);
    expect(p.asked[0]).toEqual({
      url: "/plugins/jira/api/issues/PROJ-1/comment",
      init: { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"text":"On it"}' },
    });

    await p.api.put("/api/issues/{key}", { params: { key: "PROJ-1" }, body: { key: "PROJ-1", comments: [] } });
    await p.api.patch("/api/issues/{key}", { params: { key: "PROJ-1" }, body: { summary: "x" } });
    expect(p.asked.slice(1).map((a) => a.init.method)).toEqual(["PUT", "PATCH"]);
  });

  it("resolves with nothing for an endpoint that answers nothing", async () => {
    const p = plugin(new Response(null, { status: 204 }), new Response(null, { status: 204 }));
    expect(await p.api.post("/api/sync")).toBeUndefined();
    expect(p.asked[0]).toEqual({ url: "/plugins/jira/api/sync", init: { method: "POST" } });
    expect(await p.api.delete("/api/issues/{key}", { params: { key: "PROJ-1" } })).toBeUndefined();
    expect(p.asked[1]?.init.method).toBe("DELETE");
  });

  it("keeps the /s of the rest of a path", async () => {
    const p = plugin(json("text"));
    await p.api.get("/api/files/{path...}", { params: { path: "notes/a b.md" } });
    expect(p.asked[0]?.url).toBe("/plugins/jira/api/files/notes/a%20b.md");
  });

  it("hands on a signal", async () => {
    const p = plugin(json([]));
    const stop = new AbortController();
    await p.api.get("/api/issues", { signal: stop.signal });
    expect(p.asked[0]?.init.signal).toBe(stop.signal);
  });

  it("rejects with what the plugin said, and how", async () => {
    const p = plugin(new Response("PROJ-9 isn't on the board\n", { status: 404 }), new Response("", { status: 502 }));
    const gone = await p.api.get("/api/issues/{key}", { params: { key: "PROJ-9" } }).catch((err: unknown) => err);
    expect(gone).toBeInstanceOf(EndpointError);
    expect(gone).toMatchObject({ name: "EndpointError", message: "PROJ-9 isn't on the board", status: 404, endpoint: "GET /api/issues/{key}" });

    const silent = await p.api.post("/api/sync").catch((err: unknown) => err);
    expect(silent).toMatchObject({ message: "POST /api/sync answered 502", status: 502 });
  });

  it("uses the page's fetch as it is when it asks", async () => {
    const api = endpoints<Api>(ws);
    const fetched = vi.fn(async () => json([{ key: "PROJ-1", comments: [] }]));
    vi.stubGlobal("fetch", fetched);
    expect(await api.get("/api/issues")).toHaveLength(1);
    expect(fetched).toHaveBeenCalledWith("/plugins/jira/api/issues", { method: "GET" });
  });

  it("says which value a path was asked without", async () => {
    const p = plugin();
    // What the types stop, done anyway.
    const loose = p.api as unknown as { get(path: string, asking?: object): Promise<unknown> };
    await expect(loose.get("/api/issues/{key}", { params: {} })).rejects.toThrow("GET /api/issues/{key} is asked with no key");
  });
});

describe("the types", () => {
  const api = endpoints<Api>(ws, { fetch: (async () => json(null)) as typeof fetch });

  it("are what each endpoint answers", () => {
    expectTypeOf(api.get("/api/issues")).resolves.toEqualTypeOf<Issue[]>();
    expectTypeOf(api.get("/api/issues", { query: { open: true } })).resolves.toEqualTypeOf<Issue[]>();
    expectTypeOf(api.get("/api/search", { query: { q: "cache" } })).resolves.toEqualTypeOf<Issue[]>();
    expectTypeOf(api.get("/api/issues/{key}", { params: { key: "PROJ-1" } })).resolves.toEqualTypeOf<Issue | null>();
    expectTypeOf(api.post("/api/issues/{key}/comment", { params: { key: "PROJ-1" }, body: { text: "" } })).resolves.toEqualTypeOf<Issue>();
    expectTypeOf(api.post("/api/sync")).resolves.toEqualTypeOf<void>();
    expectTypeOf(api.get("/api/files/{path...}", { params: { path: "a" } })).resolves.toEqualTypeOf<string>();
  });

  it("stop what isn't the plugin's", () => {
    const never = () => {
      // @ts-expect-error not one of the plugin's paths
      void api.get("/api/issue");
      // @ts-expect-error a path that's read, not posted to
      void api.post("/api/issues");
      // @ts-expect-error its path has a value, which isn't given
      void api.get("/api/issues/{key}");
      // @ts-expect-error not the value its path has
      void api.get("/api/issues/{key}", { params: { id: "PROJ-1" } });
      // @ts-expect-error it takes a body, which isn't given
      void api.post("/api/issues/{key}/comment", { params: { key: "PROJ-1" } });
      // @ts-expect-error not the body it takes
      void api.post("/api/issues/{key}/comment", { params: { key: "PROJ-1" }, body: { message: "On it" } });
      // @ts-expect-error it takes no body
      void api.post("/api/sync", { body: {} });
      // @ts-expect-error it has no values in its path
      void api.get("/api/issues", { params: { key: "PROJ-1" } });
      // @ts-expect-error not a name its query has
      void api.get("/api/issues", { query: { opne: true } });
      // @ts-expect-error not the type that name's value is
      void api.get("/api/issues", { query: { limit: "lots" } });
      // @ts-expect-error its query has a name that can't be left out
      void api.get("/api/search");
      // @ts-expect-error that name isn't given
      void api.get("/api/search", { query: { limit: 5 } });
      // @ts-expect-error it's asked with no query
      void api.get("/api/issues/{key}", { params: { key: "PROJ-1" }, query: { open: true } });
    };
    expect(never).toBeTypeOf("function");
  });
});
