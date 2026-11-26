package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"sync"
	"time"
)

const (
	// Results younger than this are served as they are. However much traffic
	// arrives, the examples are checked at most once per maxAge.
	maxAge = 60 * time.Second
	// Each check gets this long for the whole exchange, body included.
	checkTimeout = 5 * time.Second
	// Enough for any of the example pages; a marker past it counts as missing.
	maxBody = 1 << 20
	// Rounds kept per example. The history lives in memory only, so a restart
	// (or a nap: an idle app on Tori is stopped) starts it again.
	keepRounds = 30
	userAgent  = "steel-swift/1 (status page of the Tori examples; https://github.com/tori-host/examples/tree/main/steel-swift)"
)

// A target is one page to check. Only the compiled-in list in examples.go
// makes them in production; the tests make their own against local servers.
type target struct {
	Name     string
	Page     string // where a visitor is linked to
	URL      string // what is fetched
	Contains string // what the page has to carry to count as up
}

type sample struct {
	At      time.Time
	Up      bool
	Status  int // 0 when no response arrived
	Latency time.Duration
	Problem string // empty when up; one of a few fixed phrases otherwise
}

type exampleStatus struct {
	target
	History []sample // oldest first; the last one is the latest round
}

func (e exampleStatus) Latest() sample { return e.History[len(e.History)-1] }

func (e exampleStatus) UptimePercent() int {
	up := 0
	for _, s := range e.History {
		if s.Up {
			up++
		}
	}
	return (up*100 + len(e.History)/2) / len(e.History)
}

type report struct {
	CheckedAt time.Time
	Rounds    int // since this copy started
	Examples  []exampleStatus
}

// Checker runs rounds of checks on demand. There is no background loop on
// purpose: an app on Tori that nobody visits naps, and a timer would keep it
// awake to check pages nobody is looking at.
type Checker struct {
	targets []target
	client  *http.Client
	now     func() time.Time // the clock that ages results; a test moves it

	mu        sync.Mutex
	rounds    int
	checkedAt time.Time
	history   map[string][]sample
	inflight  chan struct{} // closed when the round now running is recorded
}

func newChecker(targets []target, timeout time.Duration, now func() time.Time) *Checker {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConnsPerHost = 1
	return &Checker{
		targets: targets,
		now:     now,
		history: make(map[string][]sample, len(targets)),
		client: &http.Client{
			Timeout:   timeout,
			Transport: transport,
			// A redirect is reported, not followed: the address it names is
			// not one of ours to fetch, and the live check does the same.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
}

// Status returns results under maxAge old, or runs one round and returns its
// results. Callers that arrive while a round runs wait for that round rather
// than start their own. The round itself is not tied to any one caller, so a
// visitor who closes the tab does not cancel it for everyone else.
func (c *Checker) Status(ctx context.Context) (report, error) {
	c.mu.Lock()
	if c.rounds > 0 && c.now().Sub(c.checkedAt) < maxAge {
		defer c.mu.Unlock()
		return c.reportLocked(), nil
	}
	done := c.inflight
	if done == nil {
		done = make(chan struct{})
		c.inflight = done
		go c.runRound(done)
	}
	c.mu.Unlock()

	select {
	case <-done:
	case <-ctx.Done():
		return report{}, ctx.Err()
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.reportLocked(), nil
}

func (c *Checker) runRound(done chan struct{}) {
	// Each check is bounded by the client's timeout already; this bounds the
	// round should a dial ignore it.
	ctx, cancel := context.WithTimeout(context.Background(), 2*c.client.Timeout)
	defer cancel()
	started := time.Now()
	results := make([]sample, len(c.targets))
	var wg sync.WaitGroup
	for i, t := range c.targets {
		wg.Go(func() { results[i] = c.check(ctx, t) })
	}
	wg.Wait()

	c.mu.Lock()
	at := c.now()
	up := 0
	for i, t := range c.targets {
		results[i].At = at
		if results[i].Up {
			up++
		}
		h := append(c.history[t.Name], results[i])
		if len(h) > keepRounds {
			h = append([]sample(nil), h[len(h)-keepRounds:]...)
		}
		c.history[t.Name] = h
	}
	c.rounds++
	round := c.rounds
	c.checkedAt = at
	c.inflight = nil
	c.mu.Unlock()
	close(done)
	log.Printf("round %d: %d of %d up, in %s", round, up, len(c.targets), time.Since(started).Round(time.Millisecond))
}

func (c *Checker) check(ctx context.Context, t target) sample {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, t.URL, nil)
	if err != nil {
		return sample{Problem: "bad address"}
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "text/html")
	start := time.Now()
	resp, err := c.client.Do(req)
	if err != nil {
		return sample{Latency: time.Since(start), Problem: describe(err)}
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	s := sample{Status: resp.StatusCode, Latency: time.Since(start)}
	switch {
	case resp.StatusCode >= 300 && resp.StatusCode < 400:
		s.Problem = "redirect, not followed"
	case resp.StatusCode < 200 || resp.StatusCode >= 300:
		s.Problem = fmt.Sprintf("HTTP %d", resp.StatusCode)
	case err != nil:
		s.Problem = describe(err)
	case !bytes.Contains(body, []byte(t.Contains)):
		s.Problem = "marker missing"
	default:
		s.Up = true
	}
	return s
}

// describe turns a transport error into a fixed phrase. The error's own text
// stays out of the page: it is long, and it is not the visitor's business.
func describe(err error) string {
	var netErr net.Error
	if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &netErr) && netErr.Timeout()) {
		return "timed out"
	}
	return "unreachable"
}

func (c *Checker) reportLocked() report {
	r := report{CheckedAt: c.checkedAt, Rounds: c.rounds, Examples: make([]exampleStatus, 0, len(c.targets))}
	for _, t := range c.targets {
		r.Examples = append(r.Examples, exampleStatus{target: t, History: append([]sample(nil), c.history[t.Name]...)})
	}
	return r
}
