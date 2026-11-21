package com.martianriver.scuttle.chat;

import com.martianriver.scuttle.agent.ScuttleAgent;
import com.martianriver.scuttle.config.ScuttleConfig;
import io.papermc.paper.event.player.AsyncChatEvent;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.plugin.Plugin;

import java.util.List;
import java.util.Locale;

/**
 * Watches ordinary chat for Scuttle's name, and keeps the last few lines so
 * Scuttle has some idea what the conversation is about (SCUTTLE.md §8).
 *
 * <p>Paper's chat event fires off the main thread, so nothing here touches the
 * world — it hands straight back to the scheduler.
 */
public final class ChatListener implements Listener {

    private final Plugin plugin;
    private final ScuttleAgent agent;
    private final RecentChat recentChat;
    private final TradeTalk trade;
    private final ClaimTalk claims;
    private final Engagement engagement;
    private final ReplyGate gate;
    private ScuttleConfig config;

    public ChatListener(Plugin plugin, ScuttleAgent agent, RecentChat recentChat, TradeTalk trade,
                        ClaimTalk claims,
                        Engagement engagement, ReplyGate gate, ScuttleConfig config) {
        this.plugin = plugin;
        this.agent = agent;
        this.recentChat = recentChat;
        this.trade = trade;
        this.claims = claims;
        this.engagement = engagement;
        this.gate = gate;
        this.config = config;
    }

    public void updateConfig(ScuttleConfig config) {
        this.config = config;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onChat(AsyncChatEvent event) {
        Player player = event.getPlayer();
        String text = PlainTextComponentSerializer.plainText().serialize(event.message()).trim();

        recentChat.add(player.getName(), text);

        // A bare "yes" while an offer is up is an answer, not a conversation.
        // Handling it here keeps a swap from costing an API call, and means kids
        // who don't click buttons still get the obvious thing to work.
        //
        // Trades and land can both be on the table at once, so the newer one
        // wins — that's the one they were just told about, and it's what "yes"
        // means to a person. Without this, asking for land while a trade offer
        // sat unanswered would spend their coins instead.
        boolean tradeUp = config.tradeEnabled && trade.hasOffer(player);
        boolean landUp = config.claimsEnabled && claims != null && claims.hasOffer(player);
        if (tradeUp || landUp) {
            Boolean answer = trade.readAnswer(text);
            if (answer != null) {
                boolean land = landUp && (!tradeUp
                        || claims.pendingSince(player) > trade.pendingSince(player));
                Bukkit.getScheduler().runTask(plugin, () -> {
                    if (land) {
                        if (answer) claims.accept(player); else claims.decline(player);
                    } else if (answer) {
                        trade.accept(player);
                    } else {
                        trade.decline(player);
                    }
                });
                return;
            }
        }

        if (!config.nameMentionEnabled) return;
        if (text.length() < config.minMessageLength) return;

        // Saying the name is intent, and gets an answer with nothing in the way.
        if (mentionsScuttle(text)) {
            Bukkit.getScheduler().runTask(plugin, () -> agent.ask(player, text));
            return;
        }
        if (!followingOn(player, text)) return;

        // A nameless message only *might* be for Scuttle, so it gets judged first.
        // The event thread must not block on a network call, hence the hop out and
        // back: classify off-thread, then start the turn on the main thread because
        // it reads the world.
        List<String> recent = recentChat.lines();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            if (!gate.wanted(player.getName(), text, recent)) return;
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (player.isOnline()) agent.ask(player, text);
            });
        });
    }

    /** Mid-conversation, the name is optional — see {@link Engagement}. */
    private boolean followingOn(Player player, String text) {
        return engagement.engaged(player.getUniqueId())
                && !Engagement.aimedAtSomeoneElse(player, text);
    }

    private boolean mentionsScuttle(String text) {
        String lower = text.toLowerCase(Locale.ROOT);
        for (String name : config.triggerNames) {
            int at = lower.indexOf(name);
            while (at >= 0) {
                // "scuttling" and "discuttle" shouldn't trigger; "scuttle," should.
                boolean beforeOk = at == 0 || !Character.isLetterOrDigit(lower.charAt(at - 1));
                int end = at + name.length();
                boolean afterOk = end >= lower.length() || !Character.isLetterOrDigit(lower.charAt(end));
                if (beforeOk && afterOk) return true;
                at = lower.indexOf(name, at + 1);
            }
        }
        return false;
    }
}
