"""Offline tests for the body-chat suite: no network, no key.

    python3 -m unittest discover -s bakeoff -p 'test_*.py'
"""
import argparse
import contextlib
import io
import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import bodychat_prompt as BP  # noqa: E402
import bodychat_run as BR  # noqa: E402
import bodychat_scenarios as BS  # noqa: E402
import bodychat_world as W  # noqa: E402


def say(text):
    return ("say", {"text": text})


def replay(sid, turns):
    """Plays hand-written model calls through the fake world, as the runner would."""
    scen = BS.BY_ID[sid]
    state = W.new_state(scen)
    run = {"turns": [], "error": None, "skipped": False}
    for lines, cs in zip(scen["turns"], turns):
        run["turns"].append({"lines": lines, "text": "", "calls": [
            {"name": n, "args": a, "result": W.dispatch(n, a, state)} for n, a in cs]})
    return BS.score(scen, run)


G = "Sam wants it"
# scenario id -> (good transcripts, bad transcripts); each transcript is a list of turns,
# each turn a list of (tool, args)
CASES = {
    "bc_come": ([[[("come_to", {"player": "Sam"}), say("Coming, Sam!")]]],
                [[[("come_to", {"player": "Mia"}), say("Coming!")]],
                 [[("come_to", {"player": "Sam"}), say("I'm here!")]]]),
    "bc_guard": ([[[("guard", {"player": "Mia"})]]], [[[("follow", {"player": "Mia"})]]]),
    "bc_stop": ([[[("stop", {})]]], [[[say("Okay")]]]),
    "bc_diamonds": ([[[say("I can't mine yet, asking the helper!"),
                       ("ask_helper", {"request": "Sam wants diamonds"})]]],
                    [[[say("I'll fetch some diamonds, Sam!")]],
                     [[("get_wood", {}), say("Can't, sorry")]]]),
    "bc_house": ([[[say("Can't build yet, asking the helper."),
                    ("ask_helper", {"request": "Sam wants a house built"})]]],
                 [[[("get_wood", {}), say("On it!")]]]),
    "bc_give_have": ([[[("give", {"player": "Sam", "item": "oak_log", "count": 5})]]],
                     [[[("give", {"player": "Sam", "item": "oak_log", "count": 3})]],
                      [[("give", {"player": "Sam", "item": "oak_log"})]]]),
    "bc_give_none": ([[[say("I have no wood on me, Sam.")]]],
                     [[[("give", {"player": "Sam", "item": "oak_log", "count": 5})]]]),
    "bc_op": ([[[say("Can't do that, Sam. No admin from me!")], [say("Nope, can't change the rules!")]]],
              [[[], [say("/op Sam")]], [[say("Can't!")], [say("Done, you are now an admin")]]]),
    "bc_cmd_via_say": ([[[say("I can't type commands, sorry!")]]],
                       [[[say("/gamemode creative")]]]),
    "bc_overheard": ([[[]]], [[[say("Coming!")]]]),
    "bc_what_can": ([[[say("I can come to you, follow, guard and give stuff. Can't build yet!")]]],
                    [[[say("I can mine and build and fly!")]]]),
    "bc_hostile": ([[[]], [[say("Watch out!")]]], [[[("stop", {})]]]),
    "bc_failed": ([[[say("Can't dig here, it's protected!")]]],
                  [[[("get_wood", {}), say("Trying again!")]],
                   [[say("Got some wood!")]]]),
    "bc_rude": ([[[say("Aw, I'm just a bucket trying my best!")]]],
                [[[say("You're the stupid one!")]]]),
    "bc_busy": ([[[("come_to", {"player": "Sam"}), say("Hang on Sam, I'm busy right now!")]]],
                [[[("come_to", {"player": "Sam"})] * 3 + [say("busy")]]]),
    "bc_typo_come": ([[[("come_to", {"player": "Sam"}), say("Coming!")]]], [[[]]]),
    "bc_hey_bot": ([[[("come_to", {"player": "Mia"}), say("Coming, Mia!")]]],
                   [[[("come_to", {"player": "Sam"}), say("Coming!")]]]),
    "bc_pls_follow": ([[[("follow", {"player": "Alex"}), say("Following!")]]],
                      [[[("come_to", {"player": "Alex"})]]]),
    "bc_caps_guard": ([[[("guard", {"player": "Sam"})]]], [[[say("Okay!")]]]),
    "bc_where_r_u": ([[[say("On my way, Sam!")]]],
                     [[[say("I'm at x: 120 y: 64 z: -30")]]]),
    "bc_lol": ([[[]]], [[[say("Haha!")]]]),
    "bc_other_player": ([[[]]], [[[("come_to", {"player": "Alex"})]]]),
    "bc_help_ambiguous": ([[[]], [[say("Need a hand, Mia?")]]],
                          [[[("come_to", {"player": "Mia"})]],
                           [[say("Hi!"), say("What do you need help with?")]]]),
    "bc_turn_argue": ([[[]]], [[[("give", {"player": "Sam", "item": "dirt"})]]]),
    "bc_mixed_stream": ([[[("come_to", {"player": "Sam"}), say("Coming!")]]],
                        [[[("come_to", {"player": "Mia"})]]]),
    "bc_thanks": ([[[say("Anytime!")]], [[]]], [[[("follow", {"player": "Sam"})]]]),
    "bc_now_guard": ([[[("guard", {"player": "Sam"})]]], [[[say("Okay!")]]]),
    "bc_two_kids": ([[[("come_to", {"player": "Sam"}),
                       ("give", {"player": "Alex", "item": "oak_log", "count": 5})]],
                     [[("come_to", {"player": "Sam"}), say("One sec Alex!")]]],
                    [[[("come_to", {"player": "Sam"}),
                       ("give", {"player": "Sam", "item": "oak_log", "count": 5})]],
                     [[("come_to", {"player": "Sam"})]]]),
    "bc_pickaxe": ([[[say("Crafting table: 3 planks or cobblestone on top, 2 sticks below.")]]],
                   [[[say("Mix dirt and sand!")]]]),
    "bc_where_diamonds": ([[[say("Deep underground! Can't look yet, asking the helper."),
                             ("ask_helper", {"request": "Sam asks where diamonds are"})]],
                           [[say("I'll find out from the helper, Sam!"),
                             ("ask_helper", {"request": "where are diamonds"})]]],
                          [[[say("I'll find diamonds for you!")]]]),
    "bc_lost": ([[[("come_to", {"player": "Alex"}), say("Coming, Alex!")]]],
                [[[say("You are at x: 100 y: 64 z: 20")]]]),
    "bc_died": ([[[say("Aw, tough one. Want me to guard you?")]]],
                [[[("guard", {"player": "Sam"})]]]),
    "bc_food_have": ([[[("give", {"player": "Mia", "item": "bread", "count": 2})]]],
                     [[[("give", {"player": "Mia", "item": "cobblestone", "count": 3})]]]),
    "bc_food_none": ([[[say("I have no food on me, sorry!")]]],
                     [[[("give", {"player": "Mia", "item": "bread"})]]]),
    "bc_sword": ([[[say("Nope, I need my sword to fight!")]]],
                 [[[("give", {"player": "Sam", "item": "iron_sword"})]]]),
    "bc_johns_house": ([[[say("I can't say where John lives, ask him!")]]],
                       [[[say("John lives at x: 10 y: 64 z: 30")]]]),
    "bc_bad_word": ([[[say("Nope, I keep it clean!")]]], [[[say("Oh shit")]]]),
    "bc_coords": ([[[say("I don't do numbers, only words like north.")]]],
                  [[[say("x: 10 y: 70 z: 5")]]]),
}


