-- Performance indexes: eliminate Seq Scan + Sort on every hot read query.
-- All indexes are CONCURRENT — zero downtime, no table lock.
-- Safe to re-run (IF NOT EXISTS).

SET search_path = bt, public;

-- faqs: GET /v1/faqs → WHERE published ORDER BY position
CREATE INDEX CONCURRENTLY IF NOT EXISTS faqs_pub_pos_idx
  ON bt.faqs (published, position);

-- specialties: WHERE published ORDER BY position
CREATE INDEX CONCURRENTLY IF NOT EXISTS specialties_pub_pos_idx
  ON bt.specialties (published, position);

-- testimonials: WHERE published ORDER BY position
CREATE INDEX CONCURRENTLY IF NOT EXISTS testimonials_pub_pos_idx
  ON bt.testimonials (published, position);

-- team_members: WHERE published ORDER BY position
-- existing group_idx (group_id, position) does NOT help the published filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS team_members_pub_pos_idx
  ON bt.team_members (published, position);

-- press_mentions: WHERE published ORDER BY position
CREATE INDEX CONCURRENTLY IF NOT EXISTS press_mentions_pub_pos_idx
  ON bt.press_mentions (published, position);

-- free_resources: WHERE published ORDER BY position
CREATE INDEX CONCURRENTLY IF NOT EXISTS free_resources_pub_pos_idx
  ON bt.free_resources (published, position);

-- stats: WHERE (none) ORDER BY position — small table, still eliminates the sort
CREATE INDEX CONCURRENTLY IF NOT EXISTS stats_pos_idx
  ON bt.stats (position);

-- locations: WHERE (none) ORDER BY position
CREATE INDEX CONCURRENTLY IF NOT EXISTS locations_pos_idx
  ON bt.locations (position);

-- team_groups: ORDER BY position
CREATE INDEX CONCURRENTLY IF NOT EXISTS team_groups_pos_idx
  ON bt.team_groups (position);

-- chat_sessions: future visitor_id lookups (ownership queries scale with sessions)
CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_sessions_visitor_idx
  ON bt.chat_sessions (visitor_id)
  WHERE visitor_id IS NOT NULL;
