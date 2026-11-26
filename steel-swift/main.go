// steel swift: a Go service that Tori builds from source. There is no
// Dockerfile: Tori sees go.mod beside Go code, builds the binary and runs it
// with PORT set to 8080. It is the standard library only, so there is no
// go.sum: nothing is downloaded to build it.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 {
		log.Fatalf("PORT must be a port number, got: %q", port)
	}

	checker := newChecker(liveTargets(), checkTimeout, time.Now)
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           newHandler(checker, time.Now()),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		// A request may wait for one round of checks, which takes at most a
		// few times checkTimeout.
		WriteTimeout:   30 * time.Second,
		IdleTimeout:    60 * time.Second,
		MaxHeaderBytes: 16 << 10,
	}

	// A napping service is stopped with SIGTERM: finish what is in flight, then leave.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()
	closed := make(chan struct{})
	go func() {
		defer close(closed)
		<-ctx.Done()
		log.Print("closing")
		shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()

	log.Printf("steel swift is listening on %s", port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	// ListenAndServe returns as soon as Shutdown starts; the requests in
	// flight are done only when Shutdown is.
	<-closed
}
