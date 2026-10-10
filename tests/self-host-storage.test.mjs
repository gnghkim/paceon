import assert from 'node:assert/strict';
import { test } from 'node:test';
import { objectPath, ownersSql, parseCsv, sqlLiteral } from '../deploy/nuc7/migrate/copy-storage.mjs';

test('csv fields with commas, quotes and empty owners are read as written', () => {
  const text = 'bucket_id,name,owner,owner_id\nlearning-pdfs,"u1/a, b.pdf",11111111-1111-4111-8111-111111111111,u1\nlearning-audio,"u2/say ""hi"".webm",,\n';
  assert.deepEqual(parseCsv(text), [
    ['bucket_id', 'name', 'owner', 'owner_id'],
    ['learning-pdfs', 'u1/a, b.pdf', '11111111-1111-4111-8111-111111111111', 'u1'],
    ['learning-audio', 'u2/say "hi".webm', '', ''],
  ]);
});

test('owner SQL quotes every value and keeps a missing owner as null', () => {
  assert.equal(sqlLiteral("it's"), "'it''s'");
  assert.equal(sqlLiteral(''), 'null');
  const sql = ownersSql([['learning-pdfs', "u1/it's.pdf", '11111111-1111-4111-8111-111111111111', 'u1']]);
  assert.equal(sql, "update storage.objects set owner = '11111111-1111-4111-8111-111111111111'::uuid, owner_id = 'u1' where bucket_id = 'learning-pdfs' and name = 'u1/it''s.pdf';\n");
});

test('object paths keep folder slashes and escape the rest', () => {
  assert.equal(objectPath('learning-pdfs', 'u1/a b#.pdf'), 'learning-pdfs/u1/a%20b%23.pdf');
});
