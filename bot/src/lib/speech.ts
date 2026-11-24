// The one way out for public chat: every line the body says goes through speak(), whoever wrote it. It checks
// the text again (so a callout table typo or a later caller still can't send a section sign or a slash), keeps
// one clock for all sources, and has a hook for the chat gate that will screen what the mind says. doors.test.ts
// fails if bot.chat( shows up anywhere else.
import type { Bot } from "mineflayer";
import { logger } from "./logger";

const log = logger("speech");

export const SAY_MAX = 100;
export const SAY_GAP_MS = 2000; // between any two lines, whoever said them
export const LOW_PRIORITY_GAP_MS = 4000; // a callout or escort line is dropped, not queued, this soon after anything
export const MINUTE_CAP = 12; // a runaway guard, not a pacing rule: guard's own 5 s gap just fits under it

export type SpeechSource = "say" | "callout" | "escort";
export type SpeechResult = "sent" | "rejected_text" | "rate_limited";
// a filter hands back the text to send (changed or not) or a rejection; it never throws
export type SpeechFilter = (text: string, source: SpeechSource) => string | { reject: true };

// one plain line of printable ASCII: nothing that is a command, a control or format character, a section sign
// (the server kicks a client for one) or a look-alike letter
export function sayable(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const t = text.trim();
  return t.length > 0 && t.length <= SAY_MAX && !t.startsWith("/") && /^[\x20-\x7e]+$/.test(t);
}

export function createSpeaker(now: () => number = Date.now) {
  let lastAt = -Infinity;
  let sent: number[] = [];
  const filters: SpeechFilter[] = [];

  function screen(text: string, source: SpeechSource): string | null {
    let out = text;
    for (const f of filters) {
      let r: string | { reject: true };
      try {
        r = f(out, source);
      } catch {
        return null; // a filter that breaks is a no
      }
      if (typeof r !== "string") return null;
      out = r;
    }
    return sayable(out) ? out : null;
  }

  function speak(bot: Pick<Bot, "chat">, text: string, source: SpeechSource): SpeechResult {
    if (!sayable(text)) return "rejected_text";
    const t = now();
    sent = sent.filter((at) => t - at < 60_000);
    const gap = source === "say" ? SAY_GAP_MS : LOW_PRIORITY_GAP_MS;
    if (t - lastAt < gap || sent.length >= MINUTE_CAP) return "rate_limited";
    const line = screen(text, source);
    if (line === null) return "rejected_text";
    try {
      bot.chat(line);
    } catch (err) {
      log.warn("chat failed", { source, message: (err as Error).message });
      return "rate_limited"; // not sent, and the clock stays as it was
    }
    lastAt = t;
    sent.push(t);
    log.info("said", { source, length: line.length });
    return "sent";
  }

  return { speak, addFilter: (f: SpeechFilter) => void filters.push(f) };
}

const speaker = createSpeaker();
export const speak = speaker.speak;
export const addSpeechFilter = speaker.addFilter;
