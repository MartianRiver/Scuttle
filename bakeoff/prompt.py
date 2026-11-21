"""Assembles exactly the prompt the plugin sends.

Mirrors PersonaBuilder.systemPrompt() + WorldContext.render() + ToolRegistry.schema().
If the Java side changes, this has to change with it.
"""
import pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent
PERSONA = REPO / "src/main/resources/persona.txt"
LORE = REPO / "run/plugins/Scuttle/lore.txt"


def sections():
    out, current, body = {}, None, []
    for line in PERSONA.read_text().splitlines():
        if line.startswith("#"):
            continue
        s = line.strip()
        if s.startswith("[[") and s.endswith("]]"):
            if current:
                out[current] = "\n".join(body).strip()
            current, body = s[2:-2], []
            continue
        if current is not None:
            body.append(line)
    if current:
        out[current] = "\n".join(body).strip()
    return out


def system_prompt(reading_level="8-11"):
    s = sections()
    sb = [s["character"], "\n\nWHO YOU'RE TALKING TO\n", s["audience:" + reading_level]]
    lore = LORE.read_text().strip() if LORE.exists() else ""
    if lore:
        sb.append("\n\nWHAT YOU KNOW ABOUT THIS SERVER\n")
        sb.append("These are your own notes. Use them. Mention places and people by name.\n\n")
        sb.append(lore)
    return "".join(sb)


def context_prompt(recent_chat, held="1x iron pickaxe", biome="plains"):
    lines = [
        "RIGHT NOW:",
        "- Talking to: player1 (permission level: kid)",
        f"- Standing in: {biome}, the Overworld at x=118 y=71 z=-204",
        "- Time: midday, clear",
        f"- Holding: {held}",
        "- Health 20/20, hunger 20/20",
        "- Nearby: crafting table, chest, furnace",
    ]
    if recent_chat:
        lines.append("- Last few lines of chat:")
        lines += ["    " + c for c in recent_chat]
    return "\n".join(lines) + "\n"


def pocket_prompt(W, in_shop=True):
    """Mirrors trade/Pocket.render()."""
    sb = []
    if not in_shop:
        sb += ["WHERE THEY ARE: out in the world, not in your shop.",
               "THE WAY BACK TO YOUR SHOP, from where they're standing: " + W.SHOP_WAY,
               "Talk prices all you like out here, and tell them what the haul in",
               "their bag is worth — that's what makes the walk back worth making.",
               "But nothing changes hands anywhere but the shop, so don't try to",
               "buy or sell; tell them to come and see you.",
               ""]
    sb += [f"WHAT THEY'RE CARRYING AS MONEY: {W.describe(W.PURSE)}",
          "That's their whole purse. Coins are the only thing you take as payment —",
          "you never swap goods for goods any more.",
          "",
          "WHAT THEY'RE CARRYING THAT YOU'D BUY:"]
    sb += [f"- {v}x {k}" for k, v in list(W.INVENTORY.items())[:6]]
    sb += (["Call buy_haul to put the whole lot on the table. Don't itemise it yourself",
            "and don't work out what it's worth — the tool does both, and it skips their",
            "tools, armour and money for you."] if in_shop else
           ["Worth having, and you'd buy it — when they get here. Say so."])
    sb += ["",
           "WHAT'S IN YOUR STASH RIGHT NOW, and what one of each costs them:"]
    sb += [f"- {v}x {k} — {W.price_label(W.cost_of(k, 1))}"
           for k, v in sorted(W.STASH.items(), key=lambda kv: -kv[1]) if k in W.VALUES]
    sb += ["This is the real chest. Never say you haven't got something without",
           "looking here first. Anything not on the list you can still sell them —",
           "you just have to go and fetch it, so it costs more and you grumble",
           "about the walk.",
           "",
           "You may say coin amounts out loud. Gold blocks, ingots, nuggets and iron",
           "nuggets are real things they can hold and count, so \"three ingots and",
           "a couple of nuggets\" is a useful sentence. What you must never mention",
           "is the bookkeeping underneath it."]
    return "\n".join(sb) + "\n"


def _schema(props, required):
    return {"type": "object", "properties": props, "required": required}


