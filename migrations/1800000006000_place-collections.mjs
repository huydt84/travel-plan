import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);

  await sql`CREATE TABLE IF NOT EXISTS place_library_entries (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS place_external_ids (
    place_id BIGINT NOT NULL REFERENCES place_library_entries(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY(provider,kind,value),
    UNIQUE(place_id,provider,kind,value)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS place_collections (
    id BIGSERIAL PRIMARY KEY,
    provider TEXT NOT NULL,
    external_list_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    public_url TEXT NOT NULL,
    source_title TEXT NOT NULL,
    source_description TEXT NOT NULL DEFAULT '',
    display_name TEXT,
    parser_version TEXT NOT NULL,
    created_by TEXT NOT NULL,
    revision BIGINT NOT NULL DEFAULT 0,
    archived_at TIMESTAMPTZ,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(provider,external_list_id)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS place_collection_items (
    collection_id BIGINT NOT NULL REFERENCES place_collections(id) ON DELETE CASCADE,
    place_id BIGINT NOT NULL REFERENCES place_library_entries(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL,
    source_name TEXT NOT NULL,
    source_address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    source_note TEXT NOT NULL DEFAULT '',
    maps_url TEXT NOT NULL,
    source_created_at TIMESTAMPTZ,
    source_updated_at TIMESTAMPTZ,
    source_removed_at TIMESTAMPTZ,
    hidden_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(collection_id,place_id),
    CHECK ((latitude IS NULL)=(longitude IS NULL)),
    CHECK(latitude BETWEEN -90 AND 90),
    CHECK(longitude BETWEEN -180 AND 180)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS place_collection_items_active_idx ON place_collection_items(collection_id,position) WHERE source_removed_at IS NULL AND hidden_at IS NULL`;
  await sql`CREATE TABLE IF NOT EXISTS place_collection_sync_previews (
    id UUID PRIMARY KEY,
    actor_email TEXT NOT NULL,
    collection_id BIGINT REFERENCES place_collections(id) ON DELETE CASCADE,
    base_revision BIGINT,
    provider TEXT NOT NULL,
    external_list_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    public_url TEXT NOT NULL,
    source_title TEXT NOT NULL,
    source_description TEXT NOT NULL DEFAULT '',
    parser_version TEXT NOT NULL,
    snapshot JSONB NOT NULL,
    change_summary JSONB NOT NULL,
    digest TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    applied_at TIMESTAMPTZ,
    receipt JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS place_collection_previews_expiry_idx ON place_collection_sync_previews(expires_at)`;
  await sql`CREATE TABLE IF NOT EXISTS place_collection_sync_attempts (
    id BIGSERIAL PRIMARY KEY,
    collection_id BIGINT REFERENCES place_collections(id) ON DELETE CASCADE,
    actor_email TEXT NOT NULL,
    parser_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('failed')),
    error_code TEXT NOT NULL CHECK(LENGTH(error_code) BETWEEN 1 AND 80),
    duration_ms INTEGER NOT NULL CHECK(duration_ms>=0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS place_collection_sync_attempts_collection_idx ON place_collection_sync_attempts(collection_id,created_at DESC)`;

  await sql`CREATE OR REPLACE FUNCTION apply_place_collection_preview(preview_key UUID, actor TEXT, approved_digest TEXT)
    RETURNS JSONB LANGUAGE plpgsql AS $$
    DECLARE p place_collection_sync_previews%ROWTYPE; c place_collections%ROWTYPE; item JSONB; identifier JSONB;
      matched_ids BIGINT[]; resolved_place BIGINT; removed_count INTEGER; result JSONB;
    BEGIN
      SELECT * INTO p FROM place_collection_sync_previews WHERE id=preview_key AND actor_email=actor FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PC404',MESSAGE='PREVIEW_NOT_FOUND'; END IF;
      IF p.digest<>approved_digest THEN RAISE EXCEPTION USING ERRCODE='PC403',MESSAGE='PREVIEW_DIGEST_INVALID'; END IF;
      IF p.receipt IS NOT NULL THEN RETURN p.receipt; END IF;
      IF p.expires_at<=NOW() THEN RAISE EXCEPTION USING ERRCODE='PC410',MESSAGE='PREVIEW_EXPIRED'; END IF;

      IF p.collection_id IS NULL THEN
        INSERT INTO place_collections(provider,external_list_id,source_url,public_url,source_title,source_description,parser_version,created_by,last_synced_at)
          VALUES(p.provider,p.external_list_id,p.source_url,p.public_url,p.source_title,p.source_description,p.parser_version,actor,NOW())
          ON CONFLICT(provider,external_list_id) DO NOTHING RETURNING * INTO c;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PC409',MESSAGE='COLLECTION_CHANGED'; END IF;
      ELSE
        SELECT * INTO c FROM place_collections WHERE id=p.collection_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PC404',MESSAGE='COLLECTION_NOT_FOUND'; END IF;
        IF c.revision IS DISTINCT FROM p.base_revision THEN RAISE EXCEPTION USING ERRCODE='PC409',MESSAGE='COLLECTION_CHANGED'; END IF;
      END IF;

      CREATE TEMPORARY TABLE IF NOT EXISTS temp_collection_places(id BIGINT PRIMARY KEY) ON COMMIT DROP;
      TRUNCATE temp_collection_places;
      FOR item IN SELECT value FROM jsonb_array_elements(p.snapshot->'items') LOOP
        SELECT ARRAY_AGG(DISTINCT e.place_id) INTO matched_ids
          FROM place_external_ids e JOIN jsonb_array_elements(item->'externalIds') x
            ON e.provider=p.provider AND e.kind=x->>'kind' AND e.value=x->>'value';
        IF COALESCE(array_length(matched_ids,1),0)>1 THEN RAISE EXCEPTION USING ERRCODE='PC422',MESSAGE='PLACE_IDENTITY_CONFLICT'; END IF;
        resolved_place := matched_ids[1];
        IF resolved_place IS NULL THEN INSERT INTO place_library_entries DEFAULT VALUES RETURNING id INTO resolved_place; END IF;
        FOR identifier IN SELECT value FROM jsonb_array_elements(item->'externalIds') LOOP
          INSERT INTO place_external_ids(place_id,provider,kind,value)
            VALUES(resolved_place,p.provider,identifier->>'kind',identifier->>'value') ON CONFLICT DO NOTHING;
          IF EXISTS(SELECT 1 FROM place_external_ids WHERE provider=p.provider AND kind=identifier->>'kind' AND value=identifier->>'value' AND place_id<>resolved_place)
            THEN RAISE EXCEPTION USING ERRCODE='PC422',MESSAGE='PLACE_IDENTITY_CONFLICT'; END IF;
        END LOOP;
        INSERT INTO temp_collection_places VALUES(resolved_place) ON CONFLICT DO NOTHING;
        INSERT INTO place_collection_items(collection_id,place_id,position,source_name,source_address,latitude,longitude,source_note,maps_url,source_created_at,source_updated_at)
          VALUES(c.id,resolved_place,(item->>'position')::INTEGER,item->>'name',NULLIF(item->>'address',''),
            (item->>'latitude')::DOUBLE PRECISION,(item->>'longitude')::DOUBLE PRECISION,COALESCE(item->>'note',''),item->>'mapsUrl',
            (item->>'sourceCreatedAt')::TIMESTAMPTZ,(item->>'sourceUpdatedAt')::TIMESTAMPTZ)
          ON CONFLICT(collection_id,place_id) DO UPDATE SET position=EXCLUDED.position,source_name=EXCLUDED.source_name,
            source_address=EXCLUDED.source_address,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,
            source_note=EXCLUDED.source_note,maps_url=EXCLUDED.maps_url,source_created_at=EXCLUDED.source_created_at,
            source_updated_at=EXCLUDED.source_updated_at,source_removed_at=NULL,updated_at=NOW();
        UPDATE place_library_entries SET updated_at=NOW() WHERE id=resolved_place;
      END LOOP;

      UPDATE place_collection_items SET source_removed_at=COALESCE(source_removed_at,NOW()),updated_at=NOW()
        WHERE collection_id=c.id AND source_removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM temp_collection_places t WHERE t.id=place_id);
      GET DIAGNOSTICS removed_count=ROW_COUNT;
      UPDATE place_collections SET source_url=p.source_url,public_url=p.public_url,source_title=p.source_title,
        source_description=p.source_description,parser_version=p.parser_version,revision=revision+1,last_synced_at=NOW(),updated_at=NOW()
        WHERE id=c.id RETURNING * INTO c;
      result:=jsonb_build_object('previewId',p.id,'collectionId',c.id::TEXT,'revision',c.revision,'title',COALESCE(c.display_name,c.source_title),
        'summary',p.change_summary,'removedCount',removed_count,'appliedAt',NOW());
      UPDATE place_collection_sync_previews SET applied_at=NOW(),receipt=result WHERE id=p.id;
      RETURN result;
    END $$`;
}
