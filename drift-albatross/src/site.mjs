// What every page of the journal says about itself. These are plain strings
// in a .mjs file, not markup in a .astro one, for two readers: the layout
// writes them into each page as they are, and the repository's own test reads
// .mjs files (not .astro) to find them in the source. test/site.test.mjs then
// holds every built page to the same strings.

export const NAME = 'drift-albatross'

/** What examples.json's live check looks for on the page, on <body>. */
export const CHECK = 'data-example="drift-albatross"'

export const SOURCE = 'https://github.com/tori-host/examples/tree/main/drift-albatross'

// Written into <head> with set:html, so the built page carries this exact
// text: Astro would otherwise print a void element without its slash.
export const ROBOTS = '<meta name="robots" content="noindex" />'

export const FOOTER = `This is an example run by <a href="https://tori.host/">Tori</a>, in Prague, EU. The journal and its trips are made up. The source is on <a href="${SOURCE}">GitHub</a>.`

export const TITLE = 'drift albatross'
export const TAGLINE = 'A travel journal: slow trains and long walks in Central Europe.'
