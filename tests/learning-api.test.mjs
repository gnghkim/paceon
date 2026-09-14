import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLearningCommand, learningOutputSchema } from '../apps/web/src/lib/learning.ts';
import { createLearningHandlers } from '../apps/web/src/lib/learning-api.ts';
const id = '12345678-1234-4234-9234-123456789abc';
const other = '22345678-1234-4234-9234-123456789abc';
const request = body => new Request('http://localhost/api/learning', { headers: { Authorization:'Bearer owner', 'Content-Type':'application/json' }, ...(body ? {method:'POST',body:JSON.stringify(body)} : {}) });
const create = {action:'CREATE',requestId:id,workspaceId:id,title:'영어 한 문장',prompt:''};
const output = {summary:'문장을 정리했어요.',corrections:[],expressions:[],nextPrompt:'다음 문장을 써보세요.'};
function fixture({enabled=true,missing=false,sqlError=null,jobOutput=output}={}) {
 const writes=[];
 const handlers=createLearningHandlers({url:'http://127.0.0.1:55321',key:'public'},enabled,async (url,init)=>{
  assert.equal(init.headers.Authorization,'Bearer owner');
  const u=new URL(url), path=u.pathname;
  if(path.endsWith('/auth/v1/user')) return Response.json({id});
  if(path.endsWith('/rpc/learning_command')) {
    writes.push(JSON.parse(init.body));
    return sqlError ? Response.json({code:'P0001',message:sqlError,details:'private database details'}, {status:400}) : Response.json({workspace:{id,user_id:id,title:create.title}});
  }
  assert.equal(u.searchParams.get('user_id'),`eq.${id}`);
  if(path.endsWith('/learning_workspaces')) return Response.json(missing?[]:[{id,user_id:id,title:create.title,draft:'',draft_version:0}]);
  if(path.endsWith('/learning_ai_jobs')) return Response.json([{id,workspace_id:id,kind:'WRITING_REPLY',status:'SUCCEEDED',output:jobOutput,input:{secret:'private-input'},lease_token:'private-lease',provider_response_id:'private-provider',created_at:'2026-09-14',updated_at:'2026-09-14'}]);
  return Response.json([]);
 });
 return {handlers,writes};
}
test('learning commands reject unknown fields, bad timezone, untrusted seconds and oversized drafts',()=>{
 assert.equal(parseLearningCommand(create).title,create.title);
 for(const c of [{...create,user_id:other},{...create,title:''},{action:'START',requestId:id,workspaceId:id,deviceId:id,timezone:'Fake/Zone'},{action:'HEARTBEAT',requestId:id,sessionId:id,deviceId:id,generation:1,activity:true,elapsed_seconds:500},{action:'SAVE_DRAFT',requestId:id,workspaceId:id,expectedVersion:0,draft:'x'.repeat(8001)}]) assert.throws(()=>parseLearningCommand(c));
 assert.equal(learningOutputSchema.safeParse({...output,unknown:true}).success,false);
 const original='\n  I went home.  \n';
 assert.equal(parseLearningCommand({action:'MESSAGE',requestId:id,workspaceId:id,sessionId:id,deviceId:id,generation:1,content:original}).content,original);
});
test('learning mutation authenticates, uses user token and preserves idempotency key',async()=>{
 const {handlers,writes}=fixture();
 assert.equal((await handlers.COMMAND(request(create))).status,201);
 assert.deepEqual(writes,[{p_command:create}]);
 assert.equal((await handlers.COMMAND(new Request('http://localhost'))).status,401);
 assert.equal((await handlers.COMMAND(request({...create,surprise:1}))).status,400);
});
test('learning snapshots hide worker internals and invalid generated output',async()=>{
 const good=await (await fixture().handlers.GET(request(),id)).json();
 assert.equal(good.jobs[0].output.summary,output.summary);
 assert.equal(JSON.stringify(good).includes('private-'),false);
 const bad=await (await fixture({jobOutput:{secret:'bad'}}).handlers.GET(request(),id)).json();
 assert.equal(bad.jobs[0].status,'FAILED');
 assert.equal(bad.jobs[0].output,null);
 assert.equal((await fixture({missing:true}).handlers.GET(request(),other)).status,404);
});
test('AI off still permits draft/room writes and rejects AI commands before DB call',async()=>{
 const {handlers,writes}=fixture({enabled:false});
 assert.equal((await handlers.COMMAND(request(create))).status,201);
 assert.equal((await handlers.COMMAND(request({action:'MESSAGE',requestId:other,workspaceId:id,sessionId:id,deviceId:id,generation:1,content:'I went home.'}))).status,503);
 assert.equal(writes.length,1);
});
test('database failures map to safe HTTP status without exposing raw details',async()=>{
 for(const [error,status] of [['LEARNING_CONFLICT',409],['LEARNING_NOT_FOUND',404],['LEARNING_INVALID',400],['LEARNING_LIMIT',429],['unrecognized internal secret',503]]) {
  const response=await fixture({sqlError:error}).handlers.COMMAND(request(create));
  assert.equal(response.status,status);
  assert.equal(JSON.stringify(await response.json()).includes('private'),false);
 }
});
