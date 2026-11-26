-- Template admin tools: structured fees, per-registration seat limit, hidden / soft-deleted events,
-- organizer-entered registrations, site images, home page banners.

-- Structured fee. `fee` stays as the display text (sign-in sheets snapshot it); the API derives it from these columns.
ALTER TABLE event_sessions ADD COLUMN fee_type TEXT NOT NULL DEFAULT 'tbd' CHECK(fee_type IN('free','paid','tbd'));
ALTER TABLE event_sessions ADD COLUMN fee_amount INTEGER CHECK(fee_amount IS NULL OR (fee_amount BETWEEN 0 AND 1000000));
ALTER TABLE event_sessions ADD COLUMN fee_note TEXT NOT NULL DEFAULT '' CHECK(length(fee_note)<=200);
UPDATE event_sessions SET fee_type=CASE fee WHEN '免費' THEN 'free' WHEN '待定' THEN 'tbd' ELSE 'paid' END,
 fee_note=CASE WHEN fee IN('免費','待定') THEN '' ELSE substr(fee,1,200) END;

-- Most people one registration may bring (capacity is still enforced separately, by total seats).
ALTER TABLE event_sessions ADD COLUMN max_seats_per_registration INTEGER NOT NULL DEFAULT 10 CHECK(max_seats_per_registration BETWEEN 1 AND 100000);

-- Hidden events disappear from the public site but keep registrations and notifications;
-- deleted events are soft-deleted (restorable) and never shown publicly.
ALTER TABLE events ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN(0,1));
ALTER TABLE events ADD COLUMN deleted_at TEXT;

-- Registrations an organizer typed in (phone, paper form). Holds the organizer's email; NULL for resident submissions.
ALTER TABLE registrations ADD COLUMN created_by_admin TEXT;

-- Resident submissions: visible, not deleted, open window. Organizer entries: any time before the session ends.
DROP TRIGGER registration_insert_state_guard;
CREATE TRIGGER registration_insert_state_guard BEFORE INSERT ON registrations
WHEN NOT EXISTS (
 SELECT 1 FROM event_sessions s JOIN events e ON e.id=s.event_id JOIN form_versions f ON f.id=NEW.form_id
 WHERE s.id=NEW.session_id AND s.status='published' AND e.status='published' AND e.deleted_at IS NULL AND f.status='published' AND f.event_id=e.id
 AND (
  (NEW.registration_source='online' AND NEW.created_by_admin IS NULL AND e.hidden=0 AND f.id=COALESCE(s.form_id,e.default_form_id) AND s.registration_open=1
   AND s.starts_at>NEW.created_at AND (s.opens_at IS NULL OR s.opens_at<=NEW.created_at) AND (s.closes_at IS NULL OR s.closes_at>NEW.created_at))
  OR
  (NEW.registration_source='online' AND NEW.created_by_admin IS NOT NULL AND f.id=COALESCE(s.form_id,e.default_form_id) AND s.ends_at>NEW.created_at)
  OR
  (NEW.registration_source='onsite' AND NEW.status='confirmed' AND s.ends_at>NEW.created_at
   AND date(s.starts_at,'+8 hours')=date(NEW.created_at,'+8 hours')
   AND EXISTS (SELECT 1 FROM onsite_registration_forms o WHERE o.session_id=s.id AND o.form_id=f.id AND o.enabled=1)
   AND NEW.consent_at=NEW.created_at
   AND NEW.consent_version=json_extract((SELECT value FROM settings WHERE key='privacy_version'),'$')||':onsite-v1'
   AND json_extract(NEW.consent_json,'$.onsite_consent')=1
   AND (SELECT value FROM settings WHERE key='operating_ready')='true')
 )
)
BEGIN SELECT RAISE(ABORT,'session_or_form_changed'); END;

-- Resident submissions may not exceed the per-registration limit (organizer entries are exempt).
CREATE TRIGGER registration_seat_limit_insert BEFORE INSERT ON registrations
WHEN NEW.created_by_admin IS NULL AND NEW.registration_source='online' AND NEW.seats>(SELECT max_seats_per_registration FROM event_sessions WHERE id=NEW.session_id)
BEGIN SELECT RAISE(ABORT,'seat_limit_exceeded'); END;
CREATE TRIGGER registration_seat_limit_update BEFORE UPDATE OF seats ON registrations
WHEN NEW.seats>OLD.seats AND NEW.created_by_admin IS NULL AND NEW.registration_source='online' AND NEW.seats>(SELECT max_seats_per_registration FROM event_sessions WHERE id=NEW.session_id)
BEGIN SELECT RAISE(ABORT,'seat_limit_exceeded'); END;

-- Confirmed on insert (on-site, or an organizer entering a confirmed seat) gets a confirmation instead of a receipt.
DROP TRIGGER receipt_insert;
CREATE TRIGGER receipt_insert AFTER INSERT ON registrations BEGIN
 INSERT INTO email_jobs(id,registration_id,session_id,kind,unique_key,due_at,created_at,updated_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,NEW.session_id,
 CASE WHEN NEW.registration_source='onsite' OR (NEW.created_by_admin IS NOT NULL AND NEW.status='confirmed') THEN 'confirmation' ELSE 'receipt' END,
 CASE WHEN NEW.registration_source='onsite' OR (NEW.created_by_admin IS NOT NULL AND NEW.status='confirmed') THEN 'confirmation:' ELSE 'receipt:' END||NEW.id||':'||NEW.generation,
 NEW.created_at,NEW.created_at,NEW.created_at);
END;
-- Organizer-confirmed entries also get the day-before reminder that a status change to confirmed would create.
CREATE TRIGGER registration_admin_reminder AFTER INSERT ON registrations WHEN NEW.created_by_admin IS NOT NULL AND NEW.status='confirmed' BEGIN
 INSERT OR IGNORE INTO email_jobs(id,registration_id,session_id,kind,unique_key,due_at,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),NEW.id,NEW.session_id,'reminder','reminder:'||NEW.id||':'||NEW.generation||':'||s.revision,s.reminder_at,NEW.created_at,NEW.created_at
 FROM event_sessions s WHERE s.id=NEW.session_id AND s.reminder_enabled=1 AND s.reminder_at>NEW.created_at;
END;

-- Images uploaded for the site itself (banners, About page), separate from event photos.
CREATE TABLE site_images (
 id TEXT PRIMARY KEY, object_key TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, size INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
 alt TEXT NOT NULL DEFAULT '' CHECK(length(alt)<=300), created_at TEXT NOT NULL
);

CREATE TABLE banners (
 id TEXT PRIMARY KEY, image_id TEXT NOT NULL REFERENCES site_images(id),
 title TEXT NOT NULL DEFAULT '' CHECK(length(title)<=200), subtitle TEXT NOT NULL DEFAULT '' CHECK(length(subtitle)<=300),
 alt TEXT NOT NULL CHECK(length(alt) BETWEEN 1 AND 300),
 event_id TEXT REFERENCES events(id), link_url TEXT CHECK(link_url IS NULL OR (length(link_url)<=500 AND (link_url LIKE 'https://%' OR link_url LIKE '/%'))),
 sort_order INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'hidden' CHECK(status IN('published','hidden')),
 starts_at TEXT, ends_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(starts_at IS NULL OR ends_at IS NULL OR ends_at>starts_at)
);
CREATE INDEX banners_order ON banners(status,sort_order,created_at);
