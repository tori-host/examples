// The frame of every page, the 404 included: the marker the live check looks
// for, the robots meta and the footer that says whose example this is.
import Link from 'next/link'
import { connection } from 'next/server'
import './globals.css'

const SOURCE = 'https://github.com/tori-host/examples/tree/main/saffron-wren'

export const metadata = {
  title: { default: 'saffron wren — a Next.js service on Tori', template: '%s — saffron wren' },
  description: 'An example Next.js service run by Tori, built from source without a Dockerfile, in Prague, EU.',
  icons: { icon: { url: '/favicon.svg', type: 'image/svg+xml' } },
}

export default async function RootLayout({ children }) {
  // Drawn for each request, never ahead of time: a page built at `next build`
  // has no request, so its scripts could not carry the nonce that proxy.js
  // puts in this response's Content-Security-Policy, and would be blocked.
  await connection()
  return (
    <html lang="en">
      <head>
        <meta name="robots" content="noindex" />
      </head>
      <body data-example="saffron-wren">
        <main>
          <header>
            <img src="/favicon.svg" alt="" width="36" height="36" />
            <h1>
              <Link href="/">saffron wren</Link>
            </h1>
            <span className="tag">Next.js service</span>
          </header>
          {children}
          <footer>
            <p>
              This is an example run by <a href="https://tori.host/">Tori</a>, in Prague, EU. The source is on{' '}
              <a href={SOURCE}>GitHub</a>.
            </p>
          </footer>
        </main>
      </body>
    </html>
  )
}
