// A strict Content-Security-Policy with a new nonce for every request. Next
// reads the nonce from the policy in the request headers and puts it on every
// script and style it writes into the page, so nothing inline runs without it
// and nothing from another origin runs at all. Runs on every path, so static
// files, the API and 404s carry the policy too.
import { NextResponse } from 'next/server'
import { findRecipe } from './lib/recipes.js'

export function contentSecurityPolicy(nonce, dev = false) {
  return [
    "default-src 'none'",
    // `next dev` evaluates code and injects styles without the nonce; a
    // production build does neither.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self'",
    // Only the error overlay of `next dev` loads fonts.
    `font-src ${dev ? "'self'" : "'none'"}`,
    // The router fetches the next page's data from this origin.
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** Whether the path is /recipes/<slug> with a slug that names no recipe. */
function unknownRecipe(pathname) {
  const [, slug] = /^\/recipes\/([^/]+)$/.exec(pathname) ?? []
  if (slug === undefined) return false
  try {
    return findRecipe(decodeURIComponent(slug)) === null
  } catch {
    return true
  }
}

export function proxy(request) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development')
  const headers = new Headers(request.headers)
  headers.set('Content-Security-Policy', policy)
  // A page that calls notFound() is sent as an empty shell that only the
  // browser's JavaScript fills in (Next 16.3 and 16.4), with no robots meta and nothing
  // to read without scripts. The 404 that Next draws for a path with no page
  // has neither problem, so an unknown recipe is sent there instead.
  const response = unknownRecipe(request.nextUrl.pathname)
    ? NextResponse.rewrite(new URL('/_not-found', request.url), { request: { headers } })
    : NextResponse.next({ request: { headers } })
  response.headers.set('Content-Security-Policy', policy)
  return response
}
