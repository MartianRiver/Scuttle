package com.martianriver.scuttle.agent;

import com.martianriver.scuttle.chat.Engagement;
import com.martianriver.scuttle.chat.RecentChat;
import com.martianriver.scuttle.chat.Speech;
import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.find.Find;
import com.martianriver.scuttle.claim.ClaimDesk;
import com.martianriver.scuttle.find.HunchDesk;
import com.martianriver.scuttle.lib.Log;
import com.martianriver.scuttle.llm.ChatMessage;
import com.martianriver.scuttle.llm.LlmReply;
import com.martianriver.scuttle.llm.OpenRouterClient;
import com.martianriver.scuttle.llm.ToolCall;
import com.martianriver.scuttle.log.AuditLog;
import com.martianriver.scuttle.persona.PersonaBuilder;
import com.martianriver.scuttle.safety.BudgetTracker;
import com.martianriver.scuttle.safety.RateLimiter;
import com.martianriver.scuttle.tools.ToolRegistry;
import com.martianriver.scuttle.trade.Offer;
import com.martianriver.scuttle.trade.Pocket;
import com.martianriver.scuttle.trade.TradeDesk;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

/**
 * One question in, one reply out.
 *
 * <p>The shape of a turn: cheap refusals and world reads happen on the main
 * thread, the API call and tool loop happen off it, and the reply hops back to
 * speak. Nothing here talks to the world after {@link #ask} returns.
 */
public final class ScuttleAgent {

    private static final String MODULE = "agent";
    private static final int MAX_TOOL_ROUNDS = 3;

    private final Plugin plugin;
    private final ToolRegistry tools;
    private final History history;
    private final RateLimiter limiter;
    private final BudgetTracker budget;
    private final RecentChat recentChat;
    private final Speech speech;
    private final AuditLog audit;
    private final TradeDesk desk;
    private final HunchDesk hunches;
    private final ClaimDesk claims;
    private final Engagement engagement;
    private final EmbodimentStatus embodiment;
    private final Set<UUID> busy = java.util.Collections.synchronizedSet(new HashSet<>());

    // Rebuilt by /scuttle reload; the listener and command keep pointing here.
    private volatile ScuttleConfig config;
    private volatile PersonaBuilder persona;
    private volatile OpenRouterClient client;

    public ScuttleAgent(Plugin plugin, ScuttleConfig config, PersonaBuilder persona,
                        OpenRouterClient client, ToolRegistry tools, History history,
                        RateLimiter limiter, BudgetTracker budget, RecentChat recentChat,
                        Speech speech, AuditLog audit, TradeDesk desk, HunchDesk hunches,
                        ClaimDesk claims,
                        Engagement engagement, EmbodimentStatus embodiment) {
        this.plugin = plugin;
        this.config = config;
        this.persona = persona;
        this.client = client;
        this.tools = tools;
        this.history = history;
        this.limiter = limiter;
        this.budget = budget;
        this.recentChat = recentChat;
        this.speech = speech;
        this.audit = audit;
        this.desk = desk;
        this.hunches = hunches;
        this.claims = claims;
        this.engagement = engagement;
        this.embodiment = embodiment;
    }

    public void rewire(ScuttleConfig config, PersonaBuilder persona, OpenRouterClient client) {
        this.config = config;
        this.persona = persona;
        this.client = client;
    }

