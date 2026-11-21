package com.martianriver.scuttle.chat;

import com.martianriver.scuttle.ScuttlePlugin;
import com.martianriver.scuttle.agent.EmbodimentStatus;
import com.martianriver.scuttle.agent.ScuttleAgent;
import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.find.HunchDesk;
import com.martianriver.scuttle.guard.FightState;
import com.martianriver.scuttle.safety.BudgetTracker;
import com.martianriver.scuttle.claim.ClaimBook;
import com.martianriver.scuttle.safety.RateLimiter;
import com.martianriver.scuttle.safety.Tier;
import com.martianriver.scuttle.tools.MaterialSearch;
import com.martianriver.scuttle.trade.Coins;
import com.martianriver.scuttle.trade.TradeDesk;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;

import java.util.List;
import java.util.Locale;

/**
 * {@code /scuttle <message>} to talk, plus {@code reload} and {@code status}
 * for the adult in the room.
 */
public final class ScuttleCommand implements CommandExecutor, TabCompleter {

    private final ScuttlePlugin plugin;
    private final ScuttleAgent agent;
    private final BudgetTracker budget;
    private final RateLimiter limiter;
    private final TradeTalk trade;
    private final ClaimTalk claims;
    private final ClaimBook book;
    private final TradeDesk desk;
    private final HunchDesk hunches;
    private final Speech speech;
    private final EmbodimentStatus embodiment;
    private final FightState fightState;
    private ScuttleConfig config;

    public ScuttleCommand(ScuttlePlugin plugin, ScuttleAgent agent, BudgetTracker budget,
                          RateLimiter limiter, TradeTalk trade, TradeDesk desk,
                          ClaimTalk claims, ClaimBook book,
                          HunchDesk hunches, Speech speech, EmbodimentStatus embodiment,
                          FightState fightState, ScuttleConfig config) {
        this.plugin = plugin;
        this.agent = agent;
        this.budget = budget;
        this.limiter = limiter;
        this.trade = trade;
        this.claims = claims;
        this.book = book;
        this.desk = desk;
        this.hunches = hunches;
        this.speech = speech;
        this.embodiment = embodiment;
        this.fightState = fightState;
        this.config = config;
    }

    public void updateConfig(ScuttleConfig config) {
        this.config = config;
    }

    /** Hands over the compass. The coordinate never went near the model. */
    private boolean takeHunch(Player player) {
        var find = hunches.pendingFor(player.getUniqueId());
        if (find == null) {
            speech.quietly(player, "lost the thread of that one. ask me again?");
            return true;
        }
        String problem = hunches.take(player);
        if (problem != null) {
            speech.say(player, problem);
            return true;
        }
        speech.say(player, "there. follow the needle — it points at the " + find.what() + ".");
        return true;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (args.length == 0) {
            sender.sendMessage(Component.text("Say something: /scuttle how do I make a hopper",
                    NamedTextColor.GRAY));
            return true;
        }

        String first = args[0].toLowerCase(Locale.ROOT);
        if (first.equals("reload")) return reload(sender);
        if (first.equals("status")) return status(sender);
        if (first.equals("price")) return price(sender, args);
        if (first.equals("embodiment")) return embodiment(sender, args);
        if (first.equals("guard")) return guard(sender, args);

        if (!(sender instanceof Player player)) {
            sender.sendMessage(Component.text("Scuttle only talks to players — it wants to know "
                    + "where you're standing.", NamedTextColor.GRAY));
            return true;
        }

        // The trade buttons run these. They never reach the model — the offer
        // being accepted is the one Java is holding, not one the model recalls.
        if (args.length == 1 && config.tradeEnabled) {
            if (first.equals("yes") || first.equals("accept")) {
                trade.accept(player);
                return true;
            }
            if (first.equals("no") || first.equals("decline")) {
                trade.decline(player);
                return true;
            }
        }
        if (args.length == 1 && config.claimsEnabled && claims != null) {
            if (first.equals("claim")) {
                claims.accept(player);
                return true;
            }
            if (first.equals("noclaim")) {
                claims.decline(player);
                return true;
            }
        }
        if (args.length == 1 && config.findEnabled) {
            if (first.equals("hunch")) return takeHunch(player);
            if (first.equals("nohunch")) {
                hunches.drop(player.getUniqueId());
                speech.quietly(player, "suit yourself.");
                return true;
            }
        }
        if (!config.commandEnabled) {
            sender.sendMessage(Component.text("The /scuttle command is switched off. Try saying "
                    + "its name in chat.", NamedTextColor.GRAY));
            return true;
        }

        agent.ask(player, String.join(" ", args));
        return true;
    }

    private boolean reload(CommandSender sender) {
        if (!allowed(sender)) return true;
        plugin.reloadEverything();
        sender.sendMessage(Component.text("Scuttle reloaded — config, lore and all.",
                NamedTextColor.GREEN));
        return true;
    }

    /**
     * {@code /scuttle embodiment <json>} — the bot (bot/) pushes its current task/location
     * here over RCON on every change. Console/RCON only, same gate as reload/status/price;
     * a player calling this from chat would just be lying about what the body is doing.
     */
    private boolean embodiment(CommandSender sender, String[] args) {
        if (!allowed(sender)) return true;
        if (args.length < 2) {
            sender.sendMessage(Component.text("/scuttle embodiment <json>", NamedTextColor.GRAY));
            return true;
        }
        String json = String.join(" ", java.util.Arrays.copyOfRange(args, 1, args.length));
        boolean ok = embodiment.updateFromJson(json);
        if (!ok) sender.sendMessage(Component.text("bad embodiment payload", NamedTextColor.RED));
        return true;
    }

