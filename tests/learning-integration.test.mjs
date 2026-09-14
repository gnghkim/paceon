import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

test('LR1/LR2 routes preserve writing, video sources, lease timing and owner isolation', {timeout:120000}, async () => {
  const status=spawnSync('supabase',['status','-o','json'],{encoding:'utf8',windowsHide:true});
  assert.equal(status.status,0,'Supabase Local available');
  const config=JSON.parse(status.stdout), base=new URL(config.API_URL);
  assert.equal(base.port,'55321');assert.ok(['127.0.0.1','localhost'].includes(base.hostname));
  const admin={apikey:config.SERVICE_ROLE_KEY,Authorization:`Bearer ${config.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
  const userIds=[];
  const server=spawn(process.execPath,['apps/web/node_modules/next/dist/bin/next','start','apps/web','--hostname','127.0.0.1','--port','0'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,AI_ENABLED:'true'}});
  let origin='',out='';server.stdout.on('data',chunk=>{out=(out+chunk).slice(-4096);origin=out.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]??origin;});server.stderr.resume();
  async function adminApi(path,body,method='POST') {
    const res=await fetch(new URL(path,base),{method,headers:admin,...(body?{body:JSON.stringify(body)}:{})});
    assert.ok(res.ok,`local admin fixture ${res.status}`);return res.status===204?null:res.json();
  }
  async function user() {
    const email=`lr-test-${randomUUID()}@paceon.test`,password=randomUUID()+randomUUID();
    const created=await adminApi('/auth/v1/admin/users',{email,password,email_confirm:true});userIds.push(created.id);
    const res=await fetch(new URL('/auth/v1/token?grant_type=password',base),{method:'POST',headers:{apikey:config.ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    assert.ok(res.ok);return {id:created.id,token:(await res.json()).access_token};
  }
  const api=(owner,path,body,method=body?'POST':'GET')=>fetch(new URL(path,origin),{method,headers:{'Content-Type':'application/json',...(owner?{Authorization:`Bearer ${owner.token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
  async function command(owner,body,expected=200) {
    const res=await api(owner,'/api/learning/commands',body);assert.equal(res.status,expected,`command ${body.action}`);return res.json();
  }
  const cmd=(action,fields)=>({action,requestId:randomUUID(),...fields});
  try {
    for(let n=0;n<100&&!origin;n++) await new Promise(r=>setTimeout(r,100));
    assert.ok(origin,'production server running');
    const alice=await user(),bob=await user(),workspaceId=randomUUID(),deviceId=randomUUID();
    const create=cmd('CREATE',{workspaceId,title:'Temporary LR1',prompt:'Write about today.',kind:'WRITING'});
    assert.equal((await api(null,'/api/learning/workspaces')).status,401);
    const first=await command(alice,create,201),repeat=await command(alice,create,201);assert.deepEqual(first,repeat);
    assert.equal((await api(bob,`/api/learning/workspaces/${workspaceId}`)).status,404);
    const writingList=await (await api(alice,'/api/learning/workspaces?kind=WRITING')).json();
    assert.ok(writingList.workspaces.some(w=>w.id===workspaceId&&w.kind==='WRITING'),'writing tab lists writing workspace');
    assert.equal((await (await api(alice,'/api/learning/workspaces?kind=SPEAKING')).json()).workspaces.some(w=>w.id===workspaceId),false,'speaking tab excludes writing workspace');
    const speakingId=randomUUID();
    await command(alice,cmd('CREATE',{workspaceId:speakingId,title:'Temporary speaking',prompt:'',kind:'SPEAKING'}),201);
    await command(alice,cmd('SAVE_DRAFT',{workspaceId:speakingId,expectedVersion:0,draft:'Not here.'}),409);
    const draft=cmd('SAVE_DRAFT',{workspaceId,expectedVersion:0,draft:'I goed to the park.'});
    const saved=await command(alice,draft);assert.equal(saved.workspace.draft_version,1);
    assert.deepEqual(await command(alice,draft),saved);
    await command(alice,cmd('SAVE_DRAFT',{workspaceId,expectedVersion:0,draft:'wrong'}),409);
    let {session}=await command(alice,cmd('START',{workspaceId,deviceId,timezone:'Asia/Seoul'}));
    const owned=()=>({sessionId:session.id,deviceId:session.device_id,generation:session.generation});
    const past=new Date(Date.now()-18000).toISOString();
    await adminApi(`/rest/v1/learning_sessions?id=eq.${session.id}`,{last_seen_at:past,last_activity_at:past},'PATCH');
    ({session}=await command(alice,cmd('HEARTBEAT',{...owned(),activity:true})));
    assert.ok(session.elapsed_seconds>=18&&session.elapsed_seconds<=22,'server interval is counted');
    ({session}=await command(alice,cmd('PAUSE',{...owned(),activity:false,reason:'MANUAL'})));
    const paused=session.elapsed_seconds;
    ({session}=await command(alice,cmd('HEARTBEAT',{...owned(),activity:true})));
    assert.equal(session.status,'PAUSED');assert.equal(session.elapsed_seconds,paused,'manual pause cannot accrue');
    ({session}=await command(alice,cmd('START',{workspaceId,deviceId,timezone:'Asia/Seoul'})));
    const originalOwner=owned();
    await command(alice,cmd('START',{workspaceId,deviceId:randomUUID(),timezone:'Asia/Seoul'}),409);
    ({session}=await command(alice,cmd('TAKEOVER',{workspaceId,deviceId:randomUUID(),timezone:'Asia/Seoul'})));
    await command(alice,cmd('HEARTBEAT',{...originalOwner,activity:true}),409);
    const messageCommand=cmd('MESSAGE',{workspaceId,...owned(),content:'I goed to the park.'});
    const written=await command(alice,messageCommand,202);
    assert.deepEqual(await command(alice,messageCommand,202),written,'same message cannot enqueue twice');
    assert.equal(written.message.content,'I goed to the park.');
    assert.equal('input' in written.job,false);
    // Queue admission is independent of a running worker. Completion/lease ownership
    // is covered transactionally in pgTAP and by the separate live-provider check.
    // Never overwrite a lease that a real worker may already own.
    const snapshot=await (await api(alice,`/api/learning/workspaces/${workspaceId}`)).json();
    assert.equal(snapshot.messages.filter(m=>m.role==='USER').length,1);
    assert.equal(snapshot.jobs.length,1);
    assert.equal(snapshot.jobs[0].id,written.job.id);
    assert.equal('input' in snapshot.jobs[0],false);
    assert.equal('lease_token' in snapshot.jobs[0],false);
    assert.equal('provider_response_id' in snapshot.jobs[0],false);
    assert.equal(snapshot.workspace.draft,'I goed to the park.');
    const end=cmd('END',{...owned(),activity:false});
    ({session}=await command(alice,end));assert.equal(session.status,'ENDED');
    assert.deepEqual((await command(alice,end)).session,session,'end retry stable');
    const oldId=session.id;
    ({session}=await command(alice,cmd('START',{workspaceId,deviceId,timezone:'Asia/Seoul'})));
    assert.notEqual(session.id,oldId,'resume ended workspace starts new session');
    await command(alice,cmd('END',{...owned(),activity:false}));
    const importBody={requestId:randomUUID(),items:[{url:'https://youtu.be/abcdefghijk?t=5'},{url:'https://example.com/no-video'}]};
    const imported=await(await api(alice,'/api/learning/videos',importBody)).json();
    assert.equal(imported.results.length,2);assert.ok(imported.results[1].error);
    const videoId=imported.results[0].workspace.id;
    assert.equal(imported.results[0].workspace.kind,'LISTENING');
    assert.deepEqual(await(await api(alice,'/api/learning/videos',importBody)).json(),imported);
    const duplicate=await(await api(alice,'/api/learning/videos',{...importBody,requestId:randomUUID()})).json();
    assert.equal(duplicate.results[0].workspace.id,videoId);assert.equal(duplicate.results[0].duplicate,true);
    const videoCommand=async(body,expected=200)=>{const res=await api(alice,'/api/learning/videos/commands',body);assert.equal(res.status,expected,body.action);return res.json();};
    const source=cmd('VIDEO_SOURCE',{workspaceId:videoId,expectedVersion:0,transcript:'Take a walk means to walk for pleasure.',contextStart:0,contextEnd:38});
    await videoCommand(source);
    await videoCommand({...source,requestId:randomUUID()},409);
    await videoCommand(cmd('VIDEO_NOTE',{workspaceId:videoId,noteId:randomUUID(),positionSeconds:5,content:'Practice take a walk.'}));
    assert.equal((await api(bob,`/api/learning/workspaces/${videoId}`)).status,404);
    ({session}=await command(alice,cmd('START',{workspaceId:videoId,deviceId,timezone:'Asia/Seoul'})));
    const tick=playing=>cmd('VIDEO_TICK',{...owned(),positionSeconds:5,durationSeconds:100,rate:1,playing});
    ({session}=await videoCommand(tick(true)));
    ({session}=await videoCommand(tick(false)));assert.equal(session.status,'PAUSED','paused playback stops the shared timer');
    const videoSnapshot=await(await api(alice,`/api/learning/workspaces/${videoId}`)).json();
    assert.equal(videoSnapshot.video.position_seconds,5);
    assert.equal(videoSnapshot.video.transcript,source.transcript);
    assert.equal(videoSnapshot.videoNotes.length,1);
    const summary=await command(alice,cmd('SUMMARY',{workspaceId:videoId,sessionId:session.id}),202);
    assert.equal(summary.job.kind,'STUDY_SUMMARY','source-only video summary is admitted');
    assert.equal('input' in summary.job,false);
    await command(alice,cmd('END',{...owned(),activity:false}));
    const empty=await (await api(bob,'/api/learning/workspaces')).json();assert.equal(empty.workspaces.length,0);
  } finally {
    server.kill();
    for(const id of userIds) await adminApi(`/auth/v1/admin/users/${id}`,null,'DELETE');
  }
});
