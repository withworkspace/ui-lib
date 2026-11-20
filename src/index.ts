// @withworkspace/ui-lib: the page's side of ws's frame protocol. The
// protocol's types are under /protocol, and a fake host to test an app
// against is under /testing.

export { connect, NoHostError, ProtocolError, UiError } from "./client.js";
export type { Box, Client, ConnectOptions, ConversationForm, ConversationSettings, ConversationStatus, Conversations, FoundRef, Holding, HostWindow, Theme, ThingAsked, ThingSaved, Ui, UiOpened } from "./client.js";
export { EndpointError, endpoints } from "./endpoints.js";
export type { Answer, ApiAt, Asking, EndpointAt, EndpointMap, EndpointShape, Endpoints, EndpointsOptions, Method, PathOf } from "./endpoints.js";
