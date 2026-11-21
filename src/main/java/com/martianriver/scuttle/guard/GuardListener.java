package com.martianriver.scuttle.guard;

import com.martianriver.scuttle.config.ScuttleConfig;
import com.martianriver.scuttle.lib.Log;
import com.martianriver.scuttle.regions.Regions;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.projectiles.ProjectileSource;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The hit-escalation ladder — see config.yml's {@code guard:} block and
 * SCUTTLE.md §3 "Embodiment design" for the design. This is almost the whole
 * feature: the plugin already sees a player hit the {@code ScuttleMC} entity
 * as an ordinary {@link EntityDamageByEntityEvent}, same as any PvP hit, so
 * there's nothing to route through bot/ for detection — only the 3rd-hit
 * "keep fighting" order goes out, via {@link FightState} and
 * {@code /scuttle guard fightstate}.
 *
 * <p>Strike counts are per-attacker and in memory only — they reset on a
 * server restart, not on a timer. Config is swapped on {@code /scuttle
 * reload} same as every other listener; the strike/cooldown maps are not.
 */
public final class GuardListener implements Listener {

    private static final String MODULE = "guard";

    private final FightState fightState;
    private final Regions regions;
    private ScuttleConfig config;

    private final Map<UUID, Integer> strikes = new ConcurrentHashMap<>();
    private final Map<UUID, Long> lastIncident = new ConcurrentHashMap<>();

    public GuardListener(ScuttleConfig config, FightState fightState, Regions regions) {
        this.config = config;
        this.fightState = fightState;
        this.regions = regions;
    }

    public void updateConfig(ScuttleConfig config) {
        this.config = config;
        fightState.clear();
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onHit(EntityDamageByEntityEvent event) {
        if (!config.guardEnabled) return;

        Entity victimEntity = event.getEntity();
        if (!(victimEntity instanceof Player victim)) return;
        if (!victim.getName().equals(config.guardBotUsername)) return;

        Player attacker = resolveAttacker(event.getDamager());
        if (attacker == null) return;

        long fightTimeoutMillis = config.guardFightTimeoutSeconds * 1000L;

        if (attacker.hasPermission("scuttle.guard.exempt")) {
            fightState.refresh(attacker.getName(), fightTimeoutMillis);
            return;
        }

        UUID id = attacker.getUniqueId();
        long now = System.currentTimeMillis();
        long cooldownMillis = config.guardCooldownSeconds * 1000L;
        Long last = lastIncident.get(id);
        boolean newIncident = last == null || now - last >= cooldownMillis;

        int strike = strikes.getOrDefault(id, 0);
        if (newIncident) {
            strike = Math.min(strike + 1, 3);
            strikes.put(id, strike);
            lastIncident.put(id, now);
        }

        if (strike >= 3) {
            // A real fight now — Scuttle stops intercepting and just takes the
            // hit, same as any player would. bot/ picks this up via fightstate.
            fightState.refresh(attacker.getName(), fightTimeoutMillis);
            return;
        }

        event.setCancelled(true);
        if (!newIncident) return; // already answered this flurry; just absorb the rest of it

        if (strike == 2) {
            attacker.damage(config.guardFightBackDamage, victim);
        }

        boolean landed = Shove.push(attacker, victim.getLocation(), config.guardShoveBlocks,
                regions, config.claimPrefix);
        Log.debug(MODULE, "hit-escalation triggered", "attacker", attacker.getName(),
                "strike", strike, "shoved", landed);
    }

    private static Player resolveAttacker(Entity damager) {
        if (damager instanceof Player player) return player;
        if (damager instanceof Projectile projectile) {
            ProjectileSource source = projectile.getShooter();
            if (source instanceof Player player) return player;
        }
        return null;
    }
}
