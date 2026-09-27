import concurrent.futures
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import uuid

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/publisher_lifecycle_audit.py'
spec = importlib.util.spec_from_file_location('audit', SCRIPT)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def fixture(**changes):
    event = dict(event_id=str(uuid.uuid4()), observed_at='2026-09-27T22:00:00Z',
                 occurred_at=None, scheduler_id=None, previous_state='unknown',
                 new_state='disabled', event_type='state_observation', source='run_report',
                 actor='assistant', reason_code='safety_denial',
                 error_code='github_reservation_write_safety_denial',
                 run_correlation_id=None, correlation_source='unknown', evidence_id=str(uuid.uuid4()))
    return dict(event, **changes)


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = Path(self.temp.name) / 'audit.sqlite3'
        audit.init(self.db)

    def test_persistent_observation_retains_unknowns_and_report_source(self):
        event = fixture()
        self.assertEqual(audit.append(self.db, event)['result'], 'recorded')
        result = audit.read(self.db)[0]
        self.assertEqual(result['observation'], event)
        audit.timestamp(result['recorded_at'])

    def test_replay_after_lost_ack_is_idempotent(self):
        event = fixture()
        audit.append(self.db, event)
        self.assertEqual(audit.append(self.db, event), {'result': 'duplicate', 'sequence': 1})
        self.assertEqual(len(audit.read(self.db)), 1)

    def test_concurrent_duplicate_writers_commit_once(self):
        event = fixture()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: audit.append(self.db, event), range(16)))
        self.assertEqual(sum(r['result'] == 'recorded' for r in results), 1)
        self.assertEqual(len(audit.read(self.db)), 1)

    def test_conflicting_replay_does_not_overwrite(self):
        event = fixture()
        audit.append(self.db, event)
        with self.assertRaisesRegex(audit.AuditError, 'EVENT_ID_CONFLICT'):
            audit.append(self.db, dict(event, new_state='enabled'))
        self.assertEqual(audit.read(self.db)[0]['observation'], event)

    def test_distinct_events_same_run_survive_out_of_order_arrival(self):
        run = str(uuid.uuid4())
        end = fixture(run_correlation_id=run, correlation_source='observer', event_type='run_finished')
        start = fixture(run_correlation_id=run, correlation_source='observer', event_type='run_started', observed_at='2026-09-27T21:00:00Z')
        audit.append(self.db, end)
        audit.append(self.db, start)
        self.assertEqual([r['observation'] for r in audit.read(self.db)], [end, start])

    def test_update_and_delete_rejected(self):
        audit.append(self.db, fixture())
        with sqlite3.connect(self.db) as db:
            for sql in ['DELETE FROM events', "UPDATE events SET payload='{}'"]:
                with self.assertRaisesRegex(sqlite3.IntegrityError, 'APPEND_ONLY'):
                    db.execute(sql)
        self.assertEqual(len(audit.read(self.db)), 1)

    def test_failed_transaction_leaves_no_partial_event(self):
        with sqlite3.connect(self.db) as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute("INSERT INTO events(event_id,recorded_at,payload) VALUES ('x','x','{}')")
            db.rollback()
        self.assertEqual(audit.read(self.db), [])

    def test_ui_failure_cannot_become_disabled_state(self):
        event = fixture(source='ui', event_type='observation_failed', actor='unknown', reason_code='unknown', error_code='ui_load_failed')
        with self.assertRaisesRegex(audit.AuditError, 'UNSUPPORTED_ATTRIBUTION'):
            audit.append(self.db, event)
        audit.append(self.db, dict(event, new_state='unknown'))

    def test_rejects_secrets_raw_text_and_unknown_fields(self):
        for change in [dict(token='secret'), dict(reason_code='Bearer secret'),
                       dict(actor='somebody@example.com'), dict(event_id='../../queue/x'),
                       dict(evidence_id='https://example.test/?token=secret')]:
            with self.assertRaises(audit.AuditError):
                audit.append(self.db, fixture(**change))
        self.assertEqual(audit.read(self.db), [])

    def test_invalid_time_correlation_and_types(self):
        for change in [dict(observed_at='2026-02-30T00:00:00Z'), dict(observed_at='2026-09-27T22:00:00'),
                       dict(occurred_at='2026-09-28T00:00:00Z'), dict(actor=[]),
                       dict(run_correlation_id=str(uuid.uuid4())), dict(correlation_source='platform'),
                       dict(scheduler_id=True)]:
            with self.assertRaises(audit.AuditError):
                audit.append(self.db, fixture(**change))

    def test_strict_bounded_json(self):
        for raw in [b'x' * 8193, b'{"event_id":1,"event_id":2}', b'\xff', b'null']:
            with self.assertRaises(audit.AuditError):
                audit.decode(raw)

    def test_never_creates_or_clobbers_existing_storage(self):
        before = self.db.read_bytes()
        with self.assertRaises(FileExistsError):
            audit.init(self.db)
        self.assertEqual(self.db.read_bytes(), before)
        missing = Path(self.temp.name) / 'missing.sqlite3'
        with self.assertRaises(audit.AuditError):
            audit.append(missing, fixture())
        self.assertFalse(missing.exists())
        link = Path(self.temp.name) / 'link.sqlite3'
        link.symlink_to(self.db)
        with self.assertRaises(audit.AuditError):
            audit.append(link, fixture())
        other = Path(self.temp.name) / 'other.sqlite3'
        with sqlite3.connect(other) as db:
            db.execute('CREATE TABLE unrelated (id TEXT)')
        with self.assertRaisesRegex(audit.AuditError, 'INVALID_DB_SCHEMA'):
            audit.append(other, fixture())

    def test_cli_roundtrip_and_sanitized_errors(self):
        event = fixture()
        proc = subprocess.run([sys.executable, str(SCRIPT), 'append', '--db', str(self.db)], input=json.dumps(event), text=True, capture_output=True)
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(json.loads(proc.stdout)['result'], 'recorded')
        proc = subprocess.run([sys.executable, str(SCRIPT), 'append', '--db', str(self.db)], input='{"token":"SECRET_CANARY"}', text=True, capture_output=True)
        self.assertEqual(proc.returncode, 1)
        self.assertNotIn('SECRET_CANARY', proc.stdout + proc.stderr)
        self.assertEqual(json.loads(proc.stderr), {'error': 'INVALID_FIELDS'})


if __name__ == '__main__':
    unittest.main()
