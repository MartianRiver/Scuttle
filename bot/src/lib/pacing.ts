// How fast the body may react, in one place. Reflexes act at human speed, not instantly (River,
// 2026-11-22, roadmap 0.4.8); the numbers are placeholders to tune by measuring.
export const pacing = {
  tickMs: 250, // how often the body looks around
  reactionMs: 350, // before answering a threat that just appeared
  reactionJitterMs: 150,
};

export function reactionDelay(random: () => number = Math.random): number {
  return pacing.reactionMs + (random() * 2 - 1) * pacing.reactionJitterMs;
}
