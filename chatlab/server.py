#!/usr/bin/env python3
"""
Chat lab — talk to Scuttle without a Minecraft server.

Runs the same prompt assembly the plugin does (it reads the same persona.txt
and builds the same context block), so you can tune the character, the lore
file and the model without rebuilding a jar or logging in.

What it is NOT: the recipe book here is a small stub file. The real plugin
reads the server's own registry, which is the whole point of that tool. Trust
the lab for voice and cost, not for recipes.

    python3 chatlab/server.py          # then open http://localhost:8765
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PERSONA = ROOT / "src" / "main" / "resources" / "persona.txt"
LORE = Path(__file__).resolve().parent / "lore.txt"
RECIPES = Path(__file__).resolve().parent / "recipes.json"
INDEX = Path(__file__).resolve().parent / "index.html"

ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
PORT = int(os.environ.get("CHATLAB_PORT", "8765"))
MAX_TOOL_ROUNDS = 3


def log(level, module, message, **data):
    tail = " {" + ", ".join(f"{k}={v}" for k, v in data.items()) + "}" if data else ""
    print(f"[{level}] [{module}] {message}{tail}", flush=True)


def api_key():
    key = os.environ.get("OPENROUTER_API_KEY")
    if key:
        return key.strip()
    env = ROOT / ".env"
    if env.is_file():
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, _, value = line.partition("=")
            if name.strip() == "OPENROUTER_API_KEY":
                return value.strip().strip("\"'")
    return None


def persona_sections():
    """Same [[section]] format the plugin's PersonaBuilder parses."""
    if not PERSONA.is_file():
        log("ERROR", "persona", "persona.txt not found", path=PERSONA)
        return {}
    sections, current, body = {}, None, []
    for line in PERSONA.read_text(encoding="utf-8").splitlines():
        if line.startswith("#"):
            continue
        marker = re.match(r"^\[\[(.+)\]\]\s*$", line.strip())
        if marker:
            if current:
                sections[current] = "\n".join(body).strip()
            current, body = marker.group(1), []
            continue
        if current:
            body.append(line)
    if current:
        sections[current] = "\n".join(body).strip()
    return sections


def system_prompt(reading_level, lore):
    sections = persona_sections()
    out = [sections.get("character", "You are Scuttle.")]
    audience = sections.get(f"audience:{reading_level}") or sections.get("audience:8-11", "")
    out.append("\n\nWHO YOU'RE TALKING TO\n" + audience)
    if lore.strip():
        out.append("\n\nWHAT YOU KNOW ABOUT THIS SERVER\n"
                   "These are your own notes. Use them. Mention places and people by name.\n\n"
                   + lore.strip())
    return "".join(out)


def context_prompt(c):
    """Mirrors WorldContext.render() in the plugin."""
    lines = [
        "RIGHT NOW:",
        f"- Talking to: {c['player']} (permission level: {c['tier']})",
        f"- Standing in: {c['biome']}, {c['dimension']} "
        f"at x={c['x']} y={c['y']} z={c['z']}",
        f"- Time: {c['time']}, {c['weather']}",
        f"- Holding: {c['held']}",
        f"- Health {c['health']}/20, hunger {c['food']}/20",
    ]
    nearby = [n.strip() for n in c.get("nearby", "").split(",") if n.strip()]
    if nearby:
        lines.append("- Nearby: " + ", ".join(nearby))
    chat = [l for l in c.get("recentChat", "").splitlines() if l.strip()]
    if chat:
        lines.append("- Last few lines of chat:")
        lines += ["    " + l.strip() for l in chat]
    return "\n".join(lines) + "\n"


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "lookup_item",
            "description": "Check whether an item or block exists in this version of Minecraft, "
                           "and get its proper name plus basic facts. Use this when you are not "
                           "certain an item exists.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string",
                                         "description": "What the player called it"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_recipe",
            "description": "Look up how to craft, smelt, cut or smith something, straight from "
                           "this server's own recipe book. Always use this before telling a "
                           "player a recipe — never answer from memory.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string",
                                         "description": "The item to look up"}},
                "required": ["query"],
            },
        },
    },
]


def run_tool(name, args):
    """
    Stand-in for ToolRegistry.dispatch. Deliberately says when it has nothing,
    the same way the real tool does — that path is worth testing.
    """
    query = str(args.get("query", "")).strip().lower()
    if not query:
        return "DENIED: missing 'query'"

    book = json.loads(RECIPES.read_text(encoding="utf-8")) if RECIPES.is_file() else {}
    entry = book.get(query) or book.get(query.rstrip("s"))

    if name == "lookup_item":
        if entry:
            return f"{query} exists. {entry.get('item', 'No extra detail in the lab book.')}"
        return (f"The lab's book has no entry for '{query}'. (On the real server this reads the "
                f"game's own item list, so treat a miss here as 'unknown', not 'does not exist'.)")

    if name == "lookup_recipe":
        if entry and entry.get("recipe"):
            return entry["recipe"]
        return (f"No recipe for '{query}' in the lab's book. (The real server reads its own "
                f"recipe registry — say you can't find it rather than guessing.)")

    return f"DENIED: there is no tool called '{name}'."


