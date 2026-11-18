// @withworkspace/ui-lib: the page's side of ws's frame protocol. The
// protocol's types are under /protocol, and a fake host to test an app
// against is under /testing.

export { connect, NoHostError, ProtocolError } from "./client.js";
export type { Client, ConnectOptions, FoundRef, HostWindow, Theme } from "./client.js";