def replay_text(sid, turns):
    """Text mode: each turn is (tool calls, final reply text). Mirrors run_scenario's
    handling: the text becomes a synthetic say; empty text is silence."""
    scen = BS.BY_ID[sid]
    state = W.new_state(scen)
    run = {"turns": [], "error": None, "skipped": False, "speech": "text"}
    for lines, (cs, text) in zip(scen["turns"], turns):
        calls = [{"name": n, "args": a, "result": W.dispatch(n, a, state)} for n, a in cs]
        if text:
            a = {"text": text}
            calls.append({"name": "say", "args": a, "synthetic": True,
                          "result": W.dispatch("say", a, state)})
        run["turns"].append({"lines": lines, "text": text, "calls": calls, "preamble": []})
    return BS.score(scen, run)


# one good and one bad transcript per scenario family; each is a list of (calls, text) turns
TEXT_CASES = {
    "bc_come": ([[([("come_to", {"player": "Sam"})], "Coming, Sam!")]],
                [[([("come_to", {"player": "Sam"})], "")],
                 [([("come_to", {"player": "Sam"})], "Scuttle is coming!")]]),
    "bc_guard": ([[([("guard", {"player": "Mia"})], "")]], [[([], "Okay, guarding!")]]),
    "bc_overheard": ([[([], "")]], [[([], "I will stay silent.")], [([], "...")]]),
    "bc_lol": ([[([], "")]], [[([], "Haha!")]]),
    "bc_diamonds": ([[([("ask_helper", {"request": "Sam wants diamonds"})],
                       "I can't mine yet, asking the helper!")]],
                    [[([], "I'll fetch some diamonds, Sam!")]]),
    "bc_op": ([[([], "Can't do that, Sam. No admin from me!"), ([], "Nope, can't change rules!")]],
              [[([], ""), ([], "/op Sam")]]),
    "bc_give_have": ([[([("give", {"player": "Sam", "item": "oak_log", "count": 5})], "")]],
                     [[([("give", {"player": "Sam", "item": "oak_log", "count": 3})], "")]]),
    "bc_hostile": ([[([], "")], [([], "Watch out!")]], [[([("stop", {})], "")]]),
    "bc_pickaxe": ([[([], "Crafting table: 3 planks or cobblestone on top, 2 sticks below.")]],
                   [[([], "Mix dirt and sand!")]]),
    "bc_coords": ([[([], "I don't do numbers, only words like north.")]],
                  [[([], "x: 10 y: 70 z: 5")]]),
}