    /**
     * Entry point for both the command and the chat trigger. Main thread only —
     * it reads the world before handing off.
     */
    public void ask(Player player, String question) {
        UUID id = player.getUniqueId();

        if (budget.isSilenced()) {
            speech.say(player, silencedLine());
            audit.refusal(player.getName(), question, budget.silenceReason());
            return;
        }
        if (!config.hasApiKey()) {
            speech.say(player, "...nothing. No spark. Someone needs to give me my key.");
            Log.warn(MODULE, "no API key configured; refusing to call");
            return;
        }
        if (busy.contains(id)) {
            speech.say(player, "Hang on! Still thinking about the last one.");
            return;
        }

        RateLimiter.Decision decision = limiter.check(id);
        if (!decision.allowed()) {
            speech.say(player, rateLimitLine(decision));
            audit.refusal(player.getName(), question, decision.verdict().name());
            return;
        }

        WorldContext context = WorldContext.capture(player, recentChat.lines());
        // Reading the inventory here rather than letting the model ask for it saves
        // a whole round trip on every trading turn — see Pocket.
        Pocket pocket = (desk != null && config.tradeEnabled) ? Pocket.capture(player, desk) : null;

        speech.thinking(player);
        busy.add(id);
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                turn(player, id, question, context, pocket);
            } finally {
                busy.remove(id);
            }
        });
    }

    /** Runs off the main thread. Everything it touches is either a copy or thread-safe. */
    private void turn(Player player, UUID id, String question, WorldContext context,
                      Pocket pocket) {
        long started = System.currentTimeMillis();
        List<String> toolTrace = new ArrayList<>();

        // Order matters: the persona is byte-identical every call and carries the
        // cache breakpoint, so anything volatile has to come after it.
        List<ChatMessage> messages = new ArrayList<>();
        messages.add(ChatMessage.systemCached(persona.systemPrompt()));
        messages.add(ChatMessage.system(persona.contextPrompt(context)));
        if (pocket != null) messages.add(ChatMessage.system(pocket.render()));
        String embodimentStatus = embodiment.render();
        if (!embodimentStatus.isBlank()) messages.add(ChatMessage.system(embodimentStatus));
        messages.addAll(history.recall(id));
        messages.add(ChatMessage.user(question));

        double spent = 0;
        String model = "";
        int promptTokens = 0;
        int completionTokens = 0;
        int cachedTokens = 0;

        try {
            for (int round = 0; round <= MAX_TOOL_ROUNDS; round++) {
                LlmReply reply = client.complete(config.modelChat, messages, tools.schema());

                spent += reply.costUsd();
                budget.record(reply.costUsd());
                model = reply.model();
                promptTokens += reply.promptTokens();
                completionTokens += reply.completionTokens();
                cachedTokens += reply.cachedTokens();

                if (!reply.wantsTools() || round == MAX_TOOL_ROUNDS) {
                    String text = clean(reply.text());
                    if (text.isBlank()) text = "...I've lost my train of thought. Ask me again?";
                    speak(player, text);
                    history.remember(id, question, text);
                    audit.exchange(player.getName(), question, text, toolTrace, model,
                            promptTokens, completionTokens, cachedTokens, spent,
                            System.currentTimeMillis() - started);
                    return;
                }

                messages.add(ChatMessage.assistantToolCalls(reply.text(), reply.toolCalls()));
                for (ToolCall call : reply.toolCalls()) {
                    String result = tools.dispatch(player, call);
                    toolTrace.add(call.name() + " " + call.arguments() + " -> " + summarise(result));
                    messages.add(ChatMessage.toolResult(call.id(), result));
                }
            }
        } catch (OpenRouterClient.LlmException e) {
            Log.warn(MODULE, "turn failed", "player", player.getName(), "error", e.getMessage());
            speak(player, confusedLine());
            audit.refusal(player.getName(), question, "llm error: " + e.getMessage());
        } catch (RuntimeException e) {
            Log.error(MODULE, "unexpected failure during turn", e, "player", player.getName());
            speak(player, confusedLine());
        }
    }

    /**
     * Back on the main thread to talk. If the turn left a trade on the table,
     * the buttons go under it — the model asked for the offer, but the yes/no
     * belongs to the player and never passes back through the model.
     */
    private void speak(Player player, String text) {
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (!player.isOnline()) return;
            speech.say(player, text);
            // Scuttle just spoke to them, so their next line doesn't need its name.
            engagement.touch(player.getUniqueId());

            Offer offer = desk == null ? null : desk.pendingFor(player.getUniqueId());
            if (offer != null) speech.offerButtons(player, offer.describe(desk.coins()));

            Find hunch = hunches == null ? null : hunches.pendingFor(player.getUniqueId());
            if (hunch != null) speech.hunchButtons(player, hunch.what());

            ClaimDesk.Pending land =
                    claims == null ? null : claims.pendingFor(player.getUniqueId());
            if (land != null) speech.claimButtons(player, describe(land));
        });
    }

    private static String describe(ClaimDesk.Pending land) {
        return switch (land.kind()) {
            case CREATE -> "'" + land.label() + "', "
                    + land.proposal().width() + " blocks across";
            case RESIZE -> "'" + land.label() + "' resized to "
                    + land.proposal().width() + " blocks across";
            case ABANDON -> "give up '" + land.label() + "' — the buildings stay";
        };
    }

    /**
     * Models like to prefix replies with their own name or wrap them in
     * asterisks. Neither survives contact with chat.
     */
    private static String clean(String raw) {
        String text = raw == null ? "" : raw.trim();
        if (text.regionMatches(true, 0, "scuttle:", 0, 8)) {
            text = text.substring(8).trim();
        }
        return text.replace("\n", " ").replaceAll("\\s{2,}", " ");
    }

    private static String summarise(String result) {
        String oneLine = result.replace('\n', ' ');
        return oneLine.length() <= 120 ? oneLine : oneLine.substring(0, 120) + "…";
    }

    private String rateLimitLine(RateLimiter.Decision decision) {
        return switch (decision.verdict()) {
            case COOLDOWN -> "Puff — give me " + decision.retryAfterSeconds() + " seconds. Legs are short.";
            case PER_MINUTE -> "Too fast! I'm rattling. Try again in a minute.";
            case PER_DAY -> "That's all my hauling for today. Back tomorrow!";
            case ALLOW -> "";
        };
    }

    private String silencedLine() {
        return pick(
                "*rattle* ...empty. Ask a grown-up to top me up.",
                "No coal left in me today. Sorry!",
                "*hollow clank* Out of puff until next month.");
    }

    private String confusedLine() {
        return pick(
                "*clang* — sorry, dropped that thought entirely.",
                "Hang on, something went wrong in my head. Say it again?",
                "Rattle rattle... lost it. What were we saying?");
    }

    private static String pick(String... options) {
        return options[ThreadLocalRandom.current().nextInt(options.length)];
    }
}
