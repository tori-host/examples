package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"html/template"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const location = "Prague, EU"

// Only these files are compiled in, so no request can reach the Go source:
// it is not in the binary to be served.
//
//go:embed templates/index.html static/style.css static/favicon.svg
var files embed.FS

// html/template, not text/template: everything it fills in is escaped for
// the place it lands, HTML text, attribute or URL.
var indexPage = template.Must(template.ParseFS(files, "templates/index.html"))

type server struct {
	checker   *Checker
	startedAt time.Time
}

func newHandler(c *Checker, startedAt time.Time) http.Handler {
	s := &server{checker: c, startedAt: startedAt}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.index)
	mux.HandleFunc("GET /api/status", s.api)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("GET /style.css", staticFile("static/style.css"))
	mux.HandleFunc("GET /favicon.svg", staticFile("static/favicon.svg"))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("Nothing here. The status of the examples is at /\n"))
	})
	return withHeaders(mux)
}

// withHeaders sets the headers every response carries, 404s and errors too.
func withHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		// No scripts at all; the sparklines are inline SVG, which CSP does not govern.
		h.Set("Content-Security-Policy", "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		// The pages on tori.host are the ones meant to be found; this copy is not.
		h.Set("X-Robots-Tag", "noindex")
		next.ServeHTTP(w, r)
	})
}

func staticFile(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=300")
		http.ServeFileFS(w, r, files, name)
	}
}

func (s *server) index(w http.ResponseWriter, r *http.Request) {
	rep, err := s.checker.Status(r.Context())
	if err != nil {
		return // the visitor left before the round ended; the round goes on without them
	}
	var buf bytes.Buffer
	if err := indexPage.Execute(&buf, s.view(rep)); err != nil {
		log.Printf("page: %v", err)
		http.Error(w, "Something went wrong here.", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(buf.Bytes())
}

type pageView struct {
	CheckedAt  time.Time
	AgeSeconds int
	MaxAge     int
	StartedAt  time.Time
	Rounds     int
	Keep       int
	Up, Total  int
	Examples   []exampleView
	SparkW     int
	SparkH     int
	DownY      int
}

type exampleView struct {
	Name, Page string
	Up         bool
	Problem    string
	Latency    string
	Uptime     int
	Checks     int
	Spark      sparkline
}

func (s *server) view(rep report) pageView {
	v := pageView{
		CheckedAt:  rep.CheckedAt,
		AgeSeconds: int(s.checker.now().Sub(rep.CheckedAt).Seconds()),
		MaxAge:     int(maxAge.Seconds()),
		StartedAt:  s.startedAt,
		Rounds:     rep.Rounds,
		Keep:       keepRounds,
		Total:      len(rep.Examples),
		SparkW:     sparkW,
		SparkH:     sparkH,
		DownY:      sparkH - 6,
	}
	for _, e := range rep.Examples {
		latest := e.Latest()
		if latest.Up {
			v.Up++
		}
		v.Examples = append(v.Examples, exampleView{
			Name:    e.Name,
			Page:    e.Page,
			Up:      latest.Up,
			Problem: latest.Problem,
			Latency: strconv.FormatInt(latest.Latency.Milliseconds(), 10) + " ms",
			Uptime:  e.UptimePercent(),
			Checks:  len(e.History),
			Spark:   newSparkline(e.History),
		})
	}
	return v
}

const (
	sparkW = 120
	sparkH = 28
)

// A sparkline of the latency of the rounds kept, the latest at the right
// edge: a line through the rounds that were up, a red mark under each that
// was not. Drawn here as numbers, so the template has nothing to trust.
type sparkline struct {
	Points string
	Downs  []string // x of each round that was down
}

func newSparkline(history []sample) sparkline {
	var slowest time.Duration
	for _, s := range history {
		if s.Up && s.Latency > slowest {
			slowest = s.Latency
		}
	}
	step := float64(sparkW-4) / float64(keepRounds-1)
	offset := keepRounds - len(history)
	var sp sparkline
	var points []string
	for i, s := range history {
		x := 2 + float64(offset+i)*step
		if !s.Up {
			sp.Downs = append(sp.Downs, num(x-1.5))
			continue
		}
		y := float64(sparkH - 8)
		if slowest > 0 {
			y = 2 + float64(sparkH-10)*(1-float64(s.Latency)/float64(slowest))
		}
		points = append(points, num(x)+","+num(y))
	}
	if len(points) == 1 {
		// One point draws nothing; give it a short level line.
		x, y, _ := strings.Cut(points[0], ",")
		xf, _ := strconv.ParseFloat(x, 64)
		points = []string{num(xf-2) + "," + y, num(xf) + "," + y}
	}
	sp.Points = strings.Join(points, " ")
	return sp
}

func num(f float64) string { return strconv.FormatFloat(f, 'f', 1, 64) }

type apiSample struct {
	At        time.Time `json:"at"`
	Up        bool      `json:"up"`
	Status    int       `json:"status,omitempty"`
	LatencyMs int64     `json:"latencyMs"`
	Problem   string    `json:"problem,omitempty"`
}

type apiExample struct {
	Name          string      `json:"name"`
	URL           string      `json:"url"`
	Checked       string      `json:"checked"`
	Contains      string      `json:"contains"`
	Up            bool        `json:"up"`
	Status        int         `json:"status,omitempty"`
	LatencyMs     int64       `json:"latencyMs"`
	Problem       string      `json:"problem,omitempty"`
	UptimePercent int         `json:"uptimePercent"`
	History       []apiSample `json:"history"`
}

type apiStatus struct {
	CheckedAt  time.Time    `json:"checkedAt"`
	MaxAgeSecs int          `json:"maxAgeSeconds"`
	History    string       `json:"history"`
	Location   string       `json:"location"`
	Examples   []apiExample `json:"examples"`
}

func (s *server) api(w http.ResponseWriter, r *http.Request) {
	rep, err := s.checker.Status(r.Context())
	if err != nil {
		return
	}
	out := apiStatus{
		CheckedAt:  rep.CheckedAt,
		MaxAgeSecs: int(maxAge.Seconds()),
		History:    "in memory: up to the last " + strconv.Itoa(keepRounds) + " rounds since this copy started, lost when it restarts",
		Location:   location,
		Examples:   make([]apiExample, 0, len(rep.Examples)),
	}
	for _, e := range rep.Examples {
		latest := e.Latest()
		ex := apiExample{
			Name: e.Name, URL: e.Page, Checked: e.URL, Contains: e.Contains,
			Up: latest.Up, Status: latest.Status, LatencyMs: latest.Latency.Milliseconds(), Problem: latest.Problem,
			UptimePercent: e.UptimePercent(),
		}
		for _, h := range e.History {
			ex.History = append(ex.History, apiSample{At: h.At, Up: h.Up, Status: h.Status, LatencyMs: h.Latency.Milliseconds(), Problem: h.Problem})
		}
		out.Examples = append(out.Examples, ex)
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.Encode(out)
}
