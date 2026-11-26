-- The example became a lunch poll. Migrations are only ever added, never
-- edited, so 001 still creates the table this one drops: a database that has
-- applied 001 and one that has not both end up here.
DROP TABLE IF EXISTS sightings;

-- One row per option that has had a vote on a day. An option with no row has
-- no votes, so adding an option to the page needs no migration. `day` is the
-- date in Prague: the poll starts over at midnight there.
CREATE TABLE votes (
  day date NOT NULL,
  option_id text NOT NULL,
  count bigint NOT NULL CHECK (count >= 0),
  first_vote timestamptz NOT NULL DEFAULT now(),
  last_vote timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, option_id)
);
