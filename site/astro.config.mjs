import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";

export default defineConfig({
  site: "https://scuttle.martianriver.com",
  output: "static",
  integrations: [mdx()],
  trailingSlash: "always",
  build: { format: "directory" },
  devToolbar: { enabled: false },
});
