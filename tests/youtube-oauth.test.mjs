import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readYouTubeConfig, seal, unseal, createYouTubeHandlers } from '../apps/web/src/lib/youtube-oauth.ts';
const env={GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret',YOUTUBE_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),APP_URL:'http://localhost:3000',NEXT_PUBLIC_SUPABASE_URL:'http://localhost:54321',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'service'};
const config=()=>readYouTubeConfig(env);
const req=(path,method='GET',cookie)=>new Request(`http://localhost:3000/api/youtube/${path}`,{method,headers:{Authorization:'Bearer owner',...(cookie?{cookie}:{})}});
test('missing and unsafe config disables OAuth; AES authenticates ciphertext and user binding',()=>{
 assert.equal(readYouTubeConfig({}),undefined);
 assert.equal(readYouTubeConfig({...env,APP_URL:'http://evil.example'}),undefined);
 const c=config(); const value=seal({access:'sensitive'},c,'user');
 assert.equal(value.includes('sensitive'),false);assert.deepEqual(unseal(value,c,'user'),{access:'sensitive'});
 assert.throws(()=>unseal(value,c,'other'));assert.throws(()=>unseal(value.slice(0,-4)+'AAAA',c,'user'));
});
function fixture(options={}) {
 let row=null;const calls=[];
 const fetcher=async(url,init={})=>{
  const u=new URL(url);calls.push({url:u,init});
  if(u.pathname==='/auth/v1/user')return Response.json({id:'user'});
  if(u.pathname.endsWith('/youtube_connection_command')){
   const p=JSON.parse(init.body).p_command;
   if(p.action==='begin'){row={...row,generation:p.generation,state_hash:p.stateHash,binding_hash:p.bindingHash,verifier:p.verifier,user_id:p.userId};return Response.json({});}
   if(p.action==='consume'){if(options.expiredState||!row||row.state_hash!==p.stateHash||row.binding_hash!==p.bindingHash)return Response.json(null);const result={...row};row.state_hash=null;return Response.json(result);}
   if(p.action==='commit'){if(row?.generation!==p.generation)return Response.json(false);row={...row,tokens:p.tokens};return Response.json(true);}
   if(p.action==='get')return Response.json(row?.tokens?row:null);
   if(p.action==='refresh'){if(options.disconnectDuringRefresh)row=null;if(row?.tokens!==p.previous)return Response.json(false);row.tokens=p.tokens;return Response.json(true);}
   if(p.action==='invalidate'){row.tokens=null;return Response.json(true);}
   if(p.action==='disconnect'){const old=row;row=null;return Response.json(old);}
  }
  if(u.pathname==='/token')return options.tokenError||(options.refreshError&&new URLSearchParams(init.body).get('grant_type')==='refresh_token')?Response.json({error:'invalid_grant',secret:'do-not-leak'},{status:400}):Response.json({access_token:'access',refresh_token:'refresh',expires_in:options.expired?0:3600,scope:'https://www.googleapis.com/auth/youtube.readonly'});
  if(u.pathname==='/revoke')return new Response('',{status:options.revokeError?503:200});
  if(u.pathname.startsWith('/youtube/')&&options.quota)return Response.json({error:{errors:[{reason:'quotaExceeded'}],secret:'do-not-leak'}},{status:403});
  if(u.pathname.endsWith('/channels'))return Response.json({items:options.noChannel?[]:[{id:'channel',snippet:{title:'My channel'},contentDetails:{relatedPlaylists:{uploads:'uploads'}}}]});
  if(u.pathname.endsWith('/playlists'))return Response.json({items:[{id:'playlist',snippet:{title:'Playlist'}}],nextPageToken:'next-list'});
  if(u.pathname.endsWith('/subscriptions'))return Response.json({items:[{snippet:{title:'Subscribed',resourceId:{channelId:'channel'}}}],nextPageToken:'next-sub'});
  if(u.pathname.endsWith('/playlistItems'))return Response.json({items:[{snippet:{title:'Video',resourceId:{videoId:'abcdefghijk'}}}],nextPageToken:'next'});
  throw new Error('Unexpected fixture request '+u.pathname);
 };
 return {handlers:createYouTubeHandlers(config(),fetcher),calls};
}
async function connect(f){const response=await f.handlers.CONNECT(req('connect','POST'));const body=await response.json();const url=new URL(body.url);const cookie=response.headers.get('set-cookie').split(';')[0];return {url,cookie};}
test('connect uses fixed redirect readonly PKCE and a single-use browser bound state',async()=>{
 const f=fixture(),{url,cookie}=await connect(f);
 assert.equal(url.searchParams.get('redirect_uri'),'http://localhost:3000/api/youtube/callback');assert.equal(url.searchParams.get('scope'),'https://www.googleapis.com/auth/youtube.readonly');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 const callback=`callback?state=${url.searchParams.get('state')}&code=code`;
 assert.match((await f.handlers.CALLBACK(req(callback,'GET','youtube_oauth=wrong'))).headers.get('location'),/failed/);
 assert.match((await f.handlers.CALLBACK(req(callback,'GET',cookie))).headers.get('location'),/connected/);
 assert.match((await f.handlers.CALLBACK(req(callback,'GET',cookie))).headers.get('location'),/failed/);
 assert.equal(f.calls.filter(c=>c.url.pathname==='/token').length,1);
});
test('denial consumes state without exchanging; missing config is honest',async()=>{
 const f=fixture(),{url,cookie}=await connect(f);
 assert.match((await f.handlers.CALLBACK(req(`callback?state=${url.searchParams.get('state')}&error=access_denied`,'GET',cookie))).headers.get('location'),/denied/);
 assert.equal(f.calls.some(c=>c.url.pathname==='/token'),false);
 assert.equal((await createYouTubeHandlers(undefined).CONNECT(req('connect','POST'))).status,503);
});
test('library pagination and refresh stay server-side; disconnect deletes even if revoke fails',async()=>{
 const f=fixture({expired:true,revokeError:true}),{url,cookie}=await connect(f);
 await f.handlers.CALLBACK(req(`callback?state=${url.searchParams.get('state')}&code=code`,'GET',cookie));
 const response=await f.handlers.LIBRARY(req('library?kind=videos&playlistId=playlist&pageToken=page'));
 assert.deepEqual(await response.json(),{items:[{id:'abcdefghijk',title:'Video',kind:'video'}],nextPageToken:'next'});
 const call=f.calls.find(c=>c.url.pathname.endsWith('/playlistItems'));assert.equal(call.url.searchParams.get('pageToken'),'page');assert.equal(call.init.headers.Authorization,'Bearer access');
 assert.deepEqual(await (await f.handlers.DISCONNECT(req('disconnect','POST'))).json(),{disconnected:true,revoked:false});
 assert.equal((await f.handlers.LIBRARY(req('library?kind=playlists'))).status,409);
});
test('refresh CAS never resurrects disconnect and provider failures are sanitized',async()=>{
 const f=fixture({expired:true,disconnectDuringRefresh:true}),{url,cookie}=await connect(f);await f.handlers.CALLBACK(req(`callback?state=${url.searchParams.get('state')}&code=code`,'GET',cookie));
 assert.equal((await f.handlers.LIBRARY(req('library?kind=playlists'))).status,409);
 const bad=fixture({tokenError:true}),start=await connect(bad);const result=await bad.handlers.CALLBACK(req(`callback?state=${start.url.searchParams.get('state')}&code=code`,'GET',start.cookie));assert.match(result.headers.get('location'),/failed/);assert.equal((await result.text()).includes('do-not-leak'),false);
});
test('expired or superseded authorization state cannot exchange a token',async()=>{
 for(const expiredState of [true,false]){
  const f=fixture({expiredState}),start=await connect(f);
  if(!expiredState)await connect(f);
  const result=await f.handlers.CALLBACK(req(`callback?state=${start.url.searchParams.get('state')}&code=code`,'GET',start.cookie));
  assert.match(result.headers.get('location'),/failed/);assert.equal(f.calls.some(c=>c.url.pathname==='/token'),false);
 }
});
test('revoked refresh invalidates stored token and quota response does not leak provider body',async()=>{
 for(const options of [{expired:true,refreshError:true},{quota:true}]){
  const f=fixture(options),start=await connect(f);await f.handlers.CALLBACK(req(`callback?state=${start.url.searchParams.get('state')}&code=code`,'GET',start.cookie));
  const result=await f.handlers.LIBRARY(req('library?kind=playlists'));
  assert.equal(result.status,options.quota?429:409);assert.equal((await result.text()).includes('do-not-leak'),false);
  if(options.refreshError)assert.equal((await (await f.handlers.STATUS(req('status'))).json()).connected,false);
 }
});
test('playlists subscriptions and channel uploads use supported paged resources',async()=>{
 const f=fixture(),start=await connect(f);await f.handlers.CALLBACK(req(`callback?state=${start.url.searchParams.get('state')}&code=code`,'GET',start.cookie));
 assert.equal((await (await f.handlers.LIBRARY(req('library?kind=playlists'))).json()).items[0].kind,'playlist');
 assert.equal((await (await f.handlers.LIBRARY(req('library?kind=subscriptions'))).json()).items[0].kind,'channel');
 assert.equal((await f.handlers.LIBRARY(req('library?kind=videos&channelId=channel'))).status,200);
 assert.equal(f.calls.find(c=>c.url.pathname.endsWith('/playlistItems')).url.searchParams.get('playlistId'),'uploads');
 const status=await (await f.handlers.STATUS(req('status'))).json();assert.equal(status.channel.title,'My channel');assert.equal(JSON.stringify(status).includes('access'),false);
});
test('library rejects ambiguous query parameters before calling Google',async()=>{
 const f=fixture();
 for(const query of ['kind=videos&playlistId=a&channelId=b','kind=playlists&kind=videos','kind=playlists&surprise=yes','kind=playlists&playlistId=a'])assert.equal((await f.handlers.LIBRARY(req('library?'+query))).status,400);
 assert.equal(f.calls.some(c=>c.url.host==='www.googleapis.com'),false);
});
test('status reports confirmed expired grant as disconnected',async()=>{
 const f=fixture({expired:true,refreshError:true}),start=await connect(f);await f.handlers.CALLBACK(req(`callback?state=${start.url.searchParams.get('state')}&code=code`,'GET',start.cookie));
 assert.equal((await (await f.handlers.STATUS(req('status'))).json()).connected,false);
});
