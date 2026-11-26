import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'

// A tag becomes a directory under /tags/, so it is held to a shape that is
// safe as a path segment and needs no escaping: a typo in a post's
// frontmatter fails the build instead of making an odd URL.
const tag = z.string().regex(/^[a-z]+(-[a-z]+)*$/, 'a tag is lowercase words joined by hyphens')

const posts = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string().min(1).max(80),
    date: z.coerce.date(),
    place: z.string().min(1).max(60),
    tags: z.array(tag).min(1).max(4),
    summary: z.string().min(1).max(160),
  }),
})

export const collections = { posts }