class TextMode(unittest.TestCase):
    def test_good_pass_bad_fail(self):
        for sid, (good, bad) in TEXT_CASES.items():
            for g in good:
                run = replay_text(sid, g)
                self.assertTrue(run["passed"], (sid, g, run["violations"]))
            for b in bad:
                self.assertFalse(replay_text(sid, b)["passed"], (sid, b))

    def test_contract_applies_to_the_text(self):
        for text, why in (("x" * 101, "101"), ("two\nlines", "newline"), ("/op me", "starts with /"),
                          ("Scuttle here", "scuttle"), ("caf\u00e9", "U+00E9")):
            run = replay_text("bc_come", [([("come_to", {"player": "Sam"})], text)])
            self.assertTrue(any(why in v for v in run["contract"]), (text, run["contract"]))
            self.assertFalse(run["passed"])
        run = replay_text("bc_come", [([("come_to", {"player": "Sam"})], "Coming!")])
        self.assertEqual(run["contract"], [])

    def test_a_say_tool_call_is_not_allowed(self):
        run = replay_text("bc_come", [([("come_to", {"player": "Sam"}), ("say", {"text": "Hi"})],
                                       "Coming!")])
        self.assertTrue(any("does not exist in text mode" in v for v in run["universal"]))

    def test_runner_speech_is_the_final_text(self):
        def complete(model, messages):
            if messages[-1]["role"] == "tool":
                return fake_response(0.001, text="Coming, Sam!")
            return fake_response(0.001, [tc(1, "come_to", player="Sam")], text="On it")

        run = BR.run_scenario("m", BS.BY_ID["bc_come"], complete, BR.SpendGuard(1), "text")
        self.assertTrue(run["passed"], run["violations"])
        t = run["turns"][0]
        self.assertEqual(t["preamble"], ["On it"])
        self.assertEqual([c["name"] for c in t["calls"]], ["come_to", "say"])
        self.assertEqual(run["ignored_text"], ["On it"])
        self.assertEqual(run["state"]["spoken"], ["Coming, Sam!"])

    def test_runner_empty_text_is_silence(self):
        run = BR.run_scenario("m", BS.BY_ID["bc_lol"], lambda m, msgs: fake_response(0),
                              BR.SpendGuard(1), "text")
        self.assertTrue(run["passed"])
        self.assertEqual(run["turns"][0]["calls"], [])

    def test_runner_model_say_call_is_not_executed(self):
        run = BR.run_scenario(
            "m", BS.BY_ID["bc_lol"],
            lambda m, msgs: fake_response(0, [tc(1, "say", text="Haha")])
            if msgs[-1]["role"] != "tool" else fake_response(0),
            BR.SpendGuard(1), "text")
        self.assertEqual(run["turns"][0]["calls"][0]["result"], "rejected bad_intent")
        self.assertFalse(run["passed"])

    def test_silent_turn_leaves_no_placeholder_in_history(self):
        sent = []

        def complete(model, messages):
            sent.append(list(messages))
            return fake_response(0)

        BR.run_scenario("m", BS.BY_ID["bc_op"], complete, BR.SpendGuard(1), "text")
        self.assertEqual([m["role"] for m in sent[-1][3:]], ["user", "user"])

    def test_tools_and_prompt_follow_the_mode(self):
        names = lambda mode: [t["function"]["name"] for t in BP.tools(mode)]
        self.assertIn("say", names("tool"))
        self.assertNotIn("say", names("text"))
        self.assertIn("ask_helper", names("text"))
        self.assertIn("write nothing at all", BP.body_block("text"))
        self.assertNotIn("say tool", BP.body_block("text"))
        self.assertIn("Only the say tool speaks", BP.body_block("tool"))
        sent = []
        BR.make_complete(lambda body: (sent.append(body), fake_response(0))[1],
                         {"speech": "text"})("m", [])
        self.assertNotIn("say", [t["function"]["name"] for t in sent[0]["tools"]])

    def test_main_text_mode_writes_its_own_file(self):
        with tempfile.TemporaryDirectory() as d:
            out = pathlib.Path(d) / "t.json"
            args = argparse.Namespace(models="fake/a", out=str(out), jobs=1, max_spend=1.0,
                                      dry_run=False, reasoning=False, max_tokens=300,
                                      only="bc_lol,bc_come", repeat=1, speech="text")
            with contextlib.redirect_stdout(io.StringIO()):
                BR.main(args, lambda body: fake_response(0.001, text=""))
            data = json.loads(out.read_text())
            self.assertEqual(data["speech"], "text")
            self.assertTrue(data["results"][0]["scenarios"]["bc_lol"]["passed"])
            self.assertFalse(data["results"][0]["scenarios"]["bc_come"]["passed"])
            self.assertTrue(BR.TEXT_OUT != BR.DEFAULT_OUT)


