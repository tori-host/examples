package main

// The examples this page watches: every other example in the repository, with
// the path and the marker its entry in examples.json gives to the repository's
// own live check, so that this page and that check agree on what "up" means.
// examples_test.go compares this list with examples.json when it is beside it.
//
// The list is compiled in on purpose. Nothing a visitor sends ever becomes an
// address this server fetches, and every address is built from a name here as
// https://<name>.tori.cloud<path>.
//
// Keep one entry per line, in this shape: a test outside Go reads it too.
var examples = []example{
	{Name: "paper-lark", Path: "/", Contains: `data-example="paper-lark"`},
	{Name: "sunny-tern", Path: "/about", Contains: `data-example="sunny-tern"`},
	{Name: "crimson-finch", Path: "/", Contains: `data-bird=`},
	{Name: "misty-heron", Path: "/", Contains: `data-example="misty-heron"`},
	{Name: "amber-ibis", Path: "/", Contains: `data-example="amber-ibis"`},
	{Name: "mossy-starling", Path: "/", Contains: `data-database="ready"`},
	{Name: "saffron-wren", Path: "/", Contains: `data-example="saffron-wren"`},
	{Name: "copper-owl", Path: "/", Contains: `data-example="copper-owl"`},
	{Name: "drift-albatross", Path: "/", Contains: `data-example="drift-albatross"`},
}

type example struct {
	Name     string
	Path     string
	Contains string
}

// liveTargets is what the server checks: the list above at its public addresses.
func liveTargets() []target {
	out := make([]target, 0, len(examples))
	for _, e := range examples {
		out = append(out, target{
			Name:     e.Name,
			Page:     "https://" + e.Name + ".tori.cloud",
			URL:      "https://" + e.Name + ".tori.cloud" + e.Path,
			Contains: e.Contains,
		})
	}
	return out
}
