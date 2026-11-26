package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"testing"
)

// In a checkout of the whole repository examples.json is one directory up,
// and the list in examples.go has to say what it says: every example but this
// one, with the same path and marker. A copy of this directory on its own has
// no examples.json, and nothing to compare.
func TestTheListMatchesExamplesJSON(t *testing.T) {
	raw, err := os.ReadFile("../examples.json")
	if errors.Is(err, fs.ErrNotExist) {
		t.Skip("no ../examples.json beside this directory")
	}
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Examples []struct {
			Name  string `json:"name"`
			Check struct {
				Path     string `json:"path"`
				Contains string `json:"contains"`
			} `json:"check"`
		} `json:"examples"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	want := map[string]example{}
	for _, e := range manifest.Examples {
		if e.Name != "steel-swift" {
			want[e.Name] = example{Name: e.Name, Path: e.Check.Path, Contains: e.Check.Contains}
		}
	}
	got := map[string]example{}
	for _, e := range examples {
		got[e.Name] = e
	}
	for name, w := range want {
		if g, ok := got[name]; !ok {
			t.Errorf("%s is in examples.json but not in examples.go", name)
		} else if g != w {
			t.Errorf("%s: examples.go has %+v, examples.json %+v", name, g, w)
		}
	}
	for name := range got {
		if _, ok := want[name]; !ok {
			t.Errorf("%s is in examples.go but not in examples.json", name)
		}
	}
}
