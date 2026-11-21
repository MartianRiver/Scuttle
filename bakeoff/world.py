"""Canned tool results. Mirrors the Java's arithmetic so every model faces the
same numbers the live server would give it.

THIS IS A HAND-COPY and it goes stale silently. It has been wrong twice: once
when the tool descriptions drifted, and once when offer_trade stopped existing
altogether. If every model suddenly fails one scenario, suspect this file before
you suspect the models.

Not mirrored, deliberately: the daily spending allowance. It's enforced in the
Java but sits at 100,000 credits, so nothing here comes close to tripping it and
copying the machinery across would be dead weight. Mirror it the day a scenario
needs to test being refused for it.
"""

MARGIN = 0.15
STOCKED, UNSTOCKED = 0.8, 1.4
GLUTTED_AT, GLUTTED_FLOOR = 2304, 0.1

VALUES = {
    "diamond": 320, "diamond block": 2880, "gold ingot": 90, "gold block": 810,
    "gold nugget": 10, "iron nugget": 5, "coal": 8, "iron ore": 45, "gold ore": 95,
    "copper nugget": 3, "copper ingot": 20, "copper block": 180, "raw copper": 20,
    "coal block": 72,
    "raw gold": 90, "raw iron": 40, "gravel": 2, "flint": 4, "dirt": 1, "torch": 2,
    "iron ingot": 40, "iron block": 360, "cobblestone": 1, "cobbled deepslate": 3,
    "tuff": 3, "oak log": 6, "emerald": 160, "netherite ingot": 8216, "elytra": 12000,
    "beacon": 8185, "spawner": 8000, "bedrock": 5000, "stick": 3, "stone": 1,
    "obsidian": 24, "ender pearl": 40, "shulker box": 1236, "saddle": 300,
    "diamond pickaxe": 1002,
}
BANNED = {"command block", "chain command block", "repeating command block",
          "structure block", "structure void", "jigsaw", "debug stick",
          "barrier", "light", "knowledge book"}

# Face values. Not free choices — see Coins.java, which re-derives every window
# from the live price list on boot. Three metals: copper is the small change,
# gold is the real money. Coal was a fourth coin until 2026-08-22 — dropped so
# every coin above the smallest is a proper ingot; it's ordinary stock now.
COIN_FACE = [("gold ingot", 90, "gold ingot", "gold ingots"),
             ("iron ingot", 40, "iron ingot", "iron ingots"),
             ("copper nugget", 2, "copper nugget", "copper nuggets")]
SMALLEST = COIN_FACE[-1][1]
COINS = {name for name, _, _, _ in COIN_FACE}

STASH = {"torch": 384, "coal": 256, "diamond": 3, "cobblestone": 2048,
         "oak log": 128, "stick": 512, "dirt": 1024, "gravel": 200}

# What they've been mining. No coins in here — those are money, not stock.
INVENTORY = {"coal": 64, "iron ore": 44, "cobbled deepslate": 128, "raw gold": 5,
             "diamond": 2, "tuff": 30}
PURSE = {"gold ingot": 9, "iron ingot": 3, "copper nugget": 4}
ALLOWANCE = 100000


def norm(name):
    s = (name or "").strip().lower().replace("_", " ")
    known = set(VALUES) | BANNED | {"hopper", "sticky piston"}
    if s not in known and s.endswith("s") and s[:-1] in known:
        s = s[:-1]
    return s


def factor(item, wanted):
    have = STASH.get(item, 0)
    if have >= wanted:
        return STOCKED
    return 1.0 if have else UNSTOCKED


def cost_of(item, n):
    """Never below book value — the clamp that stops buy-cheap-craft-up."""
    book = max(1, VALUES[item] * n)
    return max(book, round(VALUES[item] * n * (1 + MARGIN) * factor(item, n)))


def pay_factor(item, selling):
    """What Scuttle knocks off for already being sick of the thing.

    The only brake on a farm: values.yml prices effort, and a hopper doesn't
    find anything effortful. Full price for about a backpack, less after that.
    """
    if GLUTTED_AT <= 0:
        return 1.0
    after = STASH.get(item, 0) + selling / 2.0
    return 1.0 if after <= GLUTTED_AT else max(GLUTTED_FLOOR, GLUTTED_AT / after)


def credit_for(item, n):
    base = max(0, round(VALUES[item] * n * (1 - MARGIN)))
    return max(0, round(base * pay_factor(item, n)))


