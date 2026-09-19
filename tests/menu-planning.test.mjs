import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeSession } from '../apps/web/src/lib/session-presentation.ts';
import { availabilityFields, availabilityRules, resourceReturnPath } from '../apps/web/src/lib/availability-form.ts';

const book = { id: 'book', title: 'Reading', type: 'BOOK', workload_unit: 'PAGE' };
const material = { id: 'course', title: 'Course', type: 'COURSE', workload_unit: 'UNIT', unit_label: '강' };
test('book and course schedules resolve their own titles, quantities and detail routes', () => {
  assert.deepEqual(describeSession({ resource_id: 'book', start_page: 10, end_page: 20 }, book), {
    title: 'Reading', detail: '10–20쪽', href: '/resources/book',
  });
  assert.deepEqual(describeSession({ resource_id: 'course', unit_id: 'u', estimated_minutes: 30 }, material, { title: 'Introduction', minutes: 25 }), {
    title: 'Course', detail: 'Introduction · 25분', href: '/resources/materials/course',
  });
  assert.equal(describeSession({ resource_id: 'course', unit_id: 'u', estimated_minutes: 30 }, material).detail, '강 · 30분');
  assert.equal(describeSession({ resource_id: 'book', start_page: null, end_page: null }, book).detail, '');
});
test('missing or mismatched resources never produce a guessed detail link', () => {
  for (const resource of [undefined, material]) {
    const result = describeSession({ resource_id: 'book' }, resource);
    assert.equal(result.href, null);
    assert.equal(result.title, '자료 정보를 확인할 수 없어요');
  }
});
test('first setup leaves every weekday blank and saves only selected valid minutes', () => {
  assert.deepEqual(Object.values(availabilityFields([])), Array(7).fill(''));
  assert.deepEqual(availabilityRules({ 1: '', 2: '30', 3: '0' }), [{ isoWeekday: 2, availableMinutes: 30 }]);
  assert.deepEqual(availabilityRules({ 1: '' }), []);
  for (const value of ['1.5', '-1', '1441', 'abc']) assert.equal(availabilityRules({ 1: value }), null);
});
test('settings returns only to an exact same-app resource detail path', () => {
  const id = '22345678-1234-4234-9234-123456789abc';
  for (const path of [`/resources/${id}`, `/resources/materials/${id}`]) assert.equal(resourceReturnPath(path), path);
  for (const path of [undefined, '', 'https://evil.test', '//evil.test', '/resources/new', '/settings', `/resources/${id}/..`, `/resources/${id}?next=https://evil.test`, `/resources/%2f%2fevil.test`, `/resources/${id}#x`]) assert.equal(resourceReturnPath(path), null);
});
