import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createSpeechHandlers } from '../apps/web/src/lib/speech-api.ts';
import { createLearningHandlers } from '../apps/web/src/lib/learning-api.ts';

test('real Auth/Storage speech upload, retry, owner isolation and audio-only deletion', async () => {
 const status=spawnSync('supabase',['status','-o','json'],{encoding:'utf8',windowsHide:true});assert.equal(status.status,0);
 const local=JSON.parse(status.stdout);assert.equal(new URL(local.API_URL).port,'55321');
 const config={url:local.API_URL,key:local.ANON_KEY}, ownerIds=[];
 const admin={apikey:local.SERVICE_ROLE_KEY,Authorization:`Bearer ${local.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
 async function user() {
  const email=`speech-test-${randomUUID()}@paceon.test`,password=randomUUID()+randomUUID();
  const created=await fetch(`${local.API_URL}/auth/v1/admin/users`,{method:'POST',headers:admin,body:JSON.stringify({email,password,email_confirm:true})});assert.ok(created.ok);
  const owner=await created.json();ownerIds.push(owner.id);
  const response=await fetch(`${local.API_URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:local.ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.ok(response.ok);
  return {id:owner.id,headers:{Authorization:`Bearer ${(await response.json()).access_token}`}};
 }
 const request=(owner,path,body)=>new Request('http://local'+path,{headers:{...owner.headers,'Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 try {
  const alice=await user(),bob=await user(),workspaceId=randomUUID(),id=randomUUID();
  const speech=createSpeechHandlers(config,true),learning=createLearningHandlers(config,false);
  const made=await learning.COMMAND(request(alice,'/api/learning/commands',{action:'CREATE',requestId:randomUUID(),workspaceId,title:'Storage integration',prompt:'',kind:'SPEAKING'}));assert.equal(made.status,201);
  // Recognizable container but no valid frames: worker rejects before any paid provider call.
  const bytes=Buffer.alloc(44);bytes.write('RIFF');bytes.writeUInt32LE(36,4);bytes.write('WAVE',8);
  const upload=()=>new Request('http://local/api/learning/speech/upload',{method:'POST',headers:{...alice.headers,'Content-Type':'audio/wav','x-speech-id':id,'x-workspace-id':workspaceId},body:bytes});
  const response=await speech.UPLOAD(upload());assert.equal(response.status,202,JSON.stringify(await response.clone().json()));
  assert.equal((await response.json()).item.id,id);
  assert.equal((await speech.UPLOAD(upload())).status,202,'same bytes retry accepts existing object');
  assert.equal((await speech.AUDIO(request(bob,'/audio'),id)).status,404);
  const own=await speech.AUDIO(request(alice,'/audio'),id);assert.equal(own.status,200);assert.deepEqual(Buffer.from(await own.arrayBuffer()),bytes);
  const foreign=await speech.LIST(request(bob,`/speech?workspaceId=${workspaceId}`));assert.deepEqual((await foreign.json()).items,[]);
  // Wait for invalid decoder result, never modify an active worker lease.
  let item;
  for(let n=0;n<60;n++) {
   const list=await speech.LIST(request(alice,`/speech?workspaceId=${workspaceId}`));item=(await list.json()).items[0];
   if(item.status==='FAILED')break;
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.equal(item.status,'FAILED','configured local worker rejects invalid audio');assert.equal(item.error_code,'INVALID_AUDIO');
  const removed=await speech.COMMAND(request(alice,'/commands',{action:'DELETE_AUDIO',requestId:randomUUID(),id}));assert.equal(removed.status,200);
  const preserved=(await removed.json()).item;assert.equal(preserved.status,'FAILED');assert.ok(preserved.audio_deleted_at);assert.equal(preserved.original_text,item.original_text);
  assert.equal((await speech.AUDIO(request(alice,'/audio'),id)).status,404);
 } finally {
  for(const id of ownerIds) { const result=await fetch(`${local.API_URL}/auth/v1/admin/users/${id}`,{method:'DELETE',headers:admin});assert.ok(result.ok); }
 }
});