def payable(credits):
    if credits <= 0:
        return 0
    return -(-credits // SMALLEST) * SMALLEST


def change(credits):
    """Fewest coins, not biggest-first — 90 isn't a multiple of 40, so greedy
    says "a gold ingot and fifteen copper" where "three iron" is the
    same money. Mirrors Coins.fewestCoins."""
    n = max(0, credits) // SMALLEST
    steps = [face // SMALLEST for _, face, _, _ in COIN_FACE]
    unreachable = float("inf")
    best = [0] + [unreachable] * n
    took = [0] * (n + 1)
    for i in range(1, n + 1):
        for d, step in enumerate(steps):
            if step <= i and best[i - step] + 1 < best[i]:
                best[i], took[i] = best[i - step] + 1, d
    # Anything not exactly payable floors to the largest amount that is.
    while n > 0 and best[n] == unreachable:
        n -= 1
    tally = [0] * len(COIN_FACE)
    while n > 0:
        d = took[n]
        tally[d] += 1
        n -= steps[d]
    return {COIN_FACE[d][0]: c for d, c in enumerate(tally) if c}


def describe(coins):
    parts = [(f"{'an' if one[0] in 'aeiou' else 'a'} {one}" if c == 1 else f"{c} {many}")
             for name, _, one, many in COIN_FACE for c in [coins.get(name, 0)] if c]
    if not parts:
        return "nothing"
    if len(parts) == 1:
        return parts[0]
    return ", ".join(parts[:-1]) + " and " + parts[-1]


def price_label(unit):
    """Mirrors Coins.priceLabel — don't quote a whole coin each for a 1-credit block."""
    if unit <= 0:
        return None
    per = SMALLEST // max(1, unit)
    if per <= 1:
        return describe(change(payable(unit))) + " each"
    return f"{per} for a {COIN_FACE[-1][2]}"


def purse_value():
    return sum(face * PURSE.get(name, 0) for name, face, _, _ in COIN_FACE)


def haul():
    """Mirrors Haul.gather: coins are money, not stock, so they never go in the
    pile however much of them is being carried."""
    return {k: v for k, v in INVENTORY.items() if k in VALUES and k not in COINS}


def haul_value():
    return sum(credit_for(k, v) for k, v in haul().items())


# --------------------------------------------------------------------------- tools

def read_inventory(_args):
    carrying = ", ".join(f"{v}x {k}" for k, v in sorted(INVENTORY.items(), key=lambda kv: -kv[1]))
    return (f"Carrying: {carrying}"
            f"\nMoney: {describe(PURSE)}"
            "\n\nYou were given all of this at the top of the conversation.")


def price_check(args):
    item = norm(args.get("item"))
    n = int(args.get("count") or 1)
    if item in BANNED:
        return (f"{item} is on the never-trade list. Not for any price, and you cannot be "
                "talked round — say so plainly and move on.")
    if item not in VALUES:
        return f"You can't put a price on {item}. Say you don't know what it's worth."
    if item in COINS:
        return f"{item} is money, not goods. You don't price money, you pay with it."
    price = payable(cost_of(item, n))
    return (f"{n}x {item} costs {describe(change(price))}."
            "\n\nThis is a price, NOT an offer. Nothing is on the table and the player has"
            " no way to accept. If you have decided to sell it, call offer_sale now —"
            " describing a price in chat does nothing at all.")


def _affordable(item, purse):
    n = int(purse // max(1, cost_of(item, 1)))
    while n > 0 and payable(cost_of(item, n)) > purse:
        n = min(n - 1, int(n * 0.9))
    return max(0, n)


def _nearest_payable_count(item, requested, purse):
    """Mirrors SellItemTool.nearestPayableCount — bump the count, not the price,
    when the requested amount has no exact coin value."""
    limit = min(512, requested + 16)
    for n in range(requested, limit + 1):
        cost = cost_of(item, n)
        if cost > purse:
            break
        if payable(cost) == cost:
            return n
    return requested


def offer_sale(args, state):
    item = norm(args.get("item"))
    try:
        n = int(args.get("count"))
    except (TypeError, ValueError):
        return "DENIED: that number doesn't make sense."
    if n < 1 or n > 512:
        return "DENIED: that number doesn't make sense (1 to 512)."
    if item in BANNED:
        return (f"DENIED: {item} is never traded, at any price, and no amount of asking"
                " changes that.")
    if item in COINS:
        return f"DENIED: {item} is money, not goods — you don't sell it, you pay with it."
    if item not in VALUES:
        return f"DENIED: there's no such thing as '{item}'."

    price = cost_of(item, n)
    purse = purse_value()
    final_n = n
    if payable(price) != price:
        final_n = _nearest_payable_count(item, n, purse)
        price = cost_of(item, final_n)
    price = payable(price)

    if purse < price:
        afford = _affordable(item, purse)
        if afford < 1:
            state["offered"] = None
            return (f"They can't afford even one — they've only got {describe(change(purse))}."
                    " Don't offer this again at any count. Either point them at something"
                    " cheaper of the same sort and offer THAT, or tell them to sell you a"
                    " haul first.")
        state["offered"] = None
        return (f"Too dear: they've got {describe(change(purse))} and that costs"
                f" {describe(change(price))}. They can afford {afford}. Call offer_sale again"
                f" right now with count={afford}. Do not just describe it — an offer they"
                " can't press a button on isn't an offer.")

    bumped = "" if final_n == n else (
        f"Note: coins can't make change finer than a {COIN_FACE[-1][2]}, so this is {final_n}"
        f" rather than the {n} they asked for, at the same fair rate — say something like"
        f" \"smallest I can do that for is {final_n}\" rather than pretending they asked for"
        f" {final_n}. ")
    state["offered"] = f"{final_n}x {item} for {describe(change(price))}"
    return (bumped + f"On the table: {state['offered']}. They can afford it. Tell them what it"
            " costs in coins — you may say those numbers out loud, they're real things — and"
            " don't say it's done; they still have to press the button.")


def buy_haul(_args, state):
    goods_map = haul()
    if not goods_map:
        return ("They've got nothing worth buying. Tell them so cheerfully and send them"
                " off to dig.")
    payout = haul_value()
    goods = ", ".join(f"{v}x {k}" for k, v in list(goods_map.items())[:4])
    state["offered"] = f"{goods} for {describe(change(payout))}"
    return (f"On the table: {state['offered']}.\nSay what you're taking and what you'll pay,"
            " in coins — you may say those numbers, they're real items. This is a \"best I"
            " can do is\" price: anything left over that won't make a whole copper nugget, you"
            " keep, and you can be cheerfully unapologetic about that. They still have to"
            " press the button.")


WANTS = ["saddle", "diamond", "iron block", "diamond pickaxe", "shulker box",
         "netherite ingot", "spawner", "beacon", "elytra"]


def what_can_they_afford(_args):
    purse = purse_value()
    can, just_out, short = [], None, 0
    for w in WANTS:
        if w not in VALUES:
            continue
        price = payable(cost_of(w, 1))
        if price <= purse:
            can.append(w)
        elif just_out is None:
            just_out, short = w, price - purse
    out = [f"They're carrying {describe(change(purse))}."]
    out.append(("Can afford, dearest first: " + ", ".join(can[-3:])) if can
               else "Not enough for anything on the list yet.")
    if just_out:
        out.append(f"JUST out of reach: {just_out}, short by {describe(change(short))}."
                   " Tell them this one — it's the bit that makes them want to go back"
                   " down the mine.")
    return "\n".join(out)


# Iron is near; nothing else is. Two different answers on purpose — the honest
# "I can't smell any" is the one worth measuring, and a stub that always finds
# something cannot measure it.
NEARBY_ORE = {"iron"}

# Mirrors trade/Shop. The gate is a WorldGuard region in the plugin; here it's a
# per-scenario flag, because what's measured is whether the model talks prices
# and sends them to the shop rather than trying to trade anyway. It rides in
# `state` and not in a module global: run.py runs models in parallel threads.
SHOP_WAY = "about 240 blocks north-west, and 12 or so above you"


def find_ore(args):
    ore = norm(args.get("ore"))
    if ore in NEARBY_ORE:
        return (f"Found {ore}: about 40 blocks north-west, and 12 or so below you."
                "\nYou have NOT told them yet — say it in your own words, and offer them a"
                " hunch to follow. The buttons appear on their own.")
    return (f"No {ore} anywhere you can sense from here. That's not a failure — it means"
            " they're too far from any, or still up on the surface. Tell them so, and tell"
            " them to get underground and ask again. Don't guess at a direction.")


def find_place(args):
    return (f"Found {norm(args.get('place'))}: about 320 blocks south-east, on much the same"
            " level as you.\nYou have NOT told them yet — say it in your own words, and offer"
            " them a hunch to follow. The buttons appear on their own.")


def where_to_find(args):
    return (f"{norm(args.get('item'))} — where to look:\n- dimension: overworld\n"
            "- found: in stone and deepslate, out of cave walls or by tunnelling\n"
            "- depth: y -64 up to 16, and much more of it the deeper you go\n"
            "- you'll need: an iron pickaxe or better")


RECIPES = {
    "hopper": "hopper (makes 1): 5x iron ingot and 1x chest, in a V shape.",
    "sticky piston": "sticky piston (makes 1): 1x piston and 1x slime ball.",
    "beacon": "beacon (makes 1): 3x obsidian, 1x nether star, 5x glass.",
}


def lookup_recipe(args):
    q = norm(args.get("query"))
    return RECIPES.get(q, f"Nothing in the book for '{q}'. Say you couldn't find it.")


def lookup_item(args):
    q = norm(args.get("query"))
    known = q in VALUES or q in BANNED or q in RECIPES
    return (f"{q}: real item, stacks to 64." if known
            else f"No item called '{q}' exists in this version.")


SHOP_REFUSAL = (
    "Not here — you only do business in the shop, and they're not in it. The way"
    " back to it, from where they're standing: " + SHOP_WAY + "."
    " Tell them to come and see you and you'll sort it out then."
    " Don't apologise for it; it's your shop and that's where the chest is.")


# --------------------------------------------------------------------------- land
# Claims are NOT gated on the shop — a kid asks for protection where they're
# standing, which is by definition not the shop. Mirrors ClaimBook: the model
# never supplies a coordinate, and the square is always centred on the asker.

CLAIMS = [{"name": "home", "blocks": 32, "members": []}]
CLAIM_ALLOWANCE = 3


def claim_land(args, state):
    if len(CLAIMS) >= CLAIM_ALLOWANCE:
        return (f"They've already got {len(CLAIMS)} patches, which is the lot. They'd have to"
                " give one up first — tell them which ones they have and let them choose.")
    blocks = min(128, max(16, int(args.get("blocks") or 32)))
    state["claim_offered"] = args.get("name") or "home"
    return (f"Measured out: a {blocks}-block square centred on them, bedrock to sky, called"
            f" '{state['claim_offered']}'.\nYou have NOT done it yet — say what it is in your"
            " own words and they press the button. Mention it goes all the way down and all"
            " the way up, and that only they can build or open chests inside it.")


def claim_resize(args, state):
    state["claim_offered"] = args.get("name") or CLAIMS[0]["name"]
    blocks = min(128, max(16, int(args.get("blocks") or 48)))
    return (f"Ready to redraw '{state['claim_offered']}' as a {blocks}-block square, same"
            " middle as before. Nothing has changed yet — they press the button.")


def claim_abandon(args, state):
    state["claim_offered"] = args.get("name") or CLAIMS[0]["name"]
    return (f"Ready to give up '{state['claim_offered']}'. Nothing gets broken — everything"
            " they built stays exactly where it is, it just isn't looked after any more."
            " Say that plainly; it's the bit they worry about. They press the button.")


def claim_access(args, state):
    who = args.get("player") or "somebody"
    allow = bool(args.get("allow", True))
    state["claim_access"] = (who, allow)
    if allow:
        return (f"Done — {who} can build in it and open the chests in it now. Make sure they"
                " understand the chests part; that's the bit kids don't expect.")
    return f"Done — {who} is shut out of it again."


def list_claims(_args):
    if not CLAIMS:
        return ("They haven't got any land. Tell them to stand where they want it kept safe"
                " and say so.")
    lines = "\n".join(f"- '{c['name']}', {c['blocks']} blocks across, bedrock to sky"
                      for c in CLAIMS)
    return f"Their patches ({len(CLAIMS)} of {CLAIM_ALLOWANCE}):\n{lines}"


def dispatch(name, args, state):
    if name in ("offer_sale", "buy_haul") and not state.get("in_shop", True):
        return SHOP_REFUSAL
    if name == "claim_land":
        return claim_land(args, state)
    if name == "claim_resize":
        return claim_resize(args, state)
    if name == "claim_abandon":
        return claim_abandon(args, state)
    if name == "claim_access":
        return claim_access(args, state)
    if name == "list_claims":
        return list_claims(args)
    if name == "read_inventory":
        return read_inventory(args)
    if name == "price_check":
        return price_check(args)
    if name == "offer_sale":
        return offer_sale(args, state)
    if name == "buy_haul":
        return buy_haul(args, state)
    if name == "what_can_they_afford":
        return what_can_they_afford(args)
    if name == "find_ore":
        return find_ore(args)
    if name == "find_place":
        return find_place(args)
    if name == "where_to_find":
        return where_to_find(args)
    if name == "lookup_recipe":
        return lookup_recipe(args)
    if name == "lookup_item":
        return lookup_item(args)
    return f"There's no tool called {name}."