def call_openrouter(key, model, messages, timeout):
    body = json.dumps({
        "model": model,
        "messages": messages,
        "tools": TOOLS,
        "max_tokens": 400,
        "usage": {"include": True},
    }).encode("utf-8")

    request = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "X-Title": "Scuttle chat lab",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def turn(payload):
    key = api_key()
    if not key:
        return {"error": "No OPENROUTER_API_KEY — put it in .env at the repo root."}

    model = payload.get("model") or "anthropic/claude-sonnet-5"
    # Same cache breakpoint the plugin sets, on the same block, so the cost the
    # lab reports is the cost the server will actually pay.
    messages = [
        {"role": "system", "content": [{
            "type": "text",
            "text": system_prompt(payload.get("readingLevel", "8-11"), payload.get("lore", "")),
            "cache_control": {"type": "ephemeral"},
        }]},
        {"role": "system", "content": context_prompt(payload.get("context", {}))},
    ]
    messages += payload.get("history", [])
    messages.append({"role": "user", "content": payload.get("message", "")})

    started = time.time()
    trace, cost, prompt_tokens, completion_tokens, served_by = [], 0.0, 0, 0, model
    cached_tokens = 0

    for round_number in range(MAX_TOOL_ROUNDS + 1):
        try:
            data = call_openrouter(key, model, messages, timeout=60)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            log("WARN", "llm", "HTTP error", status=e.code)
            return {"error": f"OpenRouter returned {e.code}: {detail}"}
        except Exception as e:  # network, timeout, bad JSON
            log("WARN", "llm", "call failed", error=str(e))
            return {"error": f"Could not reach OpenRouter: {e}"}

        if "error" in data and data["error"]:
            return {"error": json.dumps(data["error"])[:300]}

        usage = data.get("usage") or {}
        cost += float(usage.get("cost") or 0)
        prompt_tokens += int(usage.get("prompt_tokens") or 0)
        completion_tokens += int(usage.get("completion_tokens") or 0)
        cached_tokens += int((usage.get("prompt_tokens_details") or {}).get("cached_tokens") or 0)
        served_by = data.get("model", model)

        message = (data.get("choices") or [{}])[0].get("message", {})
        calls = message.get("tool_calls") or []

        if not calls or round_number == MAX_TOOL_ROUNDS:
            return {
                "reply": (message.get("content") or "").strip(),
                "tools": trace,
                "cost": cost,
                "promptTokens": prompt_tokens,
                "completionTokens": completion_tokens,
                "cachedTokens": cached_tokens,
                "model": served_by,
                "ms": int((time.time() - started) * 1000),
            }

        messages.append({"role": "assistant",
                         "content": message.get("content") or "",
                         "tool_calls": calls})
        for call in calls:
            fn = call.get("function", {})
            name = fn.get("name", "")
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            result = run_tool(name, args)
            trace.append({"name": name, "args": args, "result": result})
            messages.append({"role": "tool",
                             "tool_call_id": call.get("id"),
                             "content": result})

    return {"error": "gave up after too many tool rounds"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        log("TRACE", "http", format % args)

    def _send(self, code, body, content_type="application/json"):
        raw = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            if not INDEX.is_file():
                return self._send(500, "index.html is missing", "text/plain")
            return self._send(200, INDEX.read_bytes(), "text/html; charset=utf-8")
        if self.path == "/api/state":
            return self._send(200, json.dumps({
                "hasKey": bool(api_key()),
                "lore": LORE.read_text(encoding="utf-8") if LORE.is_file() else "",
                "personaSections": sorted(persona_sections().keys()),
            }))
        self._send(404, json.dumps({"error": "not found"}))

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._send(400, json.dumps({"error": "bad JSON"}))

        if self.path == "/api/chat":
            result = turn(payload)
            log("INFO", "lab", "turn",
                cost=round(float(result.get("cost") or 0), 5), ms=result.get("ms") or 0)
            return self._send(200, json.dumps(result))

        if self.path == "/api/lore":
            LORE.write_text(payload.get("lore", ""), encoding="utf-8")
            log("INFO", "lab", "lore saved", bytes=len(payload.get("lore", "")))
            return self._send(200, json.dumps({"ok": True}))

        self._send(404, json.dumps({"error": "not found"}))


def main():
    if not api_key():
        log("WARN", "lab", "no OPENROUTER_API_KEY found — the UI will say so too")
    log("INFO", "lab", f"chat lab on http://localhost:{PORT}")
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        log("INFO", "lab", "stopped")
        sys.exit(0)


if __name__ == "__main__":
    main()