    /**
     * {@code /scuttle guard fightstate} — bot/ polls this over RCON to find out
     * whether it should actually be fighting someone right now. Plain text
     * reply ({@code NONE} or {@code FIGHT:<name>}) rather than JSON: it's one
     * value, and RCON callers already get output back via sendMessage.
     */
    private boolean guard(CommandSender sender, String[] args) {
        if (!allowed(sender)) return true;
        if (args.length < 2 || !args[1].equalsIgnoreCase("fightstate")) {
            sender.sendMessage(Component.text("/scuttle guard fightstate", NamedTextColor.GRAY));
            return true;
        }
        String attacker = fightState.current();
        sender.sendMessage(Component.text(attacker == null ? "NONE" : "FIGHT:" + attacker));
        return true;
    }

    private boolean status(CommandSender sender) {
        if (!allowed(sender)) return true;
        sender.sendMessage(Component.text("Scuttle", NamedTextColor.GOLD));
        sender.sendMessage(line("model", config.modelChat));
        sender.sendMessage(line("api key", config.hasApiKey() ? "loaded" : "MISSING"));
        sender.sendMessage(line("prompt caching", config.promptCaching ? "on" : "off"));
        sender.sendMessage(line("spent this month",
                String.format("$%.4f of $%.2f", budget.spent(), config.monthlyCeilingUsd)));
        sender.sendMessage(line("silenced",
                budget.isSilenced() ? "yes — " + budget.silenceReason() : "no"));
        sender.sendMessage(line("shop", shopStatus()));
        sender.sendMessage(line("guard", guardStatus()));
        if (sender instanceof Player player) {
            sender.sendMessage(line("your messages today",
                    limiter.usedToday(player.getUniqueId()) + " of " + config.perDay));
            if (desk.shop().gated()) {
                sender.sendMessage(line("you are",
                        desk.shop().allows(player) ? "in the shop" : "outside the shop"));
            }
        }
        return true;
    }

    /** Worth printing: a gate that quietly isn't enforcing looks the same in game. */
    private String shopStatus() {
        if (!config.shopEnabled) return "off — trading anywhere";
        if (!desk.shop().gated()) return "WorldGuard missing — trading anywhere";
        return "region '" + desk.shop().regionName() + "'";
    }

    private String guardStatus() {
        if (!config.guardEnabled) return "off";
        String attacker = fightState.current();
        if (attacker != null) return "fighting " + attacker;
        return "watching " + config.guardBotUsername + " — idle";
    }

    /**
     * {@code /scuttle price <item> [count]} — what Scuttle thinks something is
     * worth and why. Works from the console, which is the only way to sanity-check
     * the derived price list without logging in.
     */
    private boolean price(CommandSender sender, String[] args) {
        if (!allowed(sender)) return true;
        if (args.length < 2) {
            sender.sendMessage(Component.text("/scuttle price <item> [how many]",
                    NamedTextColor.GRAY));
            return true;
        }
        int count = 1;
        int lastWord = args.length;
        if (args.length >= 3) {
            try {
                count = Math.max(1, Integer.parseInt(args[args.length - 1]));
                lastWord--;
            } catch (NumberFormatException ignored) {
                // a trailing word is part of the item name, not a quantity
            }
        }
        String query = String.join(" ", java.util.Arrays.copyOfRange(args, 1, lastWord));

        MaterialSearch.Match match = MaterialSearch.find(query);
        if (match == null) {
            sender.sendMessage(Component.text("No item called '" + query + "'.",
                    NamedTextColor.RED));
            return true;
        }
        Material m = match.material();

        sender.sendMessage(Component.text(count + "x " + MaterialSearch.pretty(m),
                NamedTextColor.GOLD));
        if (desk.values().banned(m)) {
            sender.sendMessage(line("status", "never traded"));
            return true;
        }
        Long unit = desk.values().value(m);
        if (unit == null) {
            sender.sendMessage(line("status", "no price — not in values.yml and not craftable"));
            return true;
        }
        sender.sendMessage(line("worth", unit + " credits each"));
        sender.sendMessage(line("costs them", desk.guard().costOf(m, count) + " credits"));
        sender.sendMessage(line("Scuttle pays", desk.guard().creditFor(m, count) + " credits"));
        sender.sendMessage(line("stash", desk.stash().describe(m, count)));
        // Worth saying out loud: which metals are money is the whole design, and
        // the numbers above are the ones the mint-safety windows are derived from
        // rather than a price anyone will ever be quoted.
        for (Coins.Denom d : desk.coins().denominations()) {
            if (d.material() != m) continue;
            sender.sendMessage(line("MONEY", "face value " + d.face()
                    + " — never bought or sold as goods"));
        }
        return true;
    }

    private boolean allowed(CommandSender sender) {
        if (!(sender instanceof Player player) || Tier.of(player) == Tier.PARENT) return true;
        sender.sendMessage(Component.text("That bit's for grown-ups.", NamedTextColor.RED));
        return false;
    }

    private static Component line(String key, String value) {
        return Component.text("  " + key + ": ", NamedTextColor.GRAY)
                .append(Component.text(value, NamedTextColor.WHITE));
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (args.length == 1 && sender.hasPermission(Tier.PARENT.node)) {
            return List.of("reload", "status", "price", "claims");
        }
        return List.of();
    }
}
