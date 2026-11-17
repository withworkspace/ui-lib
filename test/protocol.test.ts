import { describe, expect, test } from "vitest";
import pkg from "../package.json" with { type: "json" };
import * as protocol from "../src/protocol.js";
import { type Connect, PROTOCOL_VERSIONS, type ProtocolVersion, type Refuse, TOKENS, type Token, type TokenVar, V1, chooseVersion, isConnect, isRefuse } from "../src/protocol.js";
import { VERSION } from "../src/version.js";

// The messages as PROTOCOL.md shows them. `satisfies` is the check: if a
// type stops fitting what the document says, this file stops compiling.
const vars = Object.fromEntries(TOKENS.map((t) => [`--ws-${t}`, "0"])) as V1.Vars;
const connect = { type: "ws:connect", versions: [1], client: "@withworkspace/ui-lib@0.1.0" } satisfies Connect satisfies V1.Connect;
const welcome = {
  type: "ws:welcome",
  version: 1,
  ws: "0.43.0",
  plugin: { name: "jira", base: "/plugin-frame/jira", api: "/plugins/jira" },
  path: "/browse/PROJ-1?tab=links",
  theme: { scheme: "dark", vars },
  keys: { chords: ["k", "p"], bare: ["?", "g"], leaders: ["g"], within: 900 },
} satisfies V1.Welcome satisfies V1.HostMessage;
const refuse = { type: "ws:refuse", versions: [1], message: "jira speaks frame protocol 2, and this ws speaks 1. Update ws." } satisfies Refuse satisfies V1.Refuse satisfies V1.HostMessage;
const fromPage = [
  { type: "ws:path", path: "/browse/PROJ-2" } satisfies V1.Path,
  { type: "ws:title", title: "PROJ-2 Token cache" } satisfies V1.Title,
  { type: "ws:open", path: "/missions/token-cache" } satisfies V1.Open,
  { type: "ws:key", key: "k", meta: true, ctrl: false, shift: false, alt: false } satisfies V1.Key,
] satisfies V1.PageMessage[];
const fromHost = [
  welcome,
  refuse,
  { type: "ws:navigate", path: "/board" } satisfies V1.Navigate,
  { type: "ws:theme", scheme: "light", vars } satisfies V1.ThemeChanged,
  { type: "ws:changed" } satisfies V1.Changed,
] satisfies V1.HostMessage[];
// The other names /protocol has for a page and ws to use.
const _names: [ProtocolVersion, Token, TokenVar, V1.Scheme, V1.Theme, V1.Keys, V1.Plugin] = [1, "bg", "--ws-bg", "dark", welcome.theme, welcome.keys, welcome.plugin];
void _names;

describe("/protocol", () => {
  test("exports protocol 1's versions, tokens, guards and V1, and nothing that runs", () => {
    expect(Object.keys(protocol).sort()).toEqual(["PROTOCOL_VERSIONS", "TOKENS", "V1", "chooseVersion", "isConnect", "isRefuse"]);
    expect(Object.keys(V1).sort()).toEqual(["isHostMessage", "isPageMessage", "isWelcome"]);
    expect(PROTOCOL_VERSIONS).toEqual([1]);
  });

  test("names the 40 tokens protocol 1 promises, each once", () => {
    expect(TOKENS).toHaveLength(40);
    expect(new Set(TOKENS).size).toBe(40);
    expect(TOKENS).toContain("bg");
    expect(TOKENS).toContain("danger");
    expect(TOKENS).toContain("shadow");
  });

  test("the package's version is package.json's", () => {
    expect(VERSION).toBe(pkg.version);
  });
});

describe("chooseVersion", () => {
  test("picks the highest version both speak", () => {
    expect(chooseVersion([1], [1])).toBe(1);
    expect(chooseVersion([2, 1], [1])).toBe(1);
    expect(chooseVersion([1, 2, 3], [4, 2, 1])).toBe(2);
  });

  test("picks none when no version is in common", () => {
    expect(chooseVersion([2], [1])).toBeUndefined();
    expect(chooseVersion([1], [2, 3])).toBeUndefined();
    expect(chooseVersion([], [1])).toBeUndefined();
  });
});

describe("the guards", () => {
  test("isConnect takes a ws:connect with its versions", () => {
    expect(isConnect(connect)).toBe(true);
    expect(isConnect({ type: "ws:connect", versions: [2, 1] })).toBe(true);
    expect(isConnect({ type: "ws:connect" })).toBe(false);
    expect(isConnect({ type: "ws:connect", versions: ["1"] })).toBe(false);
    expect(isConnect({ type: "ws:connect", versions: [1.5] })).toBe(false);
    expect(isConnect({ type: "ws:connect", versions: [1], client: 7 })).toBe(false);
    expect(isConnect({ type: "ws:ready", path: "/" })).toBe(false);
    expect(isConnect(null)).toBe(false);
    expect(isConnect("ws:connect")).toBe(false);
  });

  test("isRefuse takes a ws:refuse with its versions and message", () => {
    expect(isRefuse(refuse)).toBe(true);
    expect(isRefuse({ type: "ws:refuse", versions: [1] })).toBe(false);
    expect(isRefuse(welcome)).toBe(false);
  });

  test("V1.isWelcome takes protocol 1's welcome, and no other version's", () => {
    expect(V1.isWelcome(welcome)).toBe(true);
    expect(V1.isWelcome({ ...welcome, version: 2 })).toBe(false);
    expect(V1.isWelcome({ ...welcome, theme: { scheme: "sepia", vars } })).toBe(false);
    expect(V1.isWelcome({ ...welcome, keys: undefined })).toBe(false);
    expect(V1.isWelcome({ ...welcome, plugin: { name: "jira" } })).toBe(false);
  });

  test("V1.isPageMessage takes each message a page sends, and drops the rest", () => {
    for (const m of fromPage) expect(V1.isPageMessage(m), m.type).toBe(true);
    for (const m of fromHost) expect(V1.isPageMessage(m), m.type).toBe(false);
    expect(V1.isPageMessage(connect)).toBe(false); // it goes to the window, not the port
    expect(V1.isPageMessage({ type: "ws:path" })).toBe(false);
    expect(V1.isPageMessage({ type: "ws:title", title: 3 })).toBe(false);
    expect(V1.isPageMessage({ type: "ws:key", key: "k" })).toBe(false);
    expect(V1.isPageMessage({ type: "ws:room", width: 900 })).toBe(false);
    expect(V1.isPageMessage(undefined)).toBe(false);
  });

  test("V1.isHostMessage takes each message ws sends, and drops the rest", () => {
    for (const m of fromHost) expect(V1.isHostMessage(m), m.type).toBe(true);
    for (const m of fromPage) expect(V1.isHostMessage(m), m.type).toBe(false);
    expect(V1.isHostMessage({ type: "ws:navigate" })).toBe(false);
    expect(V1.isHostMessage({ type: "ws:theme", scheme: "dark" })).toBe(false);
    expect(V1.isHostMessage({ type: "ws:later" })).toBe(false);
  });

  test("a message with a field its version doesn't know is still that message", () => {
    expect(V1.isPageMessage({ type: "ws:path", path: "/", later: true })).toBe(true);
    expect(V1.isHostMessage({ type: "ws:changed", what: "issues" })).toBe(true);
    expect(isConnect({ ...connect, later: true })).toBe(true);
  });
});
