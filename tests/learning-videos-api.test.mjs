import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVideoHandlers } from '../apps/web/src/lib/learning-videos-api.ts';
const id='12345678-1234-4234-9234-123456789abc';
const req=body=>new Request('http://localhost/api/learning/videos',{method:'POST',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify(body)});
function fixture(error=null){
 const calls=[];
 const handler=createVideoHandlers({url:'http://127.0.0.1:55321',key:'public'},async (url,init)=>{
  assert.equal(init.headers.Authorization,'Bearer owner');
  if(new URL(url).pathname==='/auth/v1/user')return Response.json({id});
  assert.equal(new URL(url).pathname,'/rest/v1/rpc/learning_video_command');
  const command=JSON.parse(init.body).p_command;calls.push(command);
  return error?Response.json({message:error,details:'secret'}, {status:400}):Response.json({workspace:{id:command.workspaceId},video:{video_id:command.videoId},duplicate:false});
 });return {handler,calls};
}
test('video batch authenticates once, retains valid items and deterministic retries',async()=>{
 const {handler,calls}=fixture();const body={requestId:id,items:[{url:'https://youtu.be/dQw4w9WgXcQ?t=30'},{url:'https://evil.test/path'},{url:'https://youtube.com/shorts/abcdefghijk',title:'My choice'}]};
 const result=await(await handler.POST(req(body))).json();
 assert.equal(result.results.length,3);assert.ok(result.results[1].error);assert.equal(result.results[0].video.video_id,'dQw4w9WgXcQ');assert.equal(calls.length,2);
 await handler.POST(req(body));assert.deepEqual(calls[0],calls[2]);assert.notEqual(calls[0].requestId,calls[1].requestId);assert.equal(calls[0].startSeconds,30);
 assert.equal((await handler.POST(new Request('http://localhost'))).status,401);
});
test('video API caps batch and source payloads and strips database failure details',async()=>{
 const {handler,calls}=fixture();
 for(const body of [{requestId:id,items:[]},{requestId:id,items:Array.from({length:21},()=>({url:'https://youtu.be/dQw4w9WgXcQ'}))},{requestId:id,user_id:id,items:[{url:'https://youtu.be/dQw4w9WgXcQ'}]}])assert.equal((await handler.POST(req(body))).status,400);
 assert.equal(calls.length,0);
 const source={action:'VIDEO_SOURCE',requestId:id,workspaceId:id,expectedVersion:0,transcript:'hello',contextStart:0,contextEnd:6};
 assert.equal((await handler.COMMAND(req(source))).status,400);
 const res=await fixture('LEARNING_CONFLICT').handler.COMMAND(req({...source,contextEnd:5}));assert.equal(res.status,409);assert.equal(JSON.stringify(await res.json()).includes('secret'),false);
});