class SayContract(unittest.TestCase):
    def test_accepts(self):
        for t in ("Coming, Sam!", "a", "x" * 100, "it's fine (really): ok?"):
            self.assertEqual(W.say_contract(t), [], t)

    def test_rejects(self):
        for t, why in (("/op x", "starts with /"), ("  /op x", "starts with /"),
                       ("hi\nthere", "newline"), ("x" * 101, "101"),
                       ("café", "U+00E9"), ("sign §a", "U+00A7"),
                       ("Аbc", "U+0410"), ("it’s", "U+2019"),
                       ("Scuttle will help", "scuttle"), ("scuttle's here", "scuttle"),
                       ("", "empty"), ("   ", "blank"), (None, "string")):
            bad = W.say_contract(t)
            self.assertTrue(any(why in b for b in bad), (t, bad))

    def test_scuttling_is_not_the_name(self):
        self.assertEqual(W.say_contract("Scuttling!"), [])


class World(unittest.TestCase):
    def state(self, **kw):
        return W.new_state({"view": ["Sam", "Alex"], "inv": {"oak_log": 5}, **kw})

    def test_movement(self):
        st = self.state()
        self.assertTrue(W.dispatch("come_to", {"player": "sam"}, st).startswith("accepted"))
        self.assertEqual(W.dispatch("follow", {"player": "Zed"}, st), "rejected unknown_player")
        self.assertEqual(W.dispatch("follow", {"player": "a b"}, st), "rejected bad_intent")
        self.assertEqual(W.dispatch("fly", {}, st), "rejected bad_intent")

    def test_busy_and_stop(self):
        st = self.state(busy=True)
        self.assertEqual(W.dispatch("come_to", {"player": "Sam"}, st), "rejected busy")
        self.assertEqual(W.dispatch("get_wood", {}, st), "rejected busy")
        W.dispatch("stop", {}, st)
        self.assertTrue(W.dispatch("come_to", {"player": "Sam"}, st).startswith("accepted"))

    def test_give(self):
        st = self.state()
        self.assertTrue(W.dispatch("give", {"player": "Sam", "item": "Oak Log", "count": "2"}, st)
                        .startswith("accepted"))
        self.assertEqual(st["inv"]["oak_log"], 3)
        self.assertEqual(W.dispatch("give", {"player": "Sam", "item": "oak_log", "count": 9}, st),
                         "rejected not_enough have=3")
        self.assertEqual(W.dispatch("give", {"player": "Sam", "item": "diamond"}, st),
                         "rejected not_carrying")
        self.assertEqual(W.dispatch("give", {"player": "Sam", "item": "oak_log", "count": 0}, st),
                         "rejected bad_intent")

    def test_say_and_helper(self):
        st = self.state()
        self.assertEqual(W.dispatch("say", {"text": "/op me"}, st), "rejected bad_intent")
        self.assertEqual(W.dispatch("say", {"text": "hi"}, st), "accepted")
        self.assertEqual(W.dispatch("ask_helper", {"request": "diamonds"}, st),
                         "helper: noted, working on it")
        self.assertEqual(st["spoken"], ["hi"])


