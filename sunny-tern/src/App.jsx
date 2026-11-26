import { useEffect, useState } from 'react'
import { BIRDS, STORAGE_KEY, load, save, step, total } from './tally.js'

const SOURCE = 'https://github.com/tori-host/examples/tree/main/sunny-tern'

// Reading `window.localStorage` itself throws where a browser blocks storage
// for the site; the tally then lasts as long as the page, and says so.
function browserStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

// Two pages and no router library: the path picks the page, and a link moves
// between them with the History API. Opening /about directly works too,
// because Tori answers a path that names no file with index.html, and this
// script then reads the path. That is what makes it a single-page app.
const PAGES = { '/': 'tally', '/about': 'about' }
const pageOf = (path) => PAGES[path] ?? 'missing'

function usePath() {
  const [path, setPath] = useState(() => window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const go = (to) => (event) => {
    // A click that asks for a new tab or window is the browser's to handle.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    window.history.pushState(null, '', to)
    setPath(to)
    window.scrollTo(0, 0)
  }
  return [path, go]
}

// The tally lives in App, not in the page that shows it: moving to the other
// page and back must not lose counts a browser that keeps nothing still holds.
//
// Another tab of the app keeps the same tally. So a change starts from what
// the browser holds now, not from what this tab read when it opened, and a
// change saved in another tab is shown here as it happens.
// Where the browser keeps nothing, this tab's own counts are all there is.
//
// Only this tab's own clicks write. A tally shown because another tab changed
// it is not written back: by the time it would be, the other tab may have
// counted again, and the copy would undo that.
function useTally() {
  const [tally, setTally] = useState(() => load(browserStorage()))
  const [kept, setKept] = useState(true)
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === STORAGE_KEY) setTally(load(browserStorage()))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const change = (id, by) => {
    const storage = browserStorage()
    const next = step(kept && storage ? load(storage) : tally, id, by)
    setKept(save(storage, next))
    setTally(next)
  }
  return { tally, kept, change }
}

function Tally({ tally, kept, change }) {
  return (
    <>
      <p className="lead">Count the birds on a walk. The tally stays in this browser, and nothing is sent anywhere.</p>
      <ul className="tally">
        {BIRDS.map((bird) => (
          <li key={bird.id} className="card row">
            <span className="name">{bird.name}</span>
            <button type="button" onClick={() => change(bird.id, -1)} aria-label={`One fewer ${bird.name}`}>
              −
            </button>
            <output aria-live="polite" aria-label={`${bird.name} count`}>{tally[bird.id]}</output>
            <button type="button" onClick={() => change(bird.id, 1)} aria-label={`One more ${bird.name}`}>
              +
            </button>
          </li>
        ))}
      </ul>
      <p>
        <strong>{total(tally)}</strong> birds counted.
      </p>
      {!kept && <p className="notice">This browser would not keep the tally, so it lasts until the page is closed.</p>}
    </>
  )
}

function About() {
  return (
    <>
      <p className="lead">
        This is a single-page app: React draws every page in the browser, and Tori serves the files that{' '}
        <code>vite build</code> wrote, as a static site.
      </p>
      <div className="card">
        <h2>How it is served</h2>
        <ul>
          <li>Nothing runs on a server for it, so it never naps.</li>
          <li>
            A path that names no file, like this page's <code>/about</code>, is answered with <code>index.html</code>, so a
            link to any page of the app works when it is opened directly.
          </li>
          <li>A path that names a file that is not there is a 404.</li>
        </ul>
      </div>
      <h2>Deploy your own</h2>
      <p>With Node.js installed:</p>
      <pre>
        <code>{`git clone https://github.com/tori-host/examples
cd examples/sunny-tern
npm install
npx tori.host`}</code>
      </pre>
      <p>
        <code>npx tori.host</code> runs <code>npm run build</code> when there is no <code>dist/</code> yet, and publishes{' '}
        <code>dist/</code>. The first run creates a site under a new name of its own; <code>tori.json</code> keeps that name
        for the next run. Once <code>dist/</code> exists it is published as it is, so build again before each deploy:{' '}
        <code>npm run build &amp;&amp; npx tori.host</code>.
      </p>
    </>
  )
}

export default function App() {
  const [path, go] = usePath()
  const page = pageOf(path)
  const tally = useTally()
  useEffect(() => {
    document.title = page === 'about' ? 'About — sunny tern' : 'sunny tern — a single-page app on Tori'
  }, [page])
  return (
    <main>
      <header>
        <img src="/favicon.svg" alt="" width="36" height="36" />
        <h1>sunny tern</h1>
        <span className="tag">single-page app</span>
      </header>
      <nav aria-label="Pages">
        <a href="/" onClick={go('/')} aria-current={page === 'tally' ? 'page' : undefined}>
          tally
        </a>
        <a href="/about" onClick={go('/about')} aria-current={page === 'about' ? 'page' : undefined}>
          how it works
        </a>
      </nav>
      {page === 'tally' && <Tally {...tally} />}
      {page === 'about' && <About />}
      {page === 'missing' && (
        <p className="lead">
          There is no page at <code>{path}</code> in this app. <a href="/" onClick={go('/')}>Back to the tally</a>.
        </p>
      )}
      <footer>
        <p>
          This is an example run by <a href="https://tori.host/">Tori</a>, in Prague, EU. The source is on{' '}
          <a href={SOURCE}>GitHub</a>.
        </p>
      </footer>
    </main>
  )
}
