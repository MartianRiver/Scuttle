import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

export const topics = {
  safety: "Safety",
  setup: "Running it",
  using: "Using it",
} as const;

const guides = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/guides" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    topic: z.enum(["safety", "setup", "using"]),
    order: z.number().default(10),
    updated: z.coerce.date(),
    drafted: z.string().optional(),
  }),
});

const glossary = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/glossary" }),
  schema: z.object({
    term: z.string(),
    short: z.string(),
    see: z.array(z.string()).default([]),
    wiki: z.string().url().optional(),
  }),
});

const progress = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/progress" }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    date: z.coerce.date(),
    draft: z.boolean().default(false),
    drafted: z.string().optional(),
  }),
});

export const collections = { guides, progress, glossary };
