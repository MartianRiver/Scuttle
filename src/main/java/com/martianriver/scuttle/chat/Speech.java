package com.martianriver.scuttle.chat;

import com.martianriver.scuttle.config.ScuttleConfig;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.event.HoverEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.SoundCategory;
import org.bukkit.entity.Player;

/**
 * How Scuttle appears in chat: sooty grey prefix, ember orange name, and a
 * metallic clank every time it speaks.
 *
 * <p>The sensory identity is cheap and disproportionately effective, which
 * is why it shipped early.
 */
public final class Speech {

    private ScuttleConfig config;

    public Speech(ScuttleConfig config) {
        this.config = config;
    }

    public void updateConfig(ScuttleConfig config) {
        this.config = config;
    }

    /** Must run on the main thread — playSound isn't safe off it. */
    public void say(Player player, String text) {
        player.sendMessage(line(text));
        if (config.speechSound != null) {
            player.playSound(player.getLocation(), config.speechSound, SoundCategory.NEUTRAL,
                    config.speechVolume, config.speechPitch);
        }
    }

    /** Same colours, no sound — for "thinking…" and other bookkeeping. */
    public void quietly(Player player, String text) {
        player.sendMessage(line(text).decorate(TextDecoration.ITALIC));
    }

    /**
     * A rattle the instant a question lands, before the API call goes out.
     *
     * <p>It saves no time at all — a four-tool turn still takes as long as it
     * takes. It's the difference between Scuttle thinking and Scuttle ignoring
     * you, which is the half of "slow" that actually annoys people. Action bar
     * rather than chat so a conversation doesn't end up double-spaced.
     */
    public void thinking(Player player) {
        player.sendActionBar(Component.text("Scuttle is rummaging…", config.nameColor)
                .decorate(TextDecoration.ITALIC));
        if (config.speechSound != null) {
            player.playSound(player.getLocation(), config.speechSound, SoundCategory.NEUTRAL,
                    config.speechVolume * 0.4f, config.speechPitch * 0.8f);
        }
    }

    /**
     * The yes/no under a trade offer. Clicking runs the command, so accepting a
     * swap never goes back through the model — the offer the player sees and the
     * one Java executes are the same object.
     */
    public void offerButtons(Player player, String summary) {
        player.sendMessage(Component.text("    " + summary, config.textColor)
                .decorate(TextDecoration.ITALIC));
        player.sendMessage(Component.text("    ")
                .append(button("[ Yes please! ]", NamedTextColor.GREEN, "/scuttle yes",
                        "Do the swap"))
                .append(Component.text("   "))
                .append(button("[ No thanks ]", NamedTextColor.RED, "/scuttle no",
                        "Leave it")));
    }

    /**
     * The yes/no under a hunch. Same shape as a trade offer on purpose — a kid
     * shouldn't have to learn two ways of saying yes to Scuttle.
     */
    public void hunchButtons(Player player, String what) {
        player.sendMessage(Component.text("    a hunch pointing at " + what, config.textColor)
                .decorate(TextDecoration.ITALIC));
        player.sendMessage(Component.text("    ")
                .append(button("[ Yes please! ]", NamedTextColor.GREEN, "/scuttle hunch",
                        "Take the compass"))
                .append(Component.text("   "))
                .append(button("[ No thanks ]", NamedTextColor.RED, "/scuttle nohunch",
                        "Leave it")));
    }

    /**
     * The yes/no under a piece of land. Third one of these, same shape as the
     * other two — the answer a kid gives Scuttle should never depend on what
     * they're saying yes to.
     */
    public void claimButtons(Player player, String summary) {
        player.sendMessage(Component.text("    " + summary, config.textColor)
                .decorate(TextDecoration.ITALIC));
        player.sendMessage(Component.text("    ")
                .append(button("[ Yes please! ]", NamedTextColor.GREEN, "/scuttle claim",
                        "Fence it off"))
                .append(Component.text("   "))
                .append(button("[ No thanks ]", NamedTextColor.RED, "/scuttle noclaim",
                        "Leave it open")));
    }

    private static Component button(String label, NamedTextColor color, String command,
                                    String tooltip) {
        return Component.text(label, color, TextDecoration.BOLD)
                .clickEvent(ClickEvent.runCommand(command))
                .hoverEvent(HoverEvent.showText(Component.text(tooltip)));
    }

    private Component line(String text) {
        return Component.text(config.prefix + " ", config.prefixColor)
                .append(Component.text("Scuttle: ", config.nameColor))
                .append(Component.text(text, config.textColor));
    }
}
