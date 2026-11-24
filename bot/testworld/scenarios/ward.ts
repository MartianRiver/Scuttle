// A second offline player for scenarios that need someone else in the world. quit() is safe to call
// any number of times, and from cleanup after a failed join.
import mineflayer from "mineflayer";
import { mcPort } from "../slot";
import { sleep } from "./lib";

export class WardBot {
  private bot: mineflayer.Bot | null = null;

  constructor(readonly name = "Ward") {}

  async join(): Promise<void> {
    const bot = mineflayer.createBot({ host: "127.0.0.1", port: mcPort, username: this.name, auth: "offline" });
    this.bot = bot; // kept before spawn, so a join that times out is still quit by cleanup
    bot.on("error", () => {});
    bot.on("kicked", () => {});
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name} did not spawn within 20 s`)), 20_000);
      bot.once("spawn", () => {
        clearTimeout(timer);
        resolve();
      });
      bot.once("end", () => {
        clearTimeout(timer);
        reject(new Error(`${this.name}'s connection ended before it spawned`));
      });
    });
  }

  async quit(): Promise<void> {
    const bot = this.bot;
    this.bot = null;
    if (!bot) return;
    const ended = new Promise<void>((resolve) => bot.once("end", () => resolve()));
    bot.quit();
    // a socket that never closes must not hold the next scenario up
    await Promise.race([ended, sleep(5000)]);
  }
}
