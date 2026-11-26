-- Baseline schema for the community events template (squashed from digital-neighbors migrations 0001–0034, data migrations excluded).
PRAGMA foreign_keys = ON;
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE events (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','cancelled')),
 default_form_id TEXT, cover_photo_id TEXT, notes TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE form_versions (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), version INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','published')),
 fields_json TEXT NOT NULL CHECK(json_valid(fields_json)), created_at TEXT NOT NULL, UNIQUE(event_id,version)
);
CREATE TABLE event_sessions (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Asia/Taipei' CHECK(timezone='Asia/Taipei'),
 location TEXT NOT NULL, capacity INTEGER NOT NULL CHECK(capacity>=0 AND capacity<=100000), fee TEXT NOT NULL DEFAULT '免費', supplies TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','cancelled')), registration_open INTEGER NOT NULL DEFAULT 0 CHECK(registration_open IN(0,1)),
 opens_at TEXT, closes_at TEXT, form_id TEXT REFERENCES form_versions(id), cover_photo_id TEXT,
 reminder_enabled INTEGER NOT NULL DEFAULT 1 CHECK(reminder_enabled IN(0,1)), reminder_time TEXT NOT NULL DEFAULT '09:00', reminder_at TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK(ends_at>starts_at)
);
CREATE INDEX session_dates ON event_sessions(event_id, starts_at);
CREATE TABLE registrations (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES event_sessions(id), code TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL, email TEXT NOT NULL, normalized_email TEXT NOT NULL, form_id TEXT NOT NULL REFERENCES form_versions(id),
 status TEXT NOT NULL CHECK(status IN('pending','confirmed','waitlisted','cancelled')), seats INTEGER NOT NULL DEFAULT 1 CHECK(seats BETWEEN 1 AND 100000), answers_json TEXT NOT NULL CHECK(json_valid(answers_json)),
 consent_at TEXT NOT NULL, consent_version TEXT NOT NULL, consent_json TEXT NOT NULL, submission_id TEXT NOT NULL UNIQUE,
 generation INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, registration_source TEXT NOT NULL DEFAULT 'online' CHECK(registration_source IN ('online','onsite')), name_signature_json TEXT CHECK(name_signature_json IS NULL OR (json_valid(name_signature_json) AND length(name_signature_json)<=20000)), participants_json TEXT CHECK(participants_json IS NULL OR (json_valid(participants_json) AND json_type(participants_json)='array' AND length(participants_json)<=30000)), UNIQUE(session_id,normalized_email)
);
CREATE INDEX registration_order ON registrations(session_id,status,created_at,id);
CREATE TABLE email_templates (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN('receipt','confirmation','reminder','reschedule','cancellation','test')), version INTEGER NOT NULL,
 subject TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(kind,version)
);
CREATE TABLE email_jobs (
 id TEXT PRIMARY KEY, registration_id TEXT REFERENCES registrations(id), session_id TEXT REFERENCES event_sessions(id), kind TEXT NOT NULL,
 unique_key TEXT NOT NULL UNIQUE, due_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processing','accepted','delivered','bounced','failed','cancelled','unknown')),
 lease_token TEXT, lease_until TEXT, attempts INTEGER NOT NULL DEFAULT 0, first_attempt_at TEXT, provider_id TEXT, payload_json TEXT,
 last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX email_due ON email_jobs(status,due_at,lease_until);
CREATE INDEX email_provider ON email_jobs(provider_id);
CREATE TABLE email_logs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES email_jobs(id), status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL);
CREATE TABLE webhook_events (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE admin_permissions (email TEXT NOT NULL, module TEXT NOT NULL, PRIMARY KEY(email,module));
CREATE TABLE audit_logs (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE event_photos (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), session_id TEXT REFERENCES event_sessions(id), object_key TEXT NOT NULL UNIQUE,
 thumbnail_key TEXT, mime TEXT NOT NULL, size INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
 caption TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'hidden' CHECK(status IN('published','hidden','removed')), created_at TEXT NOT NULL
);
CREATE INDEX photos_lookup ON event_photos(event_id,session_id,status,sort_order);
CREATE TRIGGER immutable_form BEFORE UPDATE ON form_versions WHEN OLD.status='published'
BEGIN SELECT RAISE(ABORT,'published_form_immutable'); END;
CREATE TRIGGER immutable_form_delete BEFORE DELETE ON form_versions WHEN OLD.status='published'
BEGIN SELECT RAISE(ABORT,'published_form_immutable'); END;
CREATE TRIGGER registration_insert_capacity_guard BEFORE INSERT ON registrations
WHEN NEW.status IN('pending','confirmed') AND NEW.seats+(SELECT COALESCE(SUM(seats),0) FROM registrations WHERE session_id=NEW.session_id AND status IN('pending','confirmed')) > (SELECT capacity FROM event_sessions WHERE id=NEW.session_id)
BEGIN SELECT RAISE(ABORT,'capacity_exceeded'); END;
CREATE TRIGGER registration_update_capacity_guard BEFORE UPDATE ON registrations
WHEN NEW.status IN('pending','confirmed') AND NEW.seats+(SELECT COALESCE(SUM(seats),0) FROM registrations WHERE session_id=NEW.session_id AND id<>NEW.id AND status IN('pending','confirmed')) > (SELECT capacity FROM event_sessions WHERE id=NEW.session_id)
BEGIN SELECT RAISE(ABORT,'capacity_exceeded'); END;
CREATE TRIGGER registration_update_session_guard BEFORE UPDATE ON registrations
WHEN NEW.status IN('pending','confirmed') AND NOT EXISTS (SELECT 1 FROM event_sessions s JOIN events e ON e.id=s.event_id WHERE s.id=NEW.session_id AND s.status='published' AND e.status='published' AND s.starts_at>NEW.updated_at)
BEGIN SELECT RAISE(ABORT,'session_closed'); END;
CREATE TRIGGER registration_restore_guard BEFORE UPDATE ON registrations
WHEN OLD.status='cancelled' AND NEW.generation>OLD.generation AND NOT EXISTS (SELECT 1 FROM event_sessions s JOIN events e ON e.id=s.event_id JOIN form_versions f ON f.id=COALESCE(s.form_id,e.default_form_id)
 WHERE s.id=NEW.session_id AND s.status='published' AND e.status='published' AND s.registration_open=1 AND f.status='published' AND f.id=NEW.form_id AND s.starts_at>NEW.updated_at
 AND (s.opens_at IS NULL OR s.opens_at<=NEW.updated_at) AND (s.closes_at IS NULL OR s.closes_at>NEW.updated_at))
BEGIN SELECT RAISE(ABORT,'session_or_form_changed'); END;
CREATE TRIGGER capacity_guard BEFORE UPDATE OF capacity ON event_sessions
WHEN NEW.capacity<(SELECT COALESCE(SUM(seats),0) FROM registrations WHERE session_id=NEW.id AND status IN('pending','confirmed'))
BEGIN SELECT RAISE(ABORT,'capacity_exceeded'); END;
CREATE TRIGGER receipt_restore AFTER UPDATE ON registrations WHEN NEW.generation>OLD.generation BEGIN
 INSERT INTO email_jobs(id,registration_id,session_id,kind,unique_key,due_at,created_at,updated_at) VALUES(lower(hex(randomblob(16))),NEW.id,NEW.session_id,'receipt','receipt:'||NEW.id||':'||NEW.generation,NEW.updated_at,NEW.updated_at,NEW.updated_at);
END;
CREATE TRIGGER registration_cancel_reminders BEFORE UPDATE OF status ON registrations WHEN NEW.status<>OLD.status BEGIN
 UPDATE email_jobs SET status='cancelled',updated_at=NEW.updated_at WHERE registration_id=NEW.id AND kind='reminder' AND status IN('pending','processing');
END;
CREATE TRIGGER registration_confirmation AFTER UPDATE OF status ON registrations WHEN NEW.status<>OLD.status AND NEW.status='confirmed' BEGIN
 INSERT OR IGNORE INTO email_jobs(id,registration_id,session_id,kind,unique_key,due_at,created_at,updated_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,NEW.session_id,'confirmation','confirmation:'||NEW.id||':'||NEW.generation,NEW.updated_at,NEW.updated_at,NEW.updated_at);
END;
CREATE TRIGGER registration_reminder AFTER UPDATE OF status ON registrations WHEN NEW.status<>OLD.status AND NEW.status='confirmed' BEGIN
 INSERT OR IGNORE INTO email_jobs(id,registration_id,session_id,kind,unique_key,due_at,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),NEW.id,NEW.session_id,'reminder','reminder:'||NEW.id||':'||NEW.generation||':'||s.revision,s.reminder_at,NEW.updated_at,NEW.updated_at
 FROM event_sessions s WHERE s.id=NEW.session_id AND s.reminder_enabled=1 AND s.reminder_at>NEW.updated_at;
END;
CREATE TRIGGER session_cancel_reminders BEFORE UPDATE ON event_sessions WHEN NEW.revision<>OLD.revision OR NEW.status<>'published' OR NEW.reminder_enabled=0 BEGIN
 UPDATE email_jobs SET status='cancelled',updated_at=NEW.updated_at WHERE session_id=NEW.id AND kind='reminder' AND status IN('pending','processing');
END;
CREATE TRIGGER session_create_reminders AFTER UPDATE ON event_sessions WHEN NEW.status='published' AND NEW.reminder_enabled=1 BEGIN
 INSERT OR IGNORE INTO email_jobs(id,registration_id,session_id,kind,unique_key,due_at,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),r.id,NEW.id,'reminder','reminder:'||r.id||':'||r.generation||':'||NEW.revision,NEW.reminder_at,NEW.updated_at,NEW.updated_at
 FROM registrations r JOIN events e ON e.id=NEW.event_id WHERE r.session_id=NEW.id AND r.status='confirmed' AND e.status='published' AND NEW.reminder_at>NEW.updated_at;
END;
CREATE TRIGGER event_cancel_reminders AFTER UPDATE OF status ON events WHEN NEW.status<>'published' BEGIN
 UPDATE email_jobs SET status='cancelled',updated_at=NEW.updated_at WHERE session_id IN(SELECT id FROM event_sessions WHERE event_id=NEW.id) AND kind='reminder' AND status IN('pending','processing');
END;
CREATE TABLE checkins (
 registration_id TEXT PRIMARY KEY REFERENCES registrations(id),
 session_id TEXT NOT NULL REFERENCES event_sessions(id),
 fee_snapshot TEXT NOT NULL,
 checked_in_at TEXT NOT NULL,
 checked_in_by TEXT NOT NULL
);
CREATE INDEX checkins_session ON checkins(session_id, checked_in_at);
CREATE TABLE checkin_attendees (
 registration_id TEXT NOT NULL REFERENCES checkins(registration_id) ON DELETE CASCADE,
 position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 100),
 full_name TEXT NOT NULL CHECK(length(full_name) BETWEEN 1 AND 50),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(registration_id, position)
);
CREATE TABLE checkin_attendee_details (
 registration_id TEXT NOT NULL, position INTEGER NOT NULL, signature_json TEXT CHECK(signature_json IS NULL OR (json_valid(signature_json) AND length(signature_json)<=20000)), age_group TEXT NOT NULL DEFAULT '' CHECK(age_group IN ('','大','小')), gender TEXT NOT NULL DEFAULT '' CHECK(gender IN ('','男','女','其他')), identity TEXT NOT NULL DEFAULT '' CHECK(length(identity)<=50), fee_status TEXT CHECK(fee_status IS NULL OR fee_status IN ('','free','paid')), fee_amount INTEGER CHECK(fee_amount IS NULL OR (fee_amount>=0 AND fee_amount<=1000000)),
 PRIMARY KEY(registration_id,position),
 FOREIGN KEY(registration_id,position) REFERENCES checkin_attendees(registration_id,position) ON DELETE CASCADE
);
CREATE TABLE onsite_registration_forms (
 session_id TEXT PRIMARY KEY REFERENCES event_sessions(id),
 form_id TEXT NOT NULL REFERENCES form_versions(id),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1))
);
CREATE TRIGGER registration_insert_state_guard BEFORE INSERT ON registrations
WHEN NOT EXISTS (
 SELECT 1 FROM event_sessions s JOIN events e ON e.id=s.event_id JOIN form_versions f ON f.id=NEW.form_id
 WHERE s.id=NEW.session_id AND s.status='published' AND e.status='published' AND f.status='published' AND f.event_id=e.id
 AND (
  (NEW.registration_source='online' AND f.id=COALESCE(s.form_id,e.default_form_id) AND s.registration_open=1
   AND s.starts_at>NEW.created_at AND (s.opens_at IS NULL OR s.opens_at<=NEW.created_at) AND (s.closes_at IS NULL OR s.closes_at>NEW.created_at))
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
CREATE TRIGGER receipt_insert AFTER INSERT ON registrations BEGIN
 INSERT INTO email_jobs(id,registration_id,session_id,kind,unique_key,due_at,created_at,updated_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,NEW.session_id,
 CASE WHEN NEW.registration_source='onsite' THEN 'confirmation' ELSE 'receipt' END,
 CASE WHEN NEW.registration_source='onsite' THEN 'confirmation:' ELSE 'receipt:' END||NEW.id||':'||NEW.generation,
 NEW.created_at,NEW.created_at,NEW.created_at);
END;
CREATE TABLE feedback_forms (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE REFERENCES events(id), slug TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200), description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=2000),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','closed')), template_version INTEGER NOT NULL DEFAULT 1 CHECK(template_version=1),
 published_at TEXT, closed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE feedback_responses (
 id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES feedback_forms(id),
 overall_rating INTEGER NOT NULL CHECK(overall_rating BETWEEN 1 AND 5), instructor_rating INTEGER NOT NULL CHECK(instructor_rating BETWEEN 1 AND 5),
 content_rating INTEGER NOT NULL CHECK(content_rating BETWEEN 1 AND 5), usefulness_rating INTEGER NOT NULL CHECK(usefulness_rating BETWEEN 1 AND 5),
 venue_rating INTEGER NOT NULL CHECK(venue_rating BETWEEN 1 AND 5),
 difficulty TEXT NOT NULL CHECK(difficulty IN('easy','normal','hard','very_hard')), attend_again TEXT NOT NULL CHECK(attend_again IN('yes','maybe','no')),
 comment TEXT CHECK(comment IS NULL OR length(comment)<=2000), submitted_at TEXT NOT NULL
);
CREATE INDEX feedback_responses_form ON feedback_responses(form_id,submitted_at);
CREATE TABLE feedback_invitations (
 id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES feedback_forms(id), registration_id TEXT NOT NULL REFERENCES registrations(id),
 token_nonce TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, sent_at TEXT, used_at TEXT, submission_id TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(form_id,registration_id)
);
CREATE INDEX feedback_invitations_form ON feedback_invitations(form_id,used_at,sent_at);
CREATE INDEX feedback_invitations_registration ON feedback_invitations(registration_id);
CREATE TABLE feedback_test_tokens (
 id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES feedback_forms(id), token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX feedback_jobs ON email_jobs(registration_id,kind,created_at);
CREATE TRIGGER feedback_form_status_transition BEFORE UPDATE OF status ON feedback_forms
WHEN NEW.status<>OLD.status AND NOT ((OLD.status='draft' AND NEW.status='published') OR (OLD.status='published' AND NEW.status='closed') OR (OLD.status='closed' AND NEW.status='published'))
BEGIN SELECT RAISE(ABORT,'feedback_status_invalid'); END;
CREATE TRIGGER feedback_form_event_fixed BEFORE UPDATE OF event_id,slug ON feedback_forms WHEN NEW.event_id<>OLD.event_id OR NEW.slug<>OLD.slug
BEGIN SELECT RAISE(ABORT,'feedback_form_identity_fixed'); END;
CREATE TRIGGER feedback_response_open_form BEFORE INSERT ON feedback_responses
WHEN NOT EXISTS (SELECT 1 FROM feedback_forms WHERE id=NEW.form_id AND status='published')
BEGIN SELECT RAISE(ABORT,'feedback_form_closed'); END;
CREATE TRIGGER feedback_response_immutable BEFORE UPDATE ON feedback_responses
BEGIN SELECT RAISE(ABORT,'feedback_response_immutable'); END;
CREATE TRIGGER feedback_invitation_registration BEFORE INSERT ON feedback_invitations
WHEN NOT EXISTS (SELECT 1 FROM registrations r JOIN event_sessions s ON s.id=r.session_id JOIN feedback_forms f ON f.event_id=s.event_id WHERE r.id=NEW.registration_id AND f.id=NEW.form_id)
BEGIN SELECT RAISE(ABORT,'feedback_invitation_event_mismatch'); END;
CREATE TRIGGER feedback_invitation_used_final BEFORE UPDATE ON feedback_invitations
WHEN OLD.used_at IS NOT NULL AND (NEW.used_at IS NOT OLD.used_at OR NEW.token_hash<>OLD.token_hash OR NEW.submission_id IS NOT OLD.submission_id)
BEGIN SELECT RAISE(ABORT,'feedback_token_used'); END;
CREATE TRIGGER feedback_invitation_use_guard BEFORE UPDATE OF used_at ON feedback_invitations
WHEN OLD.used_at IS NULL AND NEW.used_at IS NOT NULL AND (NEW.expires_at<=NEW.used_at OR NOT EXISTS (SELECT 1 FROM feedback_forms WHERE id=NEW.form_id AND status='published'))
BEGIN SELECT RAISE(ABORT,'feedback_form_closed'); END;
CREATE TRIGGER feedback_job_guard BEFORE INSERT ON email_jobs
WHEN NEW.kind IN('feedback_invite','feedback_reminder') AND (NEW.registration_id IS NULL
 OR EXISTS (SELECT 1 FROM email_jobs WHERE registration_id=NEW.registration_id AND kind IN('feedback_invite','feedback_reminder') AND status IN('pending','processing'))
 OR NOT EXISTS (SELECT 1 FROM feedback_invitations i JOIN feedback_forms f ON f.id=i.form_id JOIN registrations r ON r.id=i.registration_id
  WHERE i.registration_id=NEW.registration_id AND i.used_at IS NULL AND i.expires_at>NEW.created_at AND f.status='published' AND r.status IN('pending','confirmed')
  AND ((NEW.kind='feedback_invite' AND i.sent_at IS NULL) OR (NEW.kind='feedback_reminder' AND i.sent_at IS NOT NULL))))
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER feedback_invitation_sent AFTER UPDATE OF status ON email_jobs
WHEN NEW.status IN('accepted','delivered') AND NEW.kind IN('feedback_invite','feedback_reminder') AND NEW.registration_id IS NOT NULL
BEGIN UPDATE feedback_invitations SET sent_at=COALESCE(sent_at,NEW.updated_at),updated_at=NEW.updated_at WHERE registration_id=NEW.registration_id AND sent_at IS NULL; END;
