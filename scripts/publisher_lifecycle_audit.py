"""Offline observation journal. No scheduler, publication, network, or credential API."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import uuid

APP_ID = 0x4D323441
MAX_BYTES = 8192
FIELDS = {
    'event_id', 'observed_at', 'occurred_at', 'scheduler_id',
    'previous_state', 'new_state', 'event_type', 'source', 'actor',
    'reason_code', 'error_code', 'run_correlation_id', 'correlation_source',
    'evidence_id',
}
ENUMS = {
    'previous_state': {'unknown', 'enabled', 'disabled'},
    'new_state': {'unknown', 'enabled', 'disabled'},
    'event_type': {'state_observation', 'run_started', 'run_finished', 'run_failed', 'observation_failed'},
    'source': {'ui', 'run_report', 'platform_audit'},
    'actor': {'unknown', 'assistant', 'user', 'platform'},
    'reason_code': {'unknown', 'safety_denial', 'approval_required', 'inactivity', 'chat_deleted', 'manual_pause'},
    'error_code': {'none', 'unknown', 'github_reservation_write_safety_denial', 'ui_load_failed'},
    'correlation_source': {'unknown', 'observer', 'platform'},
}


class AuditError(Exception):
    pass


def timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z', value):
        raise AuditError('INVALID_TIMESTAMP')
    try:
        dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise AuditError('INVALID_TIMESTAMP') from None


def identifier(value):
    try:
        if not isinstance(value, str) or str(uuid.UUID(value)) != value:
            raise ValueError()
    except (ValueError, AttributeError):
        raise AuditError('INVALID_IDENTIFIER') from None


def validate(event):
    if not isinstance(event, dict) or set(event) != FIELDS:
        raise AuditError('INVALID_FIELDS')
    for key, allowed in ENUMS.items():
        if not isinstance(event[key], str) or event[key] not in allowed:
            raise AuditError('INVALID_ENUM')
    for key in ('event_id', 'evidence_id'):
        identifier(event[key])
    timestamp(event['observed_at'])
    if event['occurred_at'] is not None:
        timestamp(event['occurred_at'])
        if dt.datetime.fromisoformat(event['occurred_at'].replace('Z', '+00:00')) > dt.datetime.fromisoformat(event['observed_at'].replace('Z', '+00:00')):
            raise AuditError('INVALID_TIME_ORDER')
    if event['scheduler_id'] is not None and (not isinstance(event['scheduler_id'], str) or not re.fullmatch(r'[0-9a-f]{32}', event['scheduler_id'])):
        raise AuditError('INVALID_SCHEDULER_ID')
    if event['run_correlation_id'] is not None:
        identifier(event['run_correlation_id'])
    if (event['run_correlation_id'] is None) != (event['correlation_source'] == 'unknown'):
        raise AuditError('INVALID_CORRELATION')
    # UI absence/loading failures do not establish state transitions or attribution.
    if event['event_type'] == 'observation_failed' and any([
        event['previous_state'] != 'unknown', event['new_state'] != 'unknown',
        event['actor'] != 'unknown', event['reason_code'] != 'unknown',
    ]):
        raise AuditError('UNSUPPORTED_ATTRIBUTION')
    if event['source'] == 'ui' and (event['actor'] != 'unknown' or event['reason_code'] != 'unknown'):
        raise AuditError('UNSUPPORTED_ATTRIBUTION')
    # Reports can carry claims, but never become authoritative scheduler events.
    return json.dumps(event, sort_keys=True, separators=(',', ':'), allow_nan=False)


def decode(raw):
    if len(raw) > MAX_BYTES:
        raise AuditError('INPUT_TOO_LARGE')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise AuditError('DUPLICATE_FIELD')
            result[key] = value
        return result
    try:
        event = json.loads(raw, object_pairs_hook=pairs)
    except (ValueError, UnicodeError, RecursionError):
        raise AuditError('INVALID_JSON') from None
    validate(event)
    return event


def init(path):
    path = Path(path)
    if path.suffix != '.sqlite3':
        raise AuditError('INVALID_DB_PATH')
    # Never truncate an existing file, including symlinks.
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    with sqlite3.connect(path) as db:
        db.executescript(f'''
            PRAGMA application_id={APP_ID};
            PRAGMA user_version=1;
            CREATE TABLE events (
                sequence INTEGER PRIMARY KEY,
                event_id TEXT NOT NULL UNIQUE,
                recorded_at TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE TRIGGER no_update BEFORE UPDATE ON events
            BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
            CREATE TRIGGER no_delete BEFORE DELETE ON events
            BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
        ''')


def connect(path, readonly=False):
    path = Path(path)
    if path.is_symlink() or path.suffix != '.sqlite3' or not path.is_file():
        raise AuditError('INVALID_DB_PATH')
    # Explicit mode prevents an append/read command from creating another DB.
    db = sqlite3.connect(path.absolute().as_uri() + ('?mode=ro' if readonly else '?mode=rw'), uri=True, timeout=5)
    if db.execute('PRAGMA application_id').fetchone()[0] != APP_ID or db.execute('PRAGMA user_version').fetchone()[0] != 1:
        db.close()
        raise AuditError('INVALID_DB_SCHEMA')
    return db


def append(path, event):
    payload = validate(event)
    db = connect(path)
    try:
        with db:
            db.execute('BEGIN IMMEDIATE')
            old = db.execute('SELECT sequence, payload FROM events WHERE event_id=?', (event['event_id'],)).fetchone()
            if old:
                if old[1] != payload:
                    raise AuditError('EVENT_ID_CONFLICT')
                return {'result': 'duplicate', 'sequence': old[0]}
            recorded_at = dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')
            cursor = db.execute('INSERT INTO events(event_id, recorded_at, payload) VALUES (?, ?, ?)', (event['event_id'], recorded_at, payload))
            return {'result': 'recorded', 'sequence': cursor.lastrowid}
    finally:
        db.close()


def read(path):
    db = connect(path, readonly=True)
    try:
        return [dict(sequence=seq, recorded_at=when, observation=json.loads(payload))
                for seq, when, payload in db.execute('SELECT sequence, recorded_at, payload FROM events ORDER BY sequence')]
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['init', 'append', 'list'])
    parser.add_argument('--db', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'init':
            init(args.db)
            result = {'result': 'initialized'}
        elif args.command == 'append':
            result = append(args.db, decode(sys.stdin.buffer.read(MAX_BYTES + 1)))
        else:
            result = read(args.db)
        print(json.dumps(result, sort_keys=True))
        return 0
    except AuditError as exc:
        print(json.dumps({'error': str(exc)}), file=sys.stderr)
    except (OSError, sqlite3.Error):
        # Never print paths, SQL, payloads, provider errors or exception details.
        print('{"error":"AUDIT_STORAGE_ERROR"}', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