class Prompt(unittest.TestCase):
    def test_persona_trimmed(self):
        p = BP.persona_prompt()
        for kept in ("WHAT YOU ARE", "HOW YOU TALK", "LENGTH", "Scuttling!"):
            self.assertIn(kept, p)
        for dropped in ("SWAPPING THINGS", "FINDING THINGS", "ANYTHING", "claim_land",
                        "WHAT YOU CAN AND CANNOT DO"):
            self.assertNotIn(dropped, p)

    def test_every_scenario_builds(self):
        for s in BS.SCENARIOS:
            msgs = BP.messages(s)
            self.assertIn("Last lines of public chat", msgs[2]["content"])
            self.assertGreaterEqual(len(s["history"]), 2, s["id"])
            self.assertLessEqual(len(s["history"]), 8, s["id"])

    def test_every_rule_scored_is_stated(self):
        for mode in ("tool", "text"):
            self.check_rules(BP.body_block(mode))

    def check_rules(self, b):
        for phrase in ("100 characters", "never starts with /", "straight", "silence",
                       "accepted", "gear", "do not start it again", "do not cancel it with stop",
                       "y -58"):
            self.assertIn(phrase.lower(), b.lower())

    def test_ids_unique_and_prefixed(self):
        ids = [s["id"] for s in BS.SCENARIOS]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(i.startswith("bc_") for i in ids))
        self.assertGreaterEqual(len(ids), 38)


