// Pieces the scenario runner and the scenarios share: an RCON client, world facts read through it,
// and a client for the body API. Facts come from the server, never from the bot's own view.
import net from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const run = path.join(__dirname, "..", "..", "..", "run");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export { sleep };

export class Rcon {
  private sock!: net.Socket;
  private buf = Buffer.alloc(0);
  private waiting: Array<(body: string) => void> = [];
  private queue: Promise<unknown> = Promise.resolve();

  async connect(): Promise<void> {
    const password = readFileSync(path.join(run, ".rcon"), "utf8").trim();
    this.sock = net.connect(25576, "127.0.0.1");
    this.sock.on("data", (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      for (;;) {
        if (this.buf.length < 4) return;
        const size = this.buf.readInt32LE(0);
        if (this.buf.length < 4 + size) return;
        const id = this.buf.readInt32LE(4);
        const body = this.buf.subarray(12, 4 + size - 2).toString();
        this.buf = this.buf.subarray(4 + size);
        this.waiting.shift()?.(id === -1 ? "\u0000denied" : body);
      }
    });
    await new Promise<void>((res, rej) => this.sock.once("connect", res).once("error", rej));
    if ((await this.send(3, password)) === "\u0000denied") throw new Error("rcon login refused");
  }

  private send(kind: number, body: string): Promise<string> {
    const data = Buffer.from(body);
    const out = Buffer.alloc(14 + data.length);
    out.writeInt32LE(10 + data.length, 0);
    out.writeInt32LE(1, 4);
    out.writeInt32LE(kind, 8);
    data.copy(out, 12);
    return new Promise((res) => {
      this.waiting.push(res);
      this.sock.write(out);
    });
  }

  // one command at a time, replies come back in order
  command(cmd: string): Promise<string> {
    const next = this.queue.then(() => this.send(2, cmd));
    this.queue = next.catch(() => {});
    return next;
  }

  close(): void {
    this.sock.destroy();
  }
}

export type Pos = { x: number; y: number; z: number };
const xyz = (p: Pos) => `${p.x} ${p.y} ${p.z}`;

// Questions to the server about the world. A false `execute if` prints nothing over RCON, so every
// test here looks for "Test passed" and treats anything else as no.
export class World {
  constructor(readonly rcon: Rcon) {}

  run = (cmd: string) => this.rcon.command(cmd);

  async passes(cmd: string): Promise<boolean> {
    return (await this.run(cmd)).includes("Test passed");
  }

  blockIs = (p: Pos, block: string) => this.passes(`execute if block ${xyz(p)} ${block}`);

  async countBlocks(from: Pos, to: Pos, block: string): Promise<number> {
    const hits = await Promise.all(this.cells(from, to).map((c) => this.blockIs(c, block)));
    return hits.filter(Boolean).length;
  }

  cells(from: Pos, to: Pos): Pos[] {
    const out: Pos[] = [];
    for (let x = from.x; x <= to.x; x++)
      for (let y = from.y; y <= to.y; y++) for (let z = from.z; z <= to.z; z++) out.push({ x, y, z });
    return out;
  }

  async count(player: string, item: string): Promise<number> {
    const out = await this.run(`clear ${player} ${item} 0`);
    return Number(out.match(/Found (\d+)/)?.[1] ?? 0);
  }

  async chestCount(chest: Pos, item: string): Promise<number> {
    const out = await this.run(`data get block ${xyz(chest)} Items[{id:"minecraft:${item}"}].count`);
    return Number(out.match(/data: (\d+)\s*$/)?.[1] ?? 0);
  }

  async chestHasAny(chest: Pos): Promise<boolean> {
    return /following block data/.test(await this.run(`data get block ${xyz(chest)} Items[0]`));
  }

  async pos(player: string): Promise<number[]> {
    const out = await this.run(`data get entity ${player} Pos`);
    return (out.match(/-?[\d.]+(?=d)/g) ?? []).map(Number);
  }

  nearBlock = (player: string, p: Pos, dist: number) =>
    this.passes(`execute positioned ${xyz(p)} if entity @a[name=${player},distance=..${dist}]`);

  async health(player: string): Promise<number> {
    return Number((await this.run(`data get entity ${player} Health`)).match(/(-?[\d.]+)f\s*$/)?.[1] ?? NaN);
  }

  // deaths come from a server-side scoreboard counter, so a respawn can't hide one
  async trackDeaths(player: string): Promise<void> {
    await this.run("scoreboard objectives add deaths deathCount");
    await this.run(`scoreboard players set ${player} deaths 0`);
  }

  async deaths(player: string): Promise<number> {
    return Number((await this.run(`scoreboard players get ${player} deaths`)).match(/has (\d+)/)?.[1] ?? 0);
  }
}

export type Reply = { type: string; reason?: string; taskId?: string };
export type BodyEvent = { event: string; taskId?: string; reason?: string; [k: string]: unknown };

// The body API from the outside, as the real consumer sees it.
export class Body {
  events: BodyEvent[] = [];
  private replies = new Map<string, Reply>();
  private ws!: WebSocket;
  private ids = 0;

  async connect(): Promise<void> {
    const env = readFileSync(path.join(run, "bot.env"), "utf8");
    const token = env.match(/^API_TOKENS=[^:]+:(\S+)/m)?.[1];
    const port = env.match(/^API_PORT=(\d+)/m)?.[1] ?? "8787";
    if (!token) throw new Error("no API_TOKENS in run/bot.env; start testworld/bot.sh first");
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      this.ws.on("open", () => this.ws.send(JSON.stringify({ type: "auth", token })));
      this.ws.on("error", reject);
      this.ws.on("message", (raw) => {
        const m = JSON.parse(String(raw));
        if (m.type === "hello") resolve();
        else if (m.type === "event") this.events.push(m);
        else if (m.id) this.replies.set(m.id, m);
      });
    });
  }

  async send(intent: object): Promise<Reply> {
    const id = `s${++this.ids}`;
    this.ws.send(JSON.stringify({ type: "intent", id, ...intent }));
    for (let i = 0; i < 100 && !this.replies.has(id); i++) await sleep(20);
    return this.replies.get(id) ?? { type: "none" };
  }

  mark = () => this.events.length;

  async waitEvent(name: string, from: number, ms: number): Promise<BodyEvent | null> {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) {
      const hit = this.events.slice(from).find((e) => e.event === name);
      if (hit) return hit;
    }
    return null;
  }

  // a stopped task takes a moment to wind down, and until it has, `task` is busy
  async startTask(name = "get_wood"): Promise<boolean> {
    for (let i = 0; i < 8; i++) {
      if ((await this.send({ intent: "task", name })).type === "accepted") return true;
      await sleep(1000);
    }
    return false;
  }

  close(): void {
    this.ws.close();
  }
}

export interface Ctx {
  world: World;
  body: Body;
  bot: string;
  // record one assertion; the scenario fails if any is false
  check(ok: boolean, what: string): void;
  // a line in server chat, for anyone watching
  say(msg: string): Promise<unknown>;
}

export interface Scenario {
  name: string;
  timeoutMs?: number;
  // set while the body fails this today: reported as KNOWN-FAIL and not counted; a pass is flagged
  // so the scenario can move out of known-failing
  knownFailing?: string;
  // where a watcher is put (--watch)
  view?: Pos;
  // always runs after, pass or fail: put back whatever setup changed
  cleanup?(c: Ctx): Promise<void>;
  setup?(c: Ctx): Promise<void>;
  act(c: Ctx): Promise<void>;
  verify(c: Ctx): Promise<void>;
}
