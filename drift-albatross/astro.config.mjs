import { defineConfig } from 'astro/config'

// No adapter, and none may be added: with no adapter Astro writes files to
// dist/, and that is what makes this a static site to the Tori CLI. An
// adapter such as @astrojs/node would make it a server, and the CLI would
// build it as a service instead.
export default defineConfig({
  // The feed's links are absolute, so they need the address the site is
  // served at. A copy deployed under another name changes this line.
  site: 'https://drift-albatross.tori.cloud',
  build: {
    // /tags/rail/ is written as tags/rail/index.html. Tori answers a path
    // that names no file with that directory's index.html, so both /tags/rail
    // and /tags/rail/ work. This is Astro's default, spelled out because the
    // hosting depends on it.
    format: 'directory',
    // One stylesheet file for every page, cached once, rather than a copy
    // in each page when it happens to be small.
    inlineStylesheets: 'never',
  },
})
