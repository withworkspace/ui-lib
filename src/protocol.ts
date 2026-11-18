// The frame protocol: what a plugin's page and ws say to one another, as
// PROTOCOL.md has it. This is the one definition both sides are checked
// against: the client here speaks it for a page, and ws web types its host
// from it. Nothing here touches the DOM or does anything when it's imported.

import { isRecord, isString, isVersions } from "./shape.js";

/**
 * The versions of the frame protocol this release of the package speaks,
 * which a page lists in its ws:connect.
 */
export const PROTOCOL_VERSIONS = [1] as const;
export type ProtocolVersion = (typeof PROTOCOL_VERSIONS)[number];

/**
 * The design tokens protocol 1 promises a page, each as --ws-<name>: in the
 * shell's <style> before anything runs, and by value in the welcome and in
 * each ws:theme.
 */
export const TOKENS = [
  // Colour: the page, what's on it, and what marks it.
  "bg", "panel", "raised", "fg", "dim", "faint", "line", "line-strong", "hover", "well", "code-bg",
  "accent", "accent-soft", "accent-line", "primary", "primary-hover", "on-primary", "danger", "warn", "ok",
  // What dims a page behind a dialog: the shell's backdrop is drawn in it.
  "scrim",
  // Type.
  "font", "mono", "text-xs", "text-sm", "text-md", "text-lg", "text-xl", "text-2xl",
  // Space, corners and depth.
  "space-1", "space-2", "space-3", "space-4", "space-5", "space-6", "space-8", "space-10",
  "radius", "radius-sm", "radius-lg", "shadow",
] as const;
export type Token = (typeof TOKENS)[number];
/** A token as the CSS custom property a page uses: --ws-bg. */
export type TokenVar = `--ws-${Token}`;

// The handshake's first message and its refusal hold across versions: they
// are said before there's a version to say them in. A version may add
// fields to them, and nothing else.

/**
 * Connect is what a page sends its parent window, with one end of a
 * MessageChannel: the versions it speaks. Everything after is on the port.
 */
export interface Connect {
  type: "ws:connect";
  versions: number[];
  /**
   * Who's speaking ("@withworkspace/ui-lib@0.1.0"), for ws's console and
   * logs. ws decides nothing by it.
   */
  client?: string;
}

/**
 * Refuse is ws's answer when it speaks none of the page's versions: the
 * ones it does speak, and a sentence that says which side is behind.
 */
export interface Refuse {
  type: "ws:refuse";
  versions: number[];
  message: string;
}

export function isConnect(m: unknown): m is Connect {
  return isRecord(m) && m.type === "ws:connect" && isVersions(m.versions) && (m.client === undefined || isString(m.client));
}

export function isRefuse(m: unknown): m is Refuse {
  return isRecord(m) && m.type === "ws:refuse" && isVersions(m.versions) && isString(m.message);
}

/**
 * chooseVersion is the version a handshake settles on: the highest that
 * both the page and the host speak, or undefined when there's none.
 */
export function chooseVersion(page: readonly number[], host: readonly number[]): number | undefined {
  const common = page.filter((v) => host.includes(v));
  return common.length ? Math.max(...common) : undefined;
}

/** Protocol 1's messages and their guards. */
export * as V1 from "./v1.js";
