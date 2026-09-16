import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeLearningPages, mergeVideoVisits, playResumesPause, resolveRoomTab, roomTabs, sessionTiming, timerStatusLabel } from '../apps/web/src/components/learning-room-view.ts';

test('watch segments join into one row while a real gap, a speed change or another day stays apart', () => {
 const visit = (id, from, to, rate = 1, day = '2026-09-16') => ({ id, from_seconds: from, to_seconds: to, rate, created_at: `${day}T10:00:00Z`, workspace_id: 'w', session_id: 's', user_id: 'u' });
 const joined = mergeVideoVisits([visit('a', 3, 6), visit('b', 6, 9), visit('c', 9, 12), visit('d', 12, 15)]);
 assert.deepEqual(joined.map(v => [v.from_seconds, v.to_seconds, v.parts]), [[3, 15, 4]], '이어진 네 구간은 한 줄이 되고 횟수를 남긴다');
 const overlap = mergeVideoVisits([visit('a', 0, 10), visit('b', 5, 12)]);
 assert.deepEqual(overlap.map(v => [v.from_seconds, v.to_seconds, v.parts]), [[0, 12, 2]], '겹치는 구간도 합친다');
 const gap = mergeVideoVisits([visit('a', 0, 5), visit('b', 30, 35)]);
 assert.deepEqual(gap.map(v => [v.from_seconds, v.to_seconds]), [[0, 5], [30, 35]], '멀리 떨어진 구간은 따로 둔다');
 const speeds = mergeVideoVisits([visit('a', 0, 5, 1), visit('b', 5, 10, 2)]);
 assert.equal(speeds.length, 2, '배속이 다르면 합치지 않는다');
 const days = mergeVideoVisits([visit('a', 0, 5, 1, '2026-09-15'), visit('b', 5, 10, 1, '2026-09-16')]);
 assert.equal(days.length, 2, '다른 날의 시청은 합치지 않는다');
 assert.deepEqual(days.map(v => v.created_at.slice(0, 10)), ['2026-09-16', '2026-09-15'], '최근 날짜가 먼저 온다');
 const order = mergeVideoVisits([visit('a', 40, 45), visit('b', 10, 15)]);
 assert.deepEqual(order.map(v => v.from_seconds), [10, 40], '같은 날 안에서는 영상 위치 순으로 정렬한다');
 assert.deepEqual(mergeVideoVisits([]), []);
});

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

test('a visible play resumes a paused session, including one the user paused by hand', () => {
 assert.equal(playResumesPause(session({ status: 'PAUSED', pause_reason: 'MANUAL' }), true), true);
 assert.equal(playResumesPause(session({ status: 'PAUSED', pause_reason: 'HIDDEN' }), true), true);
 assert.equal(playResumesPause(session({ status: 'PAUSED', pause_reason: 'IDLE' }), true), true);
 assert.equal(playResumesPause(session({ status: 'PAUSED', pause_reason: 'MANUAL' }), false), false, 'a hidden tab never resumes');
 assert.equal(playResumesPause(session(), true), false, 'an active session has nothing to resume');
 assert.equal(playResumesPause(session({ status: 'ENDED' }), true), false, 'an ended session starts a new one instead');
 assert.equal(playResumesPause(null, true), false);
});

test('timer label prefers lock and pending end over session state', () => {
 const base = { locked: false, pendingEnd: false, current: session(), stale: false, kind: 'WRITING' };
 assert.equal(timerStatusLabel({ ...base, locked: true, pendingEnd: true }), '다른 기기에서 학습 중');
 assert.equal(timerStatusLabel({ ...base, pendingEnd: true }), '종료 동기화 대기');
 assert.equal(timerStatusLabel({ ...base, current: null, kind: 'LISTENING' }), '재생하거나 글을 쓰면 시작돼요');
 assert.equal(timerStatusLabel({ ...base, current: null, kind: 'SPEAKING' }), '녹음하거나 음성을 들으면 시작돼요');
 assert.equal(timerStatusLabel({ ...base, current: null }), '글을 쓰면 시작돼요');
 assert.equal(timerStatusLabel({ ...base, stale: true }), '일시 정지');
 assert.equal(timerStatusLabel({ ...base, current: session({ status: 'ENDED' }) }), '학습 종료 · 기록됨');
 assert.equal(timerStatusLabel(base), '학습 중 · 시간 동기화 중');
});

test('listening keeps four activity tabs while the other rooms keep one', () => {
 assert.deepEqual(roomTabs('LISTENING').map(t => t.id), ['video', 'speak', 'ask', 'source']);
 assert.deepEqual(roomTabs('LISTENING').map(t => t.label), ['영상·메모', '말하기', '질문·노트', '자료']);
 assert.deepEqual(roomTabs('SPEAKING').map(t => t.id), ['speak']);
 assert.deepEqual(roomTabs('WRITING').map(t => t.id), ['ask']);
});

test('an unknown or foreign view value falls back to the first tab of that room', () => {
 assert.equal(resolveRoomTab('LISTENING', 'source'), 'source');
 assert.equal(resolveRoomTab('LISTENING', null), 'video');
 assert.equal(resolveRoomTab('LISTENING', ''), 'video');
 assert.equal(resolveRoomTab('LISTENING', 'VIDEO'), 'video', '대소문자를 바꾸지 않는다. 맞는 탭이 없어 기본 탭으로 떨어진 결과다');
 assert.equal(resolveRoomTab('LISTENING', 'bogus'), 'video');
 assert.equal(resolveRoomTab('WRITING', 'speak'), 'ask', '그 방에 없는 탭은 기본 탭이 된다');
 assert.equal(resolveRoomTab('SPEAKING', 'ask'), 'speak');
});
