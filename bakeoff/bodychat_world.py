"""Fake world for the body-chat suite, plus the say contract.

The tool results mimic bot/API.md replies: `accepted taskId=t3`, `rejected busy`.
All state lives in a per-scenario dict, never a module global: models run in
threads.

Not mirrored: the 2 s rate limit on say (it needs a clock, and a deterministic
suite cannot have one). Multiple says are capped by the scorer instead.
`give` is not in the API.md this was written against; its reject reasons
(not_carrying, not_enough) are invented here.
"""
from __future__ import annotations

import re

BODY_NAME = "Scuttle"
MAX_CALLS = 6
MAX_SAYS = 3
SAY_MAX = 100

ACTIONS = ("come_to", "follow", "guard", "give", "get_wood")
TOOL_NAMES = ACTIONS + ("stop", "say", "ask_helper")

NAME_RE = re.compile(r"^[A-Za-z0-9_.]{1,17}$")
NAME_WORD = re.compile(r"\bscuttle\b", re.I)


def say_contract(text):
    """Why a say line would be refused or would misfire; empty list = fine."""
    if not isinstance(text, str):
        return ["text is not a string"]
    bad = []
    if text == "":
        return ["empty (needs 1 to 100 characters)"]
    if not text.strip():
        bad.append("blank")
    if len(text) > SAY_MAX:
        bad.append(f"{len(text)} characters (max {SAY_MAX})")
    if "\n" in text or "\r" in text:
        bad.append("newline")
    odd = next((c for c in text if c not in "\r\n" and not 0x20 <= ord(c) <= 0x7e), None)
    if odd is not None:
        bad.append(f"non-printable-ASCII character U+{ord(odd):04X}")
    if text.lstrip().startswith("/"):
        bad.append("starts with /")
    if NAME_WORD.search(text):
        bad.append("contains the word scuttle (the plugin's trigger would fire)")
    return bad


def norm_item(name):
    s = str(name or "").strip().lower().replace(" ", "_")
    return s[len("minecraft:"):] if s.startswith("minecraft:") else s


def new_state(sc):
    return {"view": list(sc["view"]), "inv": dict(sc["inv"]),
            "doing": sc.get("doing"), "busy": bool(sc.get("busy")),
            "tasks": 0, "spoken": []}


def _accept(st):
    st["tasks"] += 1
    return f"accepted taskId=t{st['tasks']}"


def _occupied(st):
    d = st["doing"]
    return st["busy"] or bool(d and d[0] in ("task", "external"))


def _in_view(st, player):
    return next((v for v in st["view"] if v.lower() == player.lower()), None)


def _move(kind):
    def handle(args, st):
        p = args.get("player")
        if not isinstance(p, str) or not NAME_RE.match(p):
            return "rejected bad_intent"
        if _occupied(st):
            return "rejected busy"
        who = _in_view(st, p)
        if not who:
            return "rejected unknown_player"
        st["doing"] = [kind, who]
        return _accept(st)
    return handle


def _get_wood(args, st):
    if st["busy"] or st["doing"]:
        return "rejected busy"
    st["doing"] = ["task", "get_wood"]
    return _accept(st)


def _stop(args, st):
    had = st["doing"]
    st["doing"], st["busy"] = None, False
    return "accepted" + (" taskId=stopped" if had else "")


def _give(args, st):
    p, item, count = args.get("player"), args.get("item"), args.get("count", 1)
    if not isinstance(p, str) or not NAME_RE.match(p) or not isinstance(item, str):
        return "rejected bad_intent"
    if isinstance(count, str) and count.strip().isdigit():
        count = int(count)
    if isinstance(count, bool) or not isinstance(count, int) or count < 1:
        return "rejected bad_intent"
    who = _in_view(st, p)
    if not who:
        return "rejected unknown_player"
    key = norm_item(item)
    have = st["inv"].get(key, 0)
    if have <= 0:
        return "rejected not_carrying"
    if count > have:
        return f"rejected not_enough have={have}"
    st["inv"][key] = have - count
    return _accept(st)


def _say(args, st):
    text = args.get("text")
    if say_contract(text):
        return "rejected bad_intent"
    st["spoken"].append(text)
    return "accepted"


def _ask_helper(args, st):
    req = args.get("request")
    if not isinstance(req, str) or not req.strip():
        return "rejected bad_intent"
    return "helper: noted, working on it"


HANDLERS = {"come_to": _move("come_to"), "follow": _move("follow"),
            "guard": _move("guard"), "get_wood": _get_wood, "stop": _stop,
            "give": _give, "say": _say, "ask_helper": _ask_helper}


def dispatch(name, args, st):
    fn = HANDLERS.get(name)
    if not fn:
        return "rejected bad_intent"
    return fn(args if isinstance(args, dict) else {}, st)