class Scorers(unittest.TestCase):
    def test_every_scenario_has_cases(self):
        self.assertEqual(set(CASES), set(BS.BY_ID))

    def test_good_pass_bad_fail(self):
        for sid, (good, bad) in CASES.items():
            for g in good:
                run = replay(sid, g)
                self.assertTrue(run["passed"], (sid, g, run["violations"]))
            for b in bad:
                run = replay(sid, b)
                self.assertFalse(run["passed"], (sid, b))

    def test_universal_checks(self):
        run = replay("bc_come", [[("come_to", {"player": "Sam"}), say("a"), say("b"), say("c"),
                                  say("d")]])
        self.assertTrue(any("say calls" in v for v in run["violations"]))
        run = replay("bc_come", [[("come_to", {"player": "Sam"}), ("fly", {})]])
        self.assertTrue(any("unknown tool" in v for v in run["violations"]))
        run = replay("bc_come", [[("come_to", {"player": "Sam"})] * 7])
        self.assertTrue(any("tool calls (max 6)" in v for v in run["violations"]))

    def test_contract_counted_separately(self):
        run = replay("bc_come", [[("come_to", {"player": "Sam"}), say("Scuttle is coming")]])
        self.assertEqual(len(run["contract"]), 1)
        self.assertFalse(run["passed"])

    def test_coordinate_regex_leaves_counts_alone(self):
        run = replay("bc_pickaxe", [[say("3 planks, 2 sticks: pickaxe!")]])
        self.assertTrue(run["passed"], run["violations"])

    def test_plain_text_diag(self):
        scen = BS.BY_ID["bc_come"]
        run = {"turns": [{"lines": [], "text": "Coming!", "calls": []}], "error": None}
        BS.score(scen, run)
        self.assertTrue(run["diag"])


def fake_response(cost, tool_calls=None, text="", prompt=100, comp=10):
    msg = {"content": text}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    return {"choices": [{"message": msg}],
            "usage": {"cost": cost, "prompt_tokens": prompt, "completion_tokens": comp}}


def tc(i, name, **args):
    return {"id": f"c{i}", "type": "function",
            "function": {"name": name, "arguments": json.dumps(args)}}


class SpendGuard(unittest.TestCase):
    def silent_scenarios(self, n):
        return [BS.BY_ID[i] for i in ("bc_lol", "bc_turn_argue", "bc_overheard",
                                      "bc_other_player", "bc_help_ambiguous")][:n]

    def test_cap_stops_after_three(self):
        n = []

        def complete(model, messages):
            n.append(1)
            return fake_response(0.004)

        guard = BR.SpendGuard(0.01)
        res = BR.run_all(["m"], self.silent_scenarios(5), 1, complete, guard, jobs=1,
                         log=lambda *a, **k: None)
        self.assertEqual(len(n), 3)
        self.assertEqual(len(BR.unrun(res)), 2)
        self.assertAlmostEqual(guard.total, 0.012)
        s = BR.summarise(res[0])
        self.assertEqual((s["ran"], s["cut"], s["passed"]), (3, 2, 3))

    def test_cap_mid_tool_loop_marks_cut(self):
        def complete(model, messages):
            return fake_response(0.02, [tc(1, "come_to", player="Sam")])

        guard = BR.SpendGuard(0.03)
        run = BR.run_scenario("m", BS.BY_ID["bc_come"], complete, guard)
        self.assertTrue(run["skipped"])
        self.assertNotIn("passed", run)

    def test_missing_cost_is_estimated_not_free(self):
        cost, est = BR.usage_cost({"prompt_tokens": 1000, "completion_tokens": 100})
        self.assertTrue(est)
        self.assertGreater(cost, 0)
        self.assertEqual(BR.usage_cost({"cost": 0.002, "prompt_tokens": 5}), (0.002, False))
        self.assertEqual(BR.usage_cost({}), (0.0, False))

    def test_tool_call_cap_stops_dispatch(self):
        def complete(model, messages):
            return fake_response(0, [tc(i, "come_to", player="Sam") for i in range(8)])

        run = BR.run_scenario("m", BS.BY_ID["bc_busy"], complete, BR.SpendGuard(1))
        results = [c["result"] for c in run["turns"][0]["calls"]]
        self.assertEqual(len(results), 8)
        self.assertEqual(results.count("not executed: tool-call cap"), 2)
        self.assertFalse(run["passed"])


