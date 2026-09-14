import assert from 'node:assert/strict';
import { test } from 'node:test';
import { learningAreas, resolveLearningArea, areaForKind, workspaceHref, learningRoomFeatures, resumeWorkspaces } from '../apps/web/src/components/learning-areas.ts';

test('areas keep a fixed tab order and fall back to listening',()=>{
 assert.deepEqual(learningAreas.map(a=>a.slug),['listening','speaking','writing']);
 assert.equal(resolveLearningArea('writing'),'writing');
 for(const stored of [null,'','reading','WRITING']) assert.equal(resolveLearningArea(stored),'listening');
 assert.equal(areaForKind('SPEAKING').label,'스피킹');
});
test('workspace links keep existing room addresses',()=>{
 assert.equal(workspaceHref({id:'a',kind:'LISTENING'}),'/learn/items/a');
 assert.equal(workspaceHref({id:'b',kind:'SPEAKING'}),'/learn/b');
 assert.equal(workspaceHref({id:'c',kind:'WRITING'}),'/learn/c');
});
test('rooms show only their area features',()=>{
 assert.deepEqual(learningRoomFeatures('LISTENING'),{video:true,writing:true,speech:true,legacySpeech:false});
 assert.deepEqual(learningRoomFeatures('SPEAKING'),{video:false,writing:false,speech:true,legacySpeech:false});
 assert.deepEqual(learningRoomFeatures('WRITING'),{video:false,writing:true,speech:false,legacySpeech:true});
});
test('resume picks the three most recent workspaces and skips archived videos',()=>{
 const w=(id,kind,updated_at)=>({id,kind,updated_at,user_id:'u',title:id,prompt:'',draft:'',draft_version:0,created_at:updated_at});
 const list={aiEnabled:true,sessions:[],workspaces:[w('old','WRITING','2026-09-01'),w('archived','LISTENING','2026-09-05'),w('new','SPEAKING','2026-09-04'),w('mid','LISTENING','2026-09-03'),w('low','WRITING','2026-09-02')],videos:[{workspace_id:'archived',archived:true},{workspace_id:'mid',archived:false}]};
 assert.deepEqual(resumeWorkspaces(list).map(x=>x.id),['new','mid','low']);
 assert.deepEqual(resumeWorkspaces(null),[]);
});
