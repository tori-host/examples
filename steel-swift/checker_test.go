package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeClock is the clock that ages results; latency is still measured on the real one.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func newFakeClock() *fakeClock { return &fakeClock{t: time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)} }

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

const healthyPage = `<!doctype html><body data-example="fake-bird"><p>hello</p></body>`

// upstream is a fake example. It counts the requests it gets, so a test can
// tell how many rounds reached it.
func upstream(t *testing.T, handler http.HandlerFunc) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	hits := &atomic.Int32{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		handler(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv, hits
}

func targetAt(srv *httptest.Server) target {
	return target{Name: "fake-bird", Page: srv.URL, URL: srv.URL + "/", Contains: `data-example="fake-bird"`}
}

func checkOnce(t *testing.T, tg target, timeout time.Duration) sample {
	t.Helper()
	c := newChecker([]target{tg}, timeout, newFakeClock().Now)
	rep, err := c.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return rep.Examples[0].Latest()
}

func TestAHealthyPageIsUp(t *testing.T) {
	var userAgent atomic.Value
	srv, _ := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		userAgent.Store(r.UserAgent())
		w.Write([]byte(healthyPage))
	})
	s := checkOnce(t, targetAt(srv), time.Second)
	if !s.Up || s.Status != 200 || s.Problem != "" {
		t.Fatalf("want up, got %+v", s)
	}
	if ua, _ := userAgent.Load().(string); !strings.HasPrefix(ua, "steel-swift/") {
		t.Fatalf("the check should name the app in its User-Agent, sent %q", ua)
	}
}

func TestA500IsDownEvenWithTheMarker(t *testing.T) {
	srv, _ := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(healthyPage))
	})
	s := checkOnce(t, targetAt(srv), time.Second)
	if s.Up || s.Status != 500 || s.Problem != "HTTP 500" {
		t.Fatalf("want down with HTTP 500, got %+v", s)
	}
}

func TestASlowPageTimesOut(t *testing.T) {
	srv, _ := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(10 * time.Second):
		}
	})
	start := time.Now()
	s := checkOnce(t, targetAt(srv), 100*time.Millisecond)
	if s.Up || s.Problem != "timed out" {
		t.Fatalf("want timed out, got %+v", s)
	}
	if took := time.Since(start); took > 2*time.Second {
		t.Fatalf("the round waited %s for a check with a 100 ms limit", took)
	}
}

func TestABodyThatStopsInTheMiddleTimesOut(t *testing.T) {
	// The headers arrive at once; the page never finishes. The limit covers the body too.
	srv, _ := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("<!doctype html><body>"))
		w.(http.Flusher).Flush()
		select {
		case <-r.Context().Done():
		case <-time.After(10 * time.Second):
		}
	})
	s := checkOnce(t, targetAt(srv), 100*time.Millisecond)
	if s.Up || s.Problem != "timed out" {
		t.Fatalf("want timed out, got %+v", s)
	}
}

func TestAPageWithoutTheMarkerIsDown(t *testing.T) {
	srv, _ := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`<!doctype html><body data-example="some-other-bird"></body>`))
	})
	s := checkOnce(t, targetAt(srv), time.Second)
	if s.Up || s.Status != 200 || s.Problem != "marker missing" {
		t.Fatalf("want marker missing, got %+v", s)
	}
}

func TestOnlyTheFirstMiBIsRead(t *testing.T) {
	srv, _ := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(strings.Repeat(" ", maxBody)))
		w.Write([]byte(healthyPage))
	})
	s := checkOnce(t, targetAt(srv), time.Second)
	if s.Up || s.Problem != "marker missing" {
		t.Fatalf("a marker past the cap should not be found, got %+v", s)
	}
}

func TestARedirectIsReportedAndNotFollowed(t *testing.T) {
	elsewhere, elsewhereHits := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(healthyPage))
	})
	srv, _ := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, elsewhere.URL+"/", http.StatusFound)
	})
	s := checkOnce(t, targetAt(srv), time.Second)
	if s.Up || s.Status != 302 || s.Problem != "redirect, not followed" {
		t.Fatalf("want a reported redirect, got %+v", s)
	}
	if n := elsewhereHits.Load(); n != 0 {
		t.Fatalf("the redirect was followed: its target got %d requests", n)
	}
}