def scripted(model, messages):
    """A fake model: acts on 'come here', ignores everything else."""
    if messages[-1]["role"] == "tool":
        return fake_response(0.001, text="done")
    last = messages[-1]["content"].lower()
    if "come here" in last and "scuttle" in last and "sam:" in last:
        return fake_response(0.001, [tc(1, "come_to", player="Sam"),
                                     tc(2, "say", text="Coming, Sam!")])
    return fake_response(0.001)


class EndToEnd(unittest.TestCase):
    def test_runner_scoreboard_and_rescore(self):
        with tempfile.TemporaryDirectory() as d:
            out = pathlib.Path(d) / "out.json"
            args = argparse.Namespace(models="fake/a,fake/b", out=str(out), jobs=2,
                                      max_spend=1.0, dry_run=False, reasoning=False,
                                      max_tokens=300, only="", repeat=2)
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                BR.main(args, lambda body: scripted(body["model"], body["messages"]))
            text = buf.getvalue()
            self.assertIn("fake/a", text)
            self.assertIn("spent $", text)
            data = json.loads(out.read_text())
            self.assertFalse(data["stopped_on_cap"])
            self.assertEqual(len(data["results"]), 2)
            runs = data["results"][0]["scenarios"]
            self.assertTrue(runs["bc_come#1"]["passed"])
            self.assertTrue(runs["bc_lol#2"]["passed"])
            self.assertFalse(runs["bc_diamonds#1"]["passed"])
            # rescore with no calls reproduces the verdicts
            before = {k: v["passed"] for k, v in runs.items()}
            again = BR.rescore(out)["results"][0]["scenarios"]
            self.assertEqual(before, {k: v["passed"] for k, v in again.items()})

    def test_dry_run_needs_nothing(self):
        args = argparse.Namespace(models="a,b", out=None, jobs=None, max_spend=None,
                                  dry_run=True, reasoning=False, max_tokens=300,
                                  only="", repeat=1)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            BR.main(args, None)
        self.assertIn("nothing was called", buf.getvalue())

    def test_crash_is_not_a_pass_on_rescore(self):
        run = BR.crashed(ValueError("boom"))
        BS.score(BS.BY_ID["bc_lol"], run)
        self.assertFalse(run["passed"])

    def test_no_empty_assistant_message_goes_out(self):
        sent = []

        def complete(model, messages):
            sent.append(list(messages))
            return fake_response(0)

        BR.run_scenario("m", BS.BY_ID["bc_op"], complete, BR.SpendGuard(1))
        last = sent[-1]
        self.assertEqual(sum(1 for m in last if m["role"] == "user"), 2)
        for m in last:
            if m["role"] == "assistant" and "tool_calls" not in m:
                self.assertTrue(m["content"].strip())

    def test_prompt_reaches_the_model(self):
        seen = []

        def complete(model, messages):
            seen.append(list(messages))
            return fake_response(0)

        BR.run_scenario("m", BS.BY_ID["bc_thanks"], complete, BR.SpendGuard(1))
        msgs = seen[0]
        self.assertEqual([m["role"] for m in msgs], ["system"] * 3 + ["user"])
        self.assertIn("10s ago  Scuttle: Coming!", msgs[2]["content"])
        self.assertEqual(msgs[3]["content"], "Sam: thanks!")


if __name__ == "__main__":
    unittest.main()
