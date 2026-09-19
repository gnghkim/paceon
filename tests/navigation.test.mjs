import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeNavigation, pageTitle } from '../apps/web/src/lib/navigation.ts';

test('all resource workflows retain their parent menu', () => {
  for (const path of ['/resources', '/resources/new', '/resources/add', '/resources/import', '/resources/materials/new', '/resources/materials/123', '/resources/123']) {
    assert.equal(activeNavigation(path), '/resources');
  }
});

test('shared review belongs to today while settings has no primary selection', () => {
  assert.equal(activeNavigation('/review'), '/today');
  assert.equal(activeNavigation('/learn/review'), '/today');
  assert.equal(activeNavigation('/learn/words'), '/learn');
  assert.equal(activeNavigation('/learn/listening'), '/learn');
  assert.equal(activeNavigation('/settings'), null);
  assert.equal(activeNavigation('/resources-other'), null);
});

test('headers describe nested tasks without losing parent selection', () => {
  assert.equal(pageTitle('/resources/add'), '자료 추가');
  assert.equal(pageTitle('/resources/new'), '책 추가');
  assert.equal(pageTitle('/resources/materials/new'), '교재·강의 추가');
  assert.equal(pageTitle('/review'), '오늘의 복습');
  assert.equal(pageTitle('/learn/words'), '단어장');
});