func TestAnUnreachableAddressIsDown(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	tg := targetAt(srv)
	srv.Close() // nothing listens there any more
	s := checkOnce(t, tg, time.Second)
	if s.Up || s.Problem != "unreachable" {
		t.Fatalf("want unreachable, got %+v", s)
	}
}

func TestResultsAreReusedForSixtySeconds(t *testing.T) {
	srv, hits := upstream(t, func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(healthyPage)) })
	clock := newFakeClock()
	c := newChecker([]target{targetAt(srv)}, time.Second, clock.Now)
	status := func() report {
		t.Helper()
		rep, err := c.Status(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		return rep
	}

	status()
	status()
	if n := hits.Load(); n != 1 {
		t.Fatalf("two requests within a minute made %d rounds, want 1", n)
	}
	clock.Advance(59 * time.Second)
	status()
	if n := hits.Load(); n != 1 {
		t.Fatalf("results 59 s old were not reused: %d rounds", n)
	}
	clock.Advance(2 * time.Second)
	rep := status()
	if n := hits.Load(); n != 2 {
		t.Fatalf("results 61 s old were reused: %d rounds, want 2", n)
	}
	if rep.Rounds != 2 || len(rep.Examples[0].History) != 2 {
		t.Fatalf("want two rounds in the history, got %d rounds, %d samples", rep.Rounds, len(rep.Examples[0].History))
	}
}

func TestConcurrentCallersShareOneRound(t *testing.T) {
	// Slow enough that every caller arrives while the round runs.
	srv, hits := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		w.Write([]byte(healthyPage))
	})
	c := newChecker([]target{targetAt(srv)}, time.Second, newFakeClock().Now)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for range 50 {
		wg.Go(func() {
			<-start
			rep, err := c.Status(context.Background())
			if err != nil || !rep.Examples[0].Latest().Up {
				t.Errorf("a caller got %v, %+v", err, rep)
			}
		})
	}
	close(start)
	wg.Wait()
	if n := hits.Load(); n != 1 {
		t.Fatalf("50 simultaneous callers made %d rounds, want 1", n)
	}
}

func TestACallerWhoLeavesDoesNotCancelTheRound(t *testing.T) {
	release := make(chan struct{})
	srv, hits := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		<-release
		w.Write([]byte(healthyPage))
	})
	// Cleanups run last first: the fake page is released before its server
	// closes, or a failure below would leave Close waiting on it for good.
	var once sync.Once
	letGo := func() { once.Do(func() { close(release) }) }
	t.Cleanup(letGo)
	c := newChecker([]target{targetAt(srv)}, 5*time.Second, newFakeClock().Now)
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()
	if _, err := c.Status(ctx); err == nil {
		t.Fatal("a caller whose context ended should get an error")
	}
	letGo()
	rep, err := c.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !rep.Examples[0].Latest().Up || hits.Load() != 1 {
		t.Fatalf("the round should have finished for the next caller: up=%v, rounds=%d", rep.Examples[0].Latest().Up, hits.Load())
	}
}

func TestTheHistoryKeepsTheLastRounds(t *testing.T) {
	var n atomic.Int32
	srv, _ := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		// Up on odd rounds, down on even ones.
		if n.Add(1)%2 == 0 {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		w.Write([]byte(healthyPage))
	})
	clock := newFakeClock()
	c := newChecker([]target{targetAt(srv)}, time.Second, clock.Now)
	var rep report
	for range keepRounds + 5 {
		var err error
		if rep, err = c.Status(context.Background()); err != nil {
			t.Fatal(err)
		}
		clock.Advance(maxAge)
	}
	h := rep.Examples[0].History
	if len(h) != keepRounds {
		t.Fatalf("kept %d rounds, want %d", len(h), keepRounds)
	}
	if got := rep.Examples[0].UptimePercent(); got != 50 {
		t.Fatalf("uptime %d%%, want 50%%", got)
	}
	if !h[0].At.Before(h[len(h)-1].At) {
		t.Fatal("the history should run oldest first")
	}
}
