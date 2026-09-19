import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterLibrary } from '../apps/web/src/lib/library-filters.ts';

const item = (id, status = 'ACTIVE', author = null) => ({ id, title: id, status, author });
const books = [item('Book', 'ACTIVE', 'Alice'), item('Finished', 'COMPLETED'), item('Archived', 'ARCHIVED')];
const materials = [item('Course', 'ACTIVE', 'ALICE'), item('Textbook', 'COMPLETED'), item('Old course', 'ARCHIVED')];
const view = (type = 'all', status = 'all', query = '', resources = books, units = materials) => filterLibrary(resources, units, type, status, query);

test('all excludes archived resources and ignores the hidden book status', () => {
  const result = view('all', 'ARCHIVED');
  assert.deepEqual(result.books.map(x => x.id), ['Book', 'Finished']);
  assert.deepEqual(result.materials.map(x => x.id), ['Course', 'Textbook']);
});
test('book filters retain archived access and do not affect materials after switching type', () => {
  assert.deepEqual(view('books', 'ARCHIVED').books.map(x => x.id), ['Archived']);
  assert.deepEqual(view('books', 'COMPLETED').books.map(x => x.id), ['Finished']);
  assert.deepEqual(view('books').materials, []);
  const result = view('materials', 'ARCHIVED');
  assert.deepEqual(result.books, []);
  assert.deepEqual(result.materials.map(x => x.id), ['Course', 'Textbook']);
});
test('title and author search uses the same trimmed case-insensitive rule for both types', () => {
  const result = view('all', 'all', ' aLiCe ');
  assert.deepEqual(result.books.map(x => x.id), ['Book']);
  assert.deepEqual(result.materials.map(x => x.id), ['Course']);
  assert.deepEqual(view('materials', 'all', 'text').materials.map(x => x.id), ['Textbook']);
});
test('empty states distinguish an empty library, missing type, search and status results', () => {
  assert.equal(view('all', 'all', '', [], []).empty, 'library');
  assert.equal(view('books', 'all', '', [], materials).empty, 'type');
  assert.equal(view('materials', 'all', '', books, []).empty, 'type');
  assert.equal(view('all', 'all', 'missing').empty, 'search');
  assert.equal(view('books', 'COMPLETED', '', [books[0]], []).empty, 'filter');
  assert.equal(view('all', 'all', '', [books[2]], []).empty, 'filter');
  assert.equal(view('all', 'all', '', [], materials).empty, null);
});
