package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

func testHandler(t *testing.T, targets ...target) http.Handler {
	t.Helper()
	if len(targets) == 0 {
		srv, _ := upstream(t, func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(healthyPage)) })
		targets = []target{targetAt(srv)}
	}
	return newHandler(newChecker(targets, time.Second, newFakeClock().Now), newFakeClock().Now())
}

func get(h http.Handler, method, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

func TestEveryResponseCarriesTheHeaders(t *testing.T) {
	h := testHandler(t)
	want := map[string]string{
		"Content-Security-Policy": "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
		"X-Content-Type-Options":  "nosniff",
		"Referrer-Policy":         "strict-origin-when-cross-origin",
		"X-Robots-Tag":            "noindex",
	}
	for _, path := range []string{"/", "/api/status", "/healthz", "/style.css", "/favicon.svg", "/nope", "/main.go"} {
		rec := get(h, http.MethodGet, path)
		for name, value := range want {
			if got := rec.Header().Get(name); got != value {
				t.Errorf("%s: %s is %q, want %q", path, name, got, value)
			}
		}
	}
}

func TestHealthz(t *testing.T) {
	rec := get(testHandler(t), http.MethodGet, "/healthz")
	if rec.Code != 200 || rec.Body.String() != "ok\n" {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
}

func TestUnknownPathsAndTheSourceAre404(t *testing.T) {
	h := testHandler(t)
	for _, path := range []string{"/nope", "/main.go", "/go.mod", "/templates/index.html", "/static/style.css", "/static/", "/api/status/x", "/index.html"} {
		if rec := get(h, http.MethodGet, path); rec.Code != http.StatusNotFound {
			t.Errorf("%s: got %d, want 404", path, rec.Code)
		}
	}
	if rec := get(h, http.MethodPost, "/"); rec.Code == http.StatusOK {
		t.Error("POST / should not be answered as a page")
	}
}

func TestTheStaticFilesAreServed(t *testing.T) {
	h := testHandler(t)
	for path, kind := range map[string]string{"/style.css": "text/css", "/favicon.svg": "image/svg+xml"} {
		rec := get(h, http.MethodGet, path)
		if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Type"), kind) || rec.Body.Len() == 0 {
			t.Errorf("%s: got %d %q, %d bytes", path, rec.Code, rec.Header().Get("Content-Type"), rec.Body.Len())
		}
	}
}

func TestThePageSaysWhatItIs(t *testing.T) {
	rec := get(testHandler(t), http.MethodGet, "/")
	if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/html") {
		t.Fatalf("got %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	body := rec.Body.String()
	for _, want := range []string{
		`<body data-example="steel-swift">`,
		`<meta name="robots" content="noindex" />`,
		`an example run by <a href="https://tori.host/">Tori</a>`,
		"Prague, EU",
		`href="https://github.com/tori-host/examples/tree/main/steel-swift"`,
		"1 of 1 Tori examples are up",
		"lost when the server restarts",
		"<polyline points=",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the page lacks %q", want)
		}
	}
}

func TestTheTemplateEscapes(t *testing.T) {
	// The names are compiled in, but should one ever carry markup, it must
	// arrive as text, and a script address must not become a link.
	srv, _ := upstream(t, func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("nothing")) })
	evil := target{Name: `<script>alert(1)</script>`, Page: "javascript:alert(1)", URL: srv.URL + "/", Contains: "x"}
	body := get(testHandler(t, evil), http.MethodGet, "/").Body.String()
	if strings.Contains(body, "<script>") {
		t.Fatal("markup in a name reached the page unescaped")
	}
	if !strings.Contains(body, "&lt;script&gt;alert(1)&lt;/script&gt;") {
		t.Fatal("the name should appear escaped")
	}
	if strings.Contains(body, `href="javascript:`) {
		t.Fatal("a javascript: address became a link")
	}
}

func TestNothingFromTheQueryIsOnThePage(t *testing.T) {
	body := get(testHandler(t), http.MethodGet, "/?name=planted-text-7f3a").Body.String()
	if strings.Contains(body, "planted-text-7f3a") {
		t.Fatal("text from the query string reached the page")
	}
}

func TestTheStatusAsJSON(t *testing.T) {
	srv, _ := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	})
	rec := get(testHandler(t, targetAt(srv)), http.MethodGet, "/api/status")
	if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("got %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	var got apiStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Examples) != 1 || got.Location != "Prague, EU" || got.MaxAgeSecs != 60 || !strings.Contains(got.History, "lost when it restarts") {
		t.Fatalf("unexpected status %+v", got)
	}
	e := got.Examples[0]
	if e.Name != "fake-bird" || e.Up || e.Status != 502 || e.Problem != "HTTP 502" || e.UptimePercent != 0 || len(e.History) != 1 {
		t.Fatalf("unexpected example %+v", e)
	}
}

func TestManyVisitorsMakeOneRound(t *testing.T) {
	srv, hits := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		w.Write([]byte(healthyPage))
	})
	h := testHandler(t, targetAt(srv))
	var wg sync.WaitGroup
	for i := range 40 {
		path := "/"
		if i%2 == 1 {
			path = "/api/status"
		}
		wg.Go(func() {
			if rec := get(h, http.MethodGet, path); rec.Code != 200 {
				t.Errorf("%s: %d", path, rec.Code)
			}
		})
	}
	wg.Wait()
	if n := hits.Load(); n != 1 {
		t.Fatalf("40 simultaneous visits made %d rounds, want 1", n)
	}
}

func TestTheLiveListIsOnlyOurAddresses(t *testing.T) {
	name := regexp.MustCompile(`^[a-z]+-[a-z]+$`)
	seen := map[string]bool{}
	for _, tg := range liveTargets() {
		if !name.MatchString(tg.Name) || seen[tg.Name] || tg.Name == "steel-swift" {
			t.Errorf("unexpected name %q", tg.Name)
		}
		seen[tg.Name] = true
		if tg.Page != "https://"+tg.Name+".tori.cloud" || !strings.HasPrefix(tg.URL, tg.Page+"/") || tg.Contains == "" {
			t.Errorf("%s: unexpected target %+v", tg.Name, tg)
		}
	}
	if len(seen) != 9 {
		t.Errorf("watching %d examples, want the 9 others", len(seen))
	}
}

func TestTheSparkline(t *testing.T) {
	sp := newSparkline([]sample{{Up: true, Latency: 100 * time.Millisecond}, {Up: false}, {Up: true, Latency: 200 * time.Millisecond}})
	if len(sp.Downs) != 1 || strings.Count(sp.Points, ",") != 2 {
		t.Fatalf("want two points and one down mark, got %+v", sp)
	}
	// Only digits, dots, commas and spaces: nothing for the template to escape.
	if !regexp.MustCompile(`^[0-9., ]+$`).MatchString(sp.Points) {
		t.Fatalf("unexpected points %q", sp.Points)
	}
	if one := newSparkline([]sample{{Up: true, Latency: time.Millisecond}}); strings.Count(one.Points, ",") != 2 {
		t.Fatalf("a single round should still draw a line, got %q", one.Points)
	}
}