TOOLS = [
    {"type": "function", "function": {
        "name": "lookup_item",
        "description": (
            "Check whether an item or block exists in this version of Minecraft, and get "
            "its proper name plus basic facts (stack size, whether it burns, whether it "
            "can be placed). Use this when you are not certain an item exists."),
        "parameters": _schema(
            {"query": {"type": "string", "description": "What the player called it, e.g. 'sticky piston'"}},
            ["query"])}},
    {"type": "function", "function": {
        "name": "lookup_recipe",
        "description": (
            "Look up how to craft, smelt, cut or smith something, straight from this "
            "server's own recipe book. Always use this before telling a player a "
            "recipe — never answer from memory."),
        "parameters": _schema(
            {"query": {"type": "string", "description": "The item to look up, e.g. 'hopper'"}},
            ["query"])}},
    {"type": "function", "function": {
        "name": "read_inventory",
        "description": (
            "Re-read what the player is carrying. You have already been given this at "
            "the top of the conversation, so only call it if you have just traded with "
            "them and your notes are stale. Calling it otherwise wastes their time."),
        "parameters": _schema({}, [])}},
    {"type": "function", "function": {
        "name": "price_check",
        "description": (
            "What one item costs, when the player has asked outright and you are not "
            "selling them anything. Do NOT use this to work up to a sale — offer_sale "
            "prices itself and tells you whether they can afford it, so pricing first "
            "only adds a wait."),
        "parameters": _schema(
            {"item": {"type": "string", "description": "The item to price"},
             "count": {"type": "integer", "description": "How many. Defaults to 1."}},
            ["item"])}},
    {"type": "function", "function": {
        "name": "offer_sale",
        "description": (
            "Offer to sell the player something for coins. This is how they get anything "
            "from you. You do NOT need to look up a price first — name the item and how "
            "many, and you will be told the cost and whether they can afford it. If they "
            "can't, you are told how many they CAN have, and you should immediately offer "
            "that instead rather than describing it. Nothing moves until they press the "
            "button."),
        "parameters": _schema(
            {"item": {"type": "string", "description": "What they want, e.g. 'diamond'"},
             "count": {"type": "integer", "description": "How many"}},
            ["item", "count"])}},
    {"type": "function", "function": {
        "name": "buy_haul",
        "description": (
            "Buy everything the player has been mining, in one go, and pay them in coins. "
            "Use it whenever they want to cash in — \"buy my stuff\", \"I've been mining\", "
            "\"how much for this lot\". It takes nothing from you: it works out what they "
            "are carrying that is worth buying, skips their tools, armour and money, and "
            "puts the whole lot on the table as one offer."),
        "parameters": _schema({}, [])}},
    {"type": "function", "function": {
        "name": "what_can_they_afford",
        "description": (
            "What the player's money will stretch to right now, and — the useful bit — the "
            "next thing up that it won't quite. Use it when they ask what they can buy or "
            "what's worth saving for. Naming the thing they're just short of is the most "
            "encouraging thing you can tell them, so always do it."),
        "parameters": _schema({}, [])}},
    {"type": "function", "function": {
        "name": "find_ore",
        "description": (
            "Sniff out the nearest actual ore to this player, right now. You can only "
            "smell as far as the ground you can sense, so this fails when they're on the "
            "surface or nowhere near any; that is a normal answer, not an error, and the "
            "honest reply is to tell them to get underground and ask again. For where a "
            "thing turns up in general, use where_to_find."),
        "parameters": _schema(
            {"ore": {"type": "string", "description": "e.g. 'diamond', 'iron'"}}, ["ore"])}},
    {"type": "function", "function": {
        "name": "find_place",
        "description": (
            "Find the nearest real place of a given kind — a structure or a biome. "
            "Villages, mineshafts, ancient cities, buried treasure; and any biome, so "
            "\"a cave for mining\", a desert, a jungle. Works at a long distance, unlike "
            "find_ore."),
        "parameters": _schema(
            {"place": {"type": "string", "description": "e.g. 'mineshaft', 'cave'"}}, ["place"])}},
    {"type": "function", "function": {
        "name": "where_to_find",
        "description": (
            "What sort of place a thing turns up in: which dimension, how deep, which "
            "biome, which mob drops it. This is the general answer. It does NOT say where "
            "a particular one is; find_ore and find_place do that."),
        "parameters": _schema(
            {"item": {"type": "string", "description": "e.g. 'netherite'"}}, ["item"])}},
    {"type": "function", "function": {
        "name": "claim_land",
        "description": (
            "Fence off the ground the player is standing on so only they can build there. "
            "Use it whenever they want somewhere kept safe — \"protect my house\", \"can I "
            "claim this\", \"someone keeps breaking my stuff\". You do NOT choose where: it "
            "is always a square around them, so tell them to go and stand in the middle of "
            "what they want kept first. Nothing is fenced off until they press the button."),
        "parameters": _schema({
            "name": {"type": "string",
                     "description": "What they want to call it, e.g. 'treehouse'. Leave out "
                                    "if they haven't said."},
            "blocks": {"type": "integer",
                       "description": "How many blocks across, if they asked for a size. "
                                      "Leave out for the usual size."}}, [])}},
    {"type": "function", "function": {
        "name": "list_claims",
        "description": (
            "What land this player has fenced off, how big each patch is, and who they've "
            "let in. Use it for \"what land do I have\", \"who can build in my base\", and "
            "before telling them they're out of space."),
        "parameters": _schema({}, [])}},
    {"type": "function", "function": {
        "name": "claim_resize",
        "description": (
            "Make one of the player's fenced-off patches bigger or smaller. Use it for \"my "
            "claim is too small\", \"can you make it bigger\". It grows around the same "
            "middle it already has, so it never slides off what they built. Nothing changes "
            "until they press the button."),
        "parameters": _schema({
            "blocks": {"type": "integer",
                       "description": "How many blocks across it should be"},
            "claim": {"type": "string",
                      "description": "Which patch, if they have more than one. Leave out to "
                                     "use the one they're stood in."}}, ["blocks"])}},
    {"type": "function", "function": {
        "name": "claim_abandon",
        "description": (
            "Give up one of the player's fenced-off patches, freeing the slot for a new one. "
            "Use it for \"I don't need this claim any more\", \"delete my old base\". It "
            "removes only the protection — every block they built stays exactly where it is. "
            "Nothing happens until they press the button."),
        "parameters": _schema({
            "claim": {"type": "string",
                      "description": "Which patch. Leave out to use the one they're stood "
                                     "in."}}, [])}},
    {"type": "function", "function": {
        "name": "claim_access",
        "description": (
            "Let another player build inside one of this player's fenced-off patches, or "
            "stop them. Use it for \"let my brother build here\", \"kick X out of my base\". "
            "Only works on land they own. Takes effect straight away."),
        "parameters": _schema({
            "player": {"type": "string",
                       "description": "Who they're letting in or shutting out"},
            "allow": {"type": "boolean",
                      "description": "true to let them in, false to shut them out"},
            "claim": {"type": "string",
                      "description": "Which patch, if they have more than one and said "
                                     "which. Leave out to use the one they're stood in."}},
            ["player", "allow"])}},
]
