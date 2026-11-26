// The two buttons. The list is in the HTML the server sent; a click sends a
// request, and what the page shows afterwards is the list the server answered
// with, drawn again from scratch. Nothing is counted or added in the browser:
// other visitors use the same list, and the server starts over after a nap,
// so the only list worth showing is the one it holds now.
const list = document.getElementById('birds')
const logButton = document.getElementById('log')
const notice = document.getElementById('notice')
const started = document.getElementById('started')

function row(bird) {
  const item = document.createElement('li')
  item.className = `row tone-${bird.tone}`
  item.dataset.bird = bird.id

  const mark = document.createElement('span')
  mark.className = 'mark'
  mark.setAttribute('aria-hidden', 'true')
  mark.textContent = '[oo}'

  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = bird.name

  const heart = document.createElement('button')
  heart.className = 'heart'
  heart.type = 'button'
  // The server's words for it, count included: the visible text is a glyph
  // and a number, and the label is what a screen reader says instead.
  heart.setAttribute('aria-label', bird.heartLabel)
  const glyph = document.createElement('span')
  glyph.setAttribute('aria-hidden', 'true')
  glyph.textContent = '♥'
  const count = document.createElement('span')
  count.className = 'count'
  count.textContent = String(bird.hearts)
  heart.append(glyph, ' ', count)

  item.append(mark, name, heart)
  return item
}

/**
 * Draw the list from what the server holds. Answers true when the bird whose
 * heart had focus is no longer on the list, so that the caller can say why
 * focus moved.
 */
function show(view) {
  if (!view || !Array.isArray(view.birds)) return false
  let lostFocus = false
  // Keep the keyboard where it was. The rows are replaced, so the heart that
  // had focus is a new element; and its bird may be gone altogether, from a
  // restarted server's list. Focus then goes to the notice, which says what
  // happened, instead of falling back to the top of the document. The log
  // button is never disabled, so it never loses focus this way: a full list
  // answers the click with a sentence, and a list that has room again (the
  // server napped) takes the bird, with nothing for the page to find out
  // first.
  const focusedBird = document.activeElement?.closest?.('[data-bird]')?.dataset.bird
  list.replaceChildren(...view.birds.map(row))
  if (focusedBird) {
    const again = list.querySelector(`[data-bird="${CSS.escape(focusedBird)}"] .heart`)
    if (again) {
      again.focus()
    } else {
      lostFocus = true
      notice.focus()
    }
  }
  // The footer explains the counts by when this server started. A list from
  // a newer server under the old server's start time would contradict it.
  if (started && view.startedAt && view.startedText) {
    started.dateTime = view.startedAt
    started.textContent = view.startedText
  }
  return lostFocus
}

// One request at a time, in the order of the clicks. Two answers arriving out
// of order would otherwise draw the older list over the newer one.
let queue = Promise.resolve()

function say(text, ok) {
  notice.className = ok ? 'ok' : ''
  notice.textContent = text
}

function send(path) {
  queue = queue.then(async () => {
    try {
      const response = await fetch(path, { method: 'POST' })
      const body = await response.json().catch(() => ({}))
      // A refusal that carries the list (a bird that is gone, a full list)
      // still says what the list is now.
      show(body)
      // The notice is a live region: this is how a click is confirmed to
      // someone who does not see the number change.
      if (response.ok) say(body.said || '', true)
      else say(body.error || 'That did not work. Try again in a moment.', false)
    } catch {
      say('The server did not answer. Try again in a moment.', false)
    }
  })
}

// The list as it is now, without a click. A page left open outlives the
// server it was drawn from: the app naps and starts over, or other visitors
// add to the list. Coming back to the tab asks again. Not on a timer: a page
// that polls keeps a napping app awake. A failed refresh says nothing: the
// page is as usable as it was.
function refresh() {
  queue = queue.then(async () => {
    try {
      const response = await fetch('/api/birds')
      // Focus has just been moved to the notice, with nothing clicked: the
      // notice must say why, or a keyboard user lands on an empty line or on
      // an old message about a bird that is no longer there.
      if (response.ok && show(await response.json())) {
        say('The server started over, so that bird is not on the list any more.', true)
      }
    } catch {
      // Left as it is.
    }
  })
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh()
})
// Back and forward restore a page from memory without loading it.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) refresh()
})

list.addEventListener('click', (event) => {
  const heart = event.target.closest('.heart')
  if (heart) send(`/api/birds/${heart.closest('[data-bird]').dataset.bird}/heart`)
})

logButton.addEventListener('click', () => send('/api/birds'))
