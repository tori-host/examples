-- One row per bird that has been seen at least once. A bird with no row has
-- been seen zero times, so adding a bird to the page needs no migration.
CREATE TABLE sightings (
  bird_id text PRIMARY KEY,
  count bigint NOT NULL CHECK (count >= 0),
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);
