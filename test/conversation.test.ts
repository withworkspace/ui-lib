import { describe, expect, test } from "vitest";
import { type ConversationStatus, connect } from "../src/index.js";
import { isHostMessage, isPageMessage } from "../src/v1.js";
import { fakeHost } from "../src/testing.js";
import { closing, settled } from "./page.js";

async function connected(options: Parameters<typeof fakeHost>[0] = {}) {
  const host = closing(fakeHost(options));
  const ws = closing(await connect({ host: host.window }));
  return { host, ws };
}

describe("conversations about the page", () => {
  test("set says all of it, and only when it changes", async () => {
    const { host, ws } = await connected();
    const said = () => host.sent.filter((m) => m.type === "ws:conversation");

    expect(ws.conversation.available).toBe(true);
    ws.conversation.set({ ask: true, allow: ["card", "popover"], context: "Brief → Plan" });
    ws.conversation.set({ ask: true });
    await settled(ws, host);
    expect(host.conversation).toEqual({ ask: true, allow: ["card", "popover"], context: "Brief → Plan" });

    // A field given takes the place of what it was; one given as undefined goes.
    ws.conversation.set({ holding: { label: "2 selected", names: ["sketch-3"], text: "`plan` Plan" } });
    ws.conversation.set({ context: undefined });
    await settled(ws, host);
    expect(host.conversation).toEqual({ ask: true, allow: ["card", "popover"], holding: { label: "2 selected", names: ["sketch-3"], text: "`plan` Plan" } });
    expect(said()).toHaveLength(3);
  });

  test("a page that says only some starts from no bar and every form", async () => {
    const { host, ws } = await connected();
    ws.conversation.set({ context: "a board" });
    await settled(ws, host);
    expect(host.conversation).toEqual({ ask: false, allow: ["card", "docked", "popover"], context: "a board" });
  });

  test("set refuses a form there isn't, and a holding with no label", async () => {
    const { ws } = await connected();
    expect(() => ws.conversation.set({ allow: ["sidebar" as never] })).toThrow(TypeError);
    expect(() => ws.conversation.set({ holding: { label: "" } })).toThrow(TypeError);
    expect(() => ws.conversation.open({ as: "sheet" as never })).toThrow(TypeError);
  });

  test("open tells ws what's been set first, then opens with the message and its context", async () => {
    const { host, ws } = await connected();
    ws.conversation.set({ ask: true });
    ws.conversation.open({ message: "Add a bubble off plan", context: "Selected: plan", as: "docked" });

    const set = await host.next("ws:conversation");
    expect(set.ask).toBe(true);
    expect(await host.next("ws:conversation-open")).toEqual({ type: "ws:conversation-open", message: "Add a bubble off plan", context: "Selected: plan", as: "docked" });

    ws.conversation.open({ message: "  " });
    expect(await host.next("ws:conversation-open")).toEqual({ type: "ws:conversation-open" });
    ws.conversation.close();
    expect(await host.next("ws:conversation-close")).toEqual({ type: "ws:conversation-close" });
  });

  test("ws's state reaches onChange and status", async () => {
    const { host, ws } = await connected();
    const seen: ConversationStatus[] = [];
    const off = ws.conversation.onChange((s) => seen.push(s));
    expect(ws.conversation.status).toEqual({ open: false, working: false });

    host.conversationState({ open: true, as: "docked", working: true });
    host.conversationState({ open: false });
    await new Promise<void>((resolve) => {
      const stop = ws.conversation.onChange((s) => {
        if (!s.open) {
          stop();
          resolve();
        }
      });
    });
    off();
    expect(seen).toEqual([{ open: true, as: "docked", working: true }, { open: false, working: false }]);
    expect(ws.conversation.status).toEqual({ open: false, working: false });
  });

  test("in a ws from before conversations, it says nothing", async () => {
    const { host, ws } = await connected({ conversations: false });
    expect(ws.conversation.available).toBe(false);
    ws.conversation.set({ ask: true });
    ws.conversation.open({ message: "hello" });
    ws.conversation.close();
    await settled(ws, host);
    expect(host.sent.filter((m) => m.type.startsWith("ws:conversation"))).toEqual([]);
  });

  test("the guards", () => {
    expect(isPageMessage({ type: "ws:conversation", ask: true, allow: ["card"] })).toBe(true);
    expect(isPageMessage({ type: "ws:conversation", ask: true, allow: ["sheet"] })).toBe(false);
    expect(isPageMessage({ type: "ws:conversation", allow: [] })).toBe(false);
    expect(isPageMessage({ type: "ws:conversation", ask: false, allow: [], holding: { names: [] } })).toBe(false);
    expect(isPageMessage({ type: "ws:conversation-open", as: "popover" })).toBe(true);
    expect(isPageMessage({ type: "ws:conversation-open", message: 3 })).toBe(false);
    expect(isHostMessage({ type: "ws:conversation-state", open: true, as: "card", working: false })).toBe(true);
    expect(isHostMessage({ type: "ws:conversation-state", open: true })).toBe(false);
  });
});
