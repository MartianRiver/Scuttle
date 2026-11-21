package com.martianriver.scuttle;

import com.martianriver.scuttle.agent.EmbodimentStatus;
import com.martianriver.scuttle.agent.History;
import com.martianriver.scuttle.agent.ScuttleAgent;
import com.martianriver.scuttle.chat.ChatListener;
import com.martianriver.scuttle.chat.ClaimTalk;
import com.martianriver.scuttle.chat.Engagement;
import com.martianriver.scuttle.chat.ReplyGate;
import com.martianriver.scuttle.chat.RecentChat;
import com.martianriver.scuttle.chat.ScuttleCommand;
import com.martianriver.scuttle.chat.Speech;
import com.martianriver.scuttle.claim.ClaimBook;
import com.martianriver.scuttle.claim.ClaimDesk;
import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.find.HunchDesk;
import com.martianriver.scuttle.find.Sources;
import com.martianriver.scuttle.guard.FightState;
import com.martianriver.scuttle.guard.GuardListener;
import com.martianriver.scuttle.lib.Log;
import com.martianriver.scuttle.llm.OpenRouterClient;
import com.martianriver.scuttle.log.AuditLog;
import com.martianriver.scuttle.persona.Lore;
import com.martianriver.scuttle.persona.PersonaBuilder;
import com.martianriver.scuttle.regions.Regions;
import com.martianriver.scuttle.regions.WorldGuardBridge;
import com.martianriver.scuttle.safety.BudgetTracker;
import com.martianriver.scuttle.safety.RateLimiter;
import com.martianriver.scuttle.chat.TradeTalk;
import com.martianriver.scuttle.tools.ToolRegistry;
import com.martianriver.scuttle.tools.impl.ClaimAbandonTool;
import com.martianriver.scuttle.tools.impl.ClaimAccessTool;
import com.martianriver.scuttle.tools.impl.ClaimLandTool;
import com.martianriver.scuttle.tools.impl.ClaimResizeTool;
import com.martianriver.scuttle.tools.impl.ListClaimsTool;
import com.martianriver.scuttle.tools.impl.FindOreTool;
import com.martianriver.scuttle.tools.impl.FindPlaceTool;
import com.martianriver.scuttle.tools.impl.AffordTool;
import com.martianriver.scuttle.tools.impl.BuyHaulTool;
import com.martianriver.scuttle.tools.impl.LookupItemTool;
import com.martianriver.scuttle.tools.impl.LookupRecipeTool;
import com.martianriver.scuttle.tools.impl.PriceCheckTool;
import com.martianriver.scuttle.tools.impl.ReadInventoryTool;
import com.martianriver.scuttle.tools.impl.SellItemTool;
import com.martianriver.scuttle.tools.impl.WhereToFindTool;
import com.martianriver.scuttle.trade.Coins;
import com.martianriver.scuttle.trade.ItemValues;
import com.martianriver.scuttle.trade.Shop;
import com.martianriver.scuttle.trade.Stash;
import com.martianriver.scuttle.trade.TradeDesk;
import com.martianriver.scuttle.trade.TradeGuard;
import org.bukkit.command.PluginCommand;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Wiring. Everything long-lived is built once here and handed its config;
 * {@link #reloadEverything()} rebuilds the config-derived parts in place so the
 * listener and command keep working without re-registering.
 */
public final class ScuttlePlugin extends JavaPlugin {

    private static final String MODULE = "plugin";

    private ScuttleConfig config;
    private Lore lore;
    private Speech speech;
    private History history;
    private RateLimiter limiter;
    private BudgetTracker budget;
    private ScuttleAgent agent;
    private ChatListener listener;
    private ScuttleCommand command;
    private AuditLog audit;
    private Stash stash;
    private TradeGuard guard;
    private Coins coins;
    private Regions regions;
    private Shop shop;
    private TradeDesk desk;
    private HunchDesk hunches;
    private Sources sources;
    private FindOreTool findOre;
    private FindPlaceTool findPlace;
    private Engagement engagement;
    private ReplyGate gate;
    private ClaimBook claimBook;
    private ClaimDesk claimDesk;
    private EmbodimentStatus embodiment;
    private FightState fightState;
    private GuardListener guardListener;

    @Override
    public void onEnable() {
        Log.bind(getLogger());
        saveDefaultConfig();
        config = ScuttleConfig.load(this);

        lore = new Lore(getDataFolder().toPath(), config);
        lore.writeDefaultIfMissing();

        speech = new Speech(config);
        history = new History(config);
        limiter = new RateLimiter(config);
        budget = new BudgetTracker(getDataFolder().toPath(), config);

        RecentChat recentChat = new RecentChat();
        audit = new AuditLog(getDataFolder().toPath(), config);

        // saveResource logs a warning of its own if the file is already there.
        if (!getDataFolder().toPath().resolve("values.yml").toFile().isFile()) {
            saveResource("values.yml", false);
        }
        if (!getDataFolder().toPath().resolve("sources.yml").toFile().isFile()) {
            saveResource("sources.yml", false);
        }
        sources = new Sources(getDataFolder().toPath().resolve("sources.yml").toFile());
        hunches = new HunchDesk(config);
        stash = new Stash(getDataFolder().toPath(), config);
        guard = new TradeGuard(ItemValues.build(getDataFolder().toPath().resolve("values.yml")),
                stash, config);
        coins = new Coins(config);
        coins.audit(guard);
        regions = regionLookup();
        shop = new Shop(regions, config);
        desk = new TradeDesk(getDataFolder().toPath(), stash, guard, coins, shop, config);
        TradeTalk tradeTalk = new TradeTalk(desk, speech, audit);
        engagement = new Engagement(config);

        claimBook = new ClaimBook(regions, config);
        claimDesk = new ClaimDesk(regions, claimBook, config);
        ClaimTalk claimTalk = new ClaimTalk(claimDesk, speech, audit);
        embodiment = new EmbodimentStatus();

        fightState = new FightState();
        guardListener = new GuardListener(config, fightState, regions);
        getServer().getPluginManager().registerEvents(guardListener, this);

        ToolRegistry tools = new ToolRegistry(this);
        tools.register(new LookupItemTool());
        tools.register(new LookupRecipeTool());
        if (config.tradeEnabled) {
            tools.register(new ReadInventoryTool(desk));
            tools.register(new PriceCheckTool(desk));
            tools.register(new SellItemTool(desk));
            tools.register(new BuyHaulTool(desk));
            tools.register(new AffordTool(desk));
        }
        if (config.findEnabled) {
            findOre = new FindOreTool(hunches, config);
            findPlace = new FindPlaceTool(hunches, config);
            tools.register(findOre);
            tools.register(findPlace);
            tools.register(new WhereToFindTool(sources));
        }
        if (config.claimsEnabled) {
            tools.register(new ClaimLandTool(claimBook, claimDesk));
            tools.register(new ListClaimsTool(claimBook));
            tools.register(new ClaimAccessTool(claimBook, regions));
            tools.register(new ClaimResizeTool(claimBook, claimDesk));
            tools.register(new ClaimAbandonTool(claimBook, claimDesk));
        }

        agent = new ScuttleAgent(this, config, new PersonaBuilder(config, lore),
                new OpenRouterClient(config), tools, history, limiter, budget,
                recentChat, speech, audit, desk, hunches, claimDesk, engagement, embodiment);
        gate = new ReplyGate(new OpenRouterClient(config), config, budget);

        listener = new ChatListener(this, agent, recentChat, tradeTalk, claimTalk, engagement,
                gate, config);
        getServer().getPluginManager().registerEvents(listener, this);

        command = new ScuttleCommand(this, agent, budget, limiter, tradeTalk, desk, claimTalk,
                claimBook, hunches, speech, embodiment, fightState, config);
        PluginCommand scuttle = getCommand("scuttle");
        if (scuttle != null) {
            scuttle.setExecutor(command);
            scuttle.setTabCompleter(command);
        } else {
            Log.error(MODULE, "the /scuttle command is missing from plugin.yml", null);
        }

        if (!config.hasApiKey()) {
            Log.warn(MODULE, "no OpenRouter API key found — Scuttle will stay quiet",
                    "looked in", "config.yml, environment, plugins/Scuttle/.env");
        }
        Log.info(MODULE, "enabled",
                "model", config.modelChat, "tools", tools.size(),
                "spent", String.format("$%.4f", budget.spent()));
    }

    @Override
    public void onDisable() {
        if (history != null) history.forgetAll();
        if (stash != null) stash.save();
        Log.info(MODULE, "disabled");
    }

    /**
     * WorldGuard if it's there, nothing if it isn't.
     *
     * <p>The class naming WorldGuard types is only loaded inside this branch, so
     * a server without the plugin never tries to resolve them. Trading then
     * happens anywhere, which {@link Shop} says out loud in the console.
     */
    private Regions regionLookup() {
        if (getServer().getPluginManager().getPlugin("WorldGuard") == null) {
            if (config.shopEnabled || config.claimsEnabled) {
                Log.warn(MODULE, "WorldGuard isn't installed, so the shop and land claims "
                        + "aren't tied to any region",
                        "fix", "install WorldGuard, or switch trade.shop / claims off");
            }
            return null;
        }
        try {
            Regions found = new WorldGuardBridge();
            Log.info(MODULE, "shop and claims using WorldGuard", "region", config.shopRegion);
            return found;
        } catch (Throwable e) {
            Log.error(MODULE, "WorldGuard is installed but wouldn't answer — "
                    + "trading anywhere instead", e);
            return null;
        }
    }

    /** Called by /scuttle reload. Rebuilds everything config touches. */
    public void reloadEverything() {
        config = ScuttleConfig.load(this);
        // Rebuilt rather than reloaded, so pointing lore.file at a different file works.
        lore = new Lore(getDataFolder().toPath(), config);
        speech.updateConfig(config);
        history.updateConfig(config);
        limiter.updateConfig(config);
        budget.updateConfig(config);
        listener.updateConfig(config);
        command.updateConfig(config);
        audit.updateConfig(config);
        stash.updateConfig(config);
        guard.rewire(ItemValues.build(getDataFolder().toPath().resolve("values.yml")), config);
        coins.updateConfig(config);
        coins.audit(guard);
        shop.updateConfig(config);
        desk.updateConfig(config);
        engagement.updateConfig(config);
        hunches.updateConfig(config);
        claimBook.updateConfig(config);
        claimDesk.updateConfig(config);
        guardListener.updateConfig(config);
        sources.reload();
        if (findOre != null) findOre.updateConfig(config);
        if (findPlace != null) findPlace.updateConfig(config);
        agent.rewire(config, new PersonaBuilder(config, lore), new OpenRouterClient(config));
        gate.rewire(new OpenRouterClient(config), config);
        Log.info(MODULE, "reloaded", "model", config.modelChat, "killSwitch", config.killSwitch);
    }
}
