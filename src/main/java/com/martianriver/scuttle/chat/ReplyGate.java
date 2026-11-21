package com.martianriver.scuttle.chat;

import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.lib.Log;
import com.martianriver.scuttle.llm.ChatMessage;
import com.martianriver.scuttle.llm.LlmReply;
import com.martianriver.scuttle.llm.OpenRouterClient;
import com.martianriver.scuttle.safety.BudgetTracker;

import java.util.List;
import java.util.Locale;

/**
 * Whether a nameless message inside the follow-on window was actually meant for
 * Scuttle.
 *
 * <p>Only nameless ones. Saying "scuttle" is a statement of intent and always
 * gets an answer — putting a classifier in front of that would slow down every
 * real question to catch the rare "scuttle is being weird lol". The follow-on
 * window is different: it fires on anything a player types for 45 seconds, so
 * without a gate Scuttle joins in on kid-to-kid chat and bills for it.
 *
 * <p>The gate costs a small fast call against a real chat turn, so it pays for
 * itself the first time it says no. It fails <em>open</em>: if the classifier
 * errors, the message goes through, which is what happened before this existed.
 */
public final class ReplyGate {

    private static final String MODULE = "gate";
    private static final int MAX_TOKENS = 4;

    private static final String RULES = """
            You decide whether a talking bucket called Scuttle should answer a \
            message in a Minecraft chat. Scuttle just replied to this player, so \
            they are mid-conversation and did not have to say its name.

            Answer YES if the message is aimed at Scuttle: a question, a reply to \
            what it just said, a request, thanks, or small talk directed at it.
            Answer NO if the player is clearly talking to another player, thinking \
            out loud, narrating what they are doing, or talking ABOUT Scuttle \
            rather than TO it.

            When it could plausibly be either, answer YES — a bucket that ignores \
            a child is worse than one that chimes in.

            Reply with exactly one word: YES or NO.""";

    private final BudgetTracker budget;
    private volatile OpenRouterClient client;
    private volatile ScuttleConfig config;

    public ReplyGate(OpenRouterClient client, ScuttleConfig config, BudgetTracker budget) {
        this.client = client;
        this.config = config;
        this.budget = budget;
    }

    public void rewire(OpenRouterClient client, ScuttleConfig config) {
        this.client = client;
        this.config = config;
    }

    /** Off the main thread — this makes a network call. */
    public boolean wanted(String playerName, String message, List<String> recentChat) {
        if (!config.followOnClassify) return true;

        StringBuilder ask = new StringBuilder(300);
        if (!recentChat.isEmpty()) {
            ask.append("The last few lines of chat:\n");
            for (String line : recentChat) {
                ask.append(line).append('\n');
            }
            ask.append('\n');
        }
        ask.append(playerName).append(" just said: ").append(message);

        try {
            LlmReply reply = client.complete(config.modelClassify,
                    List.of(ChatMessage.system(RULES), ChatMessage.user(ask.toString())),
                    null, MAX_TOKENS);
            budget.record(reply.costUsd());

            String verdict = reply.text() == null ? "" : reply.text().trim().toLowerCase(Locale.ROOT);
            boolean yes = !verdict.startsWith("no");
            Log.debug(MODULE, "follow-on judged", "player", playerName,
                    "verdict", verdict.isBlank() ? "(blank)" : verdict, "reply", yes);
            return yes;
        } catch (OpenRouterClient.LlmException | RuntimeException e) {
            // Fail open: this is exactly how the window behaved before the gate.
            Log.warn(MODULE, "classifier failed, letting it through", "error", e.getMessage());
            return true;
        }
    }
}
