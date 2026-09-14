import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeLearningPages, sessionTiming, timerStatusLabel } from '../apps/web/src/components/learning-room-view.ts';

const at = seconds => new Date(Date.UTC(2026, 8, 14, 0, 0, seconds)).toISOString();
const session = (fields = {}) => ({ id: 's1', workspace_id: 'w', status: 'ACTIVE', pause_reason: null, device_id: 'me', generation: 1, lease_expires_at: at(60), last_seen_at: at(0), last_activity_at: at(0), elapsed_seconds: 0, started_at: at(0), ended_at: null, updated_at: at(0), ...fields });
const page = (fields = {}) => ({ workspace: {}, sessions: [], messages: [], jobs: [], aiEnabled: true, ...fields });

test('live snapshot wins for jobs and sessions while history adds older rows in order', () => {
 const job = (id, status, second) => ({ id, session_id: null, kind: 'WRITING_REPLY', status, output: null, created_at: at(second) });
 const message = (id, second) => ({ id, session_id: null, role: 'USER', content: id, created_at: at(second), job_id: null });
 const live = page({ jobs: [job('j1', 'SUCCEEDED', 5)], sessions: [session({ status: 'ENDED' })], messages: [message('m2', 9)], hasMore: { sessions: true, messages: false, jobs: false } });
 const history = page({ jobs: [job('j0', 'FAILED', 1), job('j1', 'RUNNING', 5)], sessions: [session({ id: 's0' }), session()], messages: [message('m1', 2), message('m2', 9)], hasMore: { sessions: false, messages: false, jobs: false } });
 const merged = mergeLearningPages([live, history]);
 assert.deepEqual(merged.jobs.map(j => [j.id, j.status]), [['j0', 'FAILED'], ['j1', 'SUCCEEDED']]);
 assert.deepEqual(merged.sessions.map(s => [s.id, s.status]), [['s0', 'ACTIVE'], ['s1', 'ENDED']]);
 assert.deepEqual(merged.messages.map(m => m.id), ['m1', 'm2']);
 assert.equal(merged.hasMore, false, 'the oldest loaded page decides whether more history exists');
 assert.equal(mergeLearningPages([live]).hasMore, true);
});

test('only the owning device counts provisional seconds, capped at the heartbeat window', () => {
 const view = { device: 'me', lastActivity: Date.parse(at(20)), pendingEnd: false };
 assert.deepEqual(sessionTiming(session(), view, Date.parse(at(30))), { provisional: 15, stale: false }, '30s since last seen is still fresh');
 assert.deepEqual(sessionTiming(session(), view, Date.parse(at(31))), { provisional: 15, stale: true });
 assert.deepEqual(sessionTiming(session({ last_seen_at: at(25) }), view, Date.parse(at(30))), { provisional: 5, stale: false });
 assert.equal(sessionTiming(session({ last_seen_at: at(25) }), { ...view, device: 'other' }, Date.parse(at(30))).provisional, 0);
 assert.equal(sessionTiming(session({ last_seen_at: at(25) }), { ...view, pendingEnd: true }, Date.parse(at(30))).provisional, 0);
 assert.deepEqual(sessionTiming(session(), view, Date.parse(at(60))), { provisional: 0, stale: true }, 'expired lease');
 assert.deepEqual(sessionTiming(session({ status: 'PAUSED' }), view, Date.parse(at(90))), { provisional: 0, stale: false });
 assert.deepEqual(sessionTiming(null, view, 0), { provisional: 0, stale: false });
});

test('timer label prefers lock and pending end over session state', () => {
 const base = { locked: false, pendingEnd: false, current: session(), stale: false, hasVideo: false };
 assert.equal(timerStatusLabel({ ...base, locked: true, pendingEnd: true }), '다른 기기에서 학습 중');
 assert.equal(timerStatusLabel({ ...base, pendingEnd: true }), '종료 동기화 대기');
 assert.equal(timerStatusLabel({ ...base, current: null, hasVideo: true }), '재생하거나 글을 쓰면 시작돼요');
 assert.equal(timerStatusLabel({ ...base, stale: true }), '일시 정지');
 assert.equal(timerStatusLabel({ ...base, current: session({ status: 'ENDED' }) }), '학습 종료 · 기록됨');
 assert.equal(timerStatusLabel(base), '학습 중 · 시간 동기화 중');
});
