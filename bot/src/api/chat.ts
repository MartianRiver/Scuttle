import { parseFrame, type Intent } from "./protocol";

// Public chat has five commands, spelled exactly. Each is built as an API frame and parsed, so
// a speaker's name faces the same check as one sent over the socket.
export function chatIntent(username: string, message: string): Intent | null {
  let frame: Record<string, unknown>;
  switch (message) {
    case "come here":
      frame = { intent: "come_to", player: username };
      break;
    case "guard me":
      frame = { intent: "guard", player: username };
      break;
    case "stop":
      frame = { intent: "stop" };
      break;
    case "get wood":
      frame = { intent: "task", name: "get_wood" };
      break;
    case "get stone":
      frame = { intent: "task", name: "get_stone" };
      break;
    default:
      return null;
  }
  const parsed = parseFrame(JSON.stringify({ type: "intent", id: "chat", ...frame }));
  if (!parsed.ok || parsed.msg.type !== "intent") return null;
  const { type: _type, id: _id, ...intent } = parsed.msg;
  return intent as Intent;
}
