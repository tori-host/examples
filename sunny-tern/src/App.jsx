import { useEffect, useState } from 'react'
import { MAX_NAME, MAX_TITLE, STORAGE_KEY, addExpense, addPerson, load, removeExpense, removePerson, save } from './bill.js'
import { balances, formatAmount, settle } from './settle.js'

const SOURCE = 'https://github.com/tori-host/examples/tree/main/sunny-tern'

// Reading `window.localStorage` itself throws where a browser blocks storage
// for the site; the bill then lasts as long as the page, and says so.
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
const PAGES = { '/': 'bill', '/about': 'about' }
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

// The bill lives in App, not in the page that shows it: moving to the other
// page and back must not lose a bill that a browser keeping nothing still holds.
//
// Another tab of the app keeps the same bill. So a change starts from what
// the browser holds now, not from what this tab read when it opened, and a
// change saved in another tab is shown here as it happens.
// Where the browser keeps nothing, this tab's own bill is all there is.
//
// Only this tab's own clicks write. A bill shown because another tab changed
// it is not written back: by the time it would be, the other tab may have
// changed it again, and the copy would undo that.
function useBill() {
  const [bill, setBill] = useState(() => load(browserStorage()))
  const [kept, setKept] = useState(true)
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === STORAGE_KEY) setBill(load(browserStorage()))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  /** Apply a change from bill.js. Returns its error, if it had one. */
  const change = (apply) => {
    const storage = browserStorage()
    const result = apply(kept && storage ? load(storage) : bill)
    if (result.error) return result.error
    setKept(save(storage, result.bill))
    setBill(result.bill)
    return null
  }
  return { bill, kept, change }
}

function People({ bill, change }) {
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const submit = (event) => {
    event.preventDefault()
    const failed = change((current) => addPerson(current, name))
    setError(failed)
    if (!failed) setName('')
  }
  return (
    <section aria-labelledby="people">
      <h2 id="people">People</h2>
      {bill.people.length > 0 && (
        <ul className="chips">
          {bill.people.map((person) => (
            <li key={person.id}>
              {person.name}
              <button type="button" className="remove" onClick={() => setError(change((current) => removePerson(current, person.id)))} aria-label={`Remove ${person.name}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="inline" onSubmit={submit}>
        <label htmlFor="person-name">Name</label>
        <input id="person-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={MAX_NAME} autoComplete="off" />
        <button type="submit">Add</button>
      </form>
      {error && <p className="notice" role="alert">{error}</p>}
    </section>
  )
}

function NewExpense({ bill, change }) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [paidBy, setPaidBy] = useState('')
  // Who it is split among, as the ids left out: a new person is in by default.
  const [left, setLeft] = useState(() => new Set())
  const [error, setError] = useState(null)
  const payer = bill.people.some((person) => person.id === paidBy) ? paidBy : (bill.people[0]?.id ?? '')
  const among = bill.people.map((person) => person.id).filter((id) => !left.has(id))
  const toggle = (id) => {
    const next = new Set(left)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setLeft(next)
  }
  const submit = (event) => {
    event.preventDefault()
    const failed = change((current) => addExpense(current, { title, amount, paidBy: payer, among }))
    setError(failed)
    if (!failed) {
      setTitle('')
      setAmount('')
    }
  }
  if (bill.people.length === 0) return <p>Add the people first: an expense needs someone who paid.</p>
  return (
    <form className="card expense" onSubmit={submit}>
      <label htmlFor="expense-title">What for</label>
      <input id="expense-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={MAX_TITLE} autoComplete="off" />
      <label htmlFor="expense-amount">Amount</label>
      <input id="expense-amount" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" maxLength={20} autoComplete="off" />
      <label htmlFor="expense-payer">Paid by</label>
      <select id="expense-payer" value={payer} onChange={(event) => setPaidBy(event.target.value)}>
        {bill.people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
      <fieldset>
        <legend>Split equally among</legend>
        {bill.people.map((person) => (
          <label key={person.id} className="check">
            <input type="checkbox" checked={!left.has(person.id)} onChange={() => toggle(person.id)} />
            {person.name}
          </label>
        ))}
      </fieldset>
      <button type="submit">Add expense</button>
      {error && <p className="notice" role="alert">{error}</p>}
    </form>
  )
}

function Bill({ bill, kept, change }) {
  const names = new Map(bill.people.map((person) => [person.id, person.name]))
  const balance = balances(bill.people, bill.expenses)
  const transfers = settle(balance)
  const spent = bill.expenses.reduce((sum, expense) => sum + expense.amount, 0)
  return (
    <>
      <p className="lead">
        Add who was there and what each of them paid for. The page works out who pays whom, in as few transfers as it
        can. The bill stays in this browser, and nothing is sent anywhere.
      </p>
      <People bill={bill} change={change} />

      <section aria-labelledby="expenses">
        <h2 id="expenses">Expenses</h2>
        {bill.expenses.length > 0 && (
          <ul className="list">
            {bill.expenses.map((expense) => (
              <li key={expense.id} className="card row">
                <span className="what">
                  <strong>{expense.title}</strong>
                  <span>
                    {names.get(expense.paidBy)} paid, split among {expense.among.map((id) => names.get(id)).join(', ')}
                  </span>
                </span>
                <span className="amount">{formatAmount(expense.amount)}</span>
                <button type="button" className="remove" onClick={() => change((current) => removeExpense(current, expense.id))} aria-label={`Remove ${expense.title}`}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <NewExpense bill={bill} change={change} />
      </section>

      <section aria-labelledby="settle">
        <h2 id="settle">Who pays whom</h2>
        {bill.expenses.length === 0 && <p>Nothing to settle yet.</p>}
        {bill.expenses.length > 0 && transfers.length === 0 && <p>Everyone is even.</p>}
        {transfers.length > 0 && (
          <ul className="list" aria-live="polite">
            {transfers.map((transfer) => (
              <li key={`${transfer.from}-${transfer.to}`} className="card row">
                <span className="what transfer">
                  <strong>{names.get(transfer.from)}</strong> pays <strong>{names.get(transfer.to)}</strong>
                </span>
                <span className="amount">{formatAmount(transfer.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {bill.expenses.length > 0 && (
          <p className="small">
            {formatAmount(spent)} spent in all. Shares are whole cents: a cent that does not divide goes to the first
            people in the list.
          </p>
        )}
      </section>
      {!kept && <p className="notice">This browser would not keep the bill, so it lasts until the page is closed.</p>}
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
          <li>
            The bill is kept in this browser's <code>localStorage</code>. No one else sees it, and clearing the site's
            data clears it.
          </li>
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
  const bill = useBill()
  useEffect(() => {
    document.title = page === 'about' ? 'About — Split the bill' : 'Split the bill — a single-page app on Tori'
  }, [page])
  return (
    <main>
      <header>
        <img src="/favicon.svg" alt="" width="36" height="36" />
        <h1>Split the bill</h1>
        <span className="tag">single-page app</span>
      </header>
      <nav aria-label="Pages">
        <a href="/" onClick={go('/')} aria-current={page === 'bill' ? 'page' : undefined}>
          the bill
        </a>
        <a href="/about" onClick={go('/about')} aria-current={page === 'about' ? 'page' : undefined}>
          how it works
        </a>
      </nav>
      {page === 'bill' && <Bill {...bill} />}
      {page === 'about' && <About />}
      {/* The path is not repeated here: an address someone else wrote is never shown as text on this page. */}
      {page === 'missing' && (
        <p className="lead">
          There is no such page in this app. <a href="/" onClick={go('/')}>Back to the bill</a>.
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
