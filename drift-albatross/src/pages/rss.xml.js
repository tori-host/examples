import rss from '@astrojs/rss'
import { getCollection } from 'astro:content'
import { newestFirst } from '../journal.mjs'
import { TAGLINE, TITLE } from '../site.mjs'

// Written to dist/rss.xml at build time, like every other page: an endpoint
// in a static build is a file, not code that runs when the feed is asked for.
export async function GET(context) {
  const posts = newestFirst(await getCollection('posts'))
  return rss({
    title: TITLE,
    description: TAGLINE,
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.summary,
      categories: post.data.tags,
      link: `/posts/${post.id}/`,
    })),
  })
}
