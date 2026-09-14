import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSpeechHandlers } from '../apps/web/src/lib/speech-api.ts';
const id='12345678-1234-4234-9234-123456789abc';
const headers={Authorization:'Bearer owner'};
const config={url:'http://127.0.0.1:55321',key:'public'};
const command=body=>new Request('http://localhost/api/learning/speech/commands',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
function fixture(override=()=>null,enabled=true) {
 const calls=[];
 const handlers=createSpeechHandlers(config,enabled,async(url,init)=>{
  const parsed=new URL(url); calls.push({url:parsed,init});
  if(parsed.pathname==='/auth/v1/user')return Response.json({id});
  assert.equal(init.headers.Authorization,'Bearer owner');
  const result=override(parsed,init); if(result)return result;
  if(parsed.pathname.endsWith('begin_speech_upload'))return Response.json({id,status:'UPLOADING'});
  if(parsed.pathname.endsWith('queue_speech_recording'))return Response.json({id,status:'QUEUED'});
  if(parsed.pathname.startsWith('/storage/'))return Response.json({});
  if(parsed.pathname.endsWith('/learning_speech'))return Response.json([]);
  return Response.json({item:{id,status:'QUEUED'}});
 });return {handlers,calls};
}
test('speech command authentication, strict validation and disabled paid requests',async()=>{
 const {handlers,calls}=fixture();
 assert.equal((await handlers.COMMAND(new Request('http://localhost'))).status,401);
 assert.equal((await handlers.COMMAND(command({action:'PROMPT',requestId:id,id,workspaceId:id,level:'EASY',topic:'daily life',user_id:id}))).status,400);
 assert.equal(calls.filter(c=>c.url.pathname.startsWith('/rest/')).length,0);
 assert.equal((await fixture(()=>null,false).handlers.COMMAND(command({action:'PROMPT',requestId:id,id,workspaceId:id,level:'EASY',topic:'daily life'}))).status,503);
 assert.equal((await handlers.COMMAND(command({action:'SPEECH_TICK',requestId:id,sessionId:id,deviceId:id,generation:1,playing:true}))).status,200);
});
test('speech list is owner/workspace scoped and never selects provider or lease data',async()=>{
 const {handlers,calls}=fixture();
 assert.equal((await handlers.LIST(new Request(`http://localhost/api/learning/speech?workspaceId=${id}`,{headers}))).status,200);
 const query=calls.find(c=>c.url.pathname.endsWith('/learning_speech')).url.searchParams;
 assert.equal(query.get('user_id'),`eq.${id}`);assert.equal(query.get('workspace_id'),`eq.${id}`);
 assert.doesNotMatch(query.get('select'),/storage_path|lease|input|sha256|\*/);
});
function upload(bytes,mime='audio/webm') {
 return new Request('http://localhost/api/learning/speech/upload',{method:'POST',headers:{...headers,'Content-Type':mime,'x-speech-id':id,'x-workspace-id':id,'x-session-id':id,'x-reference-text':encodeURIComponent('Hello world.')},body:bytes});
}
test('speech upload rejects forged format and streamed oversize before database writes',async()=>{
 const {handlers,calls}=fixture();
 assert.equal((await handlers.UPLOAD(upload(new TextEncoder().encode('not audio')))).status,400);
 assert.equal((await handlers.UPLOAD(upload(new Uint8Array(10*1024*1024+1)))).status,413);
 assert.equal((await handlers.UPLOAD(upload(new Uint8Array(20),'text/html'))).status,415);
 assert.equal(calls.filter(c=>c.url.pathname.startsWith('/rest/')).length,0);
});
test('speech upload binds bytes hash and metadata, immutable owner path, then explicit analysis queue',async()=>{
 const {handlers,calls}=fixture();const bytes=new Uint8Array([0x1a,0x45,0xdf,0xa3,...Array(20).fill(0)]);
 assert.equal((await handlers.UPLOAD(upload(bytes))).status,202);
 const begin=calls.find(c=>c.url.pathname.endsWith('begin_speech_upload'));
 const body=JSON.parse(begin.init.body);assert.match(body.p_content_sha256,/^[a-f0-9]{64}$/);assert.equal(body.p_reference_text,'Hello world.');
 const storage=calls.find(c=>c.url.pathname.startsWith('/storage/'));assert.equal(storage.url.pathname,`/storage/v1/object/learning-audio/${id}/${id}/recording`);assert.equal(storage.init.headers['x-upsert'],'false');
 assert.ok(calls.at(-1).url.pathname.endsWith('queue_speech_recording'));
});
test('speech audio refuses foreign paths and hides storage/provider failures',async()=>{
 const {handlers,calls}=fixture(url=>url.pathname.endsWith('speech_audio_path')?Response.json({storage_path:`other/${id}/sample.mp3`,mime_type:'audio/mpeg'}):null);
 assert.equal((await handlers.AUDIO(new Request('http://localhost',{headers}),id)).status,409);
 assert.equal(calls.some(c=>c.url.pathname.startsWith('/storage/')),false);
 const fail=fixture(url=>url.pathname.endsWith('learning_speech_command')?Response.json({message:'LEARNING_LIMIT',detail:'private-provider-data'},{status:400}):null);
 const response=await fail.handlers.COMMAND(command({action:'DELETE',requestId:id,id}));assert.equal(response.status,429);assert.doesNotMatch(await response.text(),/private-provider/);
});
test('speech area violations map to a safe conflict',async()=>{
 const {handlers}=fixture(parsed=>parsed.pathname.endsWith('learning_speech_command')?Response.json({message:'LEARNING_KIND',details:'secret'},{status:400}):null);
 const response=await handlers.COMMAND(command({action:'PROMPT',requestId:id,id,workspaceId:id,level:'EASY',topic:''}));
 assert.equal(response.status,409);
 assert.deepEqual(await response.json(),{error:'이 영역에서는 사용할 수 없는 기능이에요.'});
});
