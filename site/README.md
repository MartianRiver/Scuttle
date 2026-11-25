# Site

Source for the Scuttle site: a landing page, guides, and a progress blog. It builds to plain static files.

```
npm ci
npm run build     # output in dist/, one folder per page (guides/foo/index.html)
npm run dev       # local preview
```

Astro with content collections. No web fonts, and one tiny script (in `Term.astro`) that opens glossary popovers, light and dark through `prefers-color-scheme`. Internal links all end in `/` so a server doing `try_files $uri $uri/ =404` serves them without a redirect. `dist/404.html` is built but only used once the server is told to serve it.

## Writing

- A guide is a markdown file in `src/content/guides/`. `topic` is one of the keys in `src/content.config.ts`.
- A progress post is an `.mdx` file in `src/content/progress/` (so it can use terms too). `draft: true` leaves it out of every page and the feed.
- `drafted` in a guide's or post's front matter (a model name) adds a drafted-by credit above the licence block. Leave it out of anything written by hand.
- Every guide and post ends with the licence block and a credit line, from `src/components/Licence.astro`.

## Glossary

One entry per term in `src/content/glossary/` (`term`, `short`, optional `see` and `wiki`, and a body). In a guide or post (`.mdx`), write `<Term id="block">block</Term>`: the build fails on an unknown id. Each use is a link to `/glossary/<id>/` that opens the short text in a native popover when JavaScript and the Popover API are there (tap, Enter, Escape or tap outside to close, focus returns to the link), and stays a plain link otherwise.

## Screenshots and clips

Put files in `public/media/<post>/` and use the markup in `sample-clip-and-screenshot.mdx` (void tags like `<img>` are self-closed, since it's MDX). They come from the local test world only.

Screenshots as JPEG, 1280 wide, around 100 to 200 KB. Clips as H.264, 10 seconds or so, no audio, with a poster frame:

```
ffmpeg -i in.mov -vf scale=1280:-2 -an -c:v libx264 -crf 28 -preset slow -movflags +faststart out.mp4
ffmpeg -i out.mp4 -frames:v 1 -q:v 4 poster.jpg
```

That's roughly 0.3 to 1 MB per 10-second clip. Keep the whole site under about 20 MB. Past that, clips shouldn't live in git: put them on separate static storage and link them from the posts, or link a hosted video.

## Licence

`src/content/` is CC BY 4.0 (`src/content/LICENSE` is its text). The code here is Apache-2.0.
