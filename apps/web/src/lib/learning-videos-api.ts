import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ApiError, createBookHandlers, json, readBody, type Config } from './books-api.ts';
import { normalizeYouTubeUrl, videoCommandSchema } from './youtube.ts';

const batchSchema=z.strictObject({requestId:z.uuid(),items:z.array(z.strictObject({url:z.string().min(1).max(2048),title:z.string().trim().min(1).max(120).optional()})).min(1).max(20)});
function childId(requestId:string,index:number,type:string) {
  const hex=createHash('sha256').update(`paceon-video:${requestId}:${index}:${type}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
const messages:Record<string,[number,string]>={
  LEARNING_NOT_FOUND:[404,'영상 학습 자료를 찾을 수 없어요.'],
  LEARNING_CONFLICT:[409,'다른 기기에서 수정했거나 학습 상태가 바뀌었어요. 최신 상태를 확인해 주세요.'],
  LEARNING_INVALID:[400,'영상 위치와 입력 내용을 확인해 주세요.'],
  LEARNING_LIMIT:[429,'저장 또는 요청 한도를 넘었어요. 입력 범위를 줄여 주세요.'],
  LEARNING_KIND:[409,'이 영역에서는 사용할 수 없는 기능이에요.'],
};
export function createVideoHandlers(config:Config|undefined,fetcher:typeof fetch=globalThis.fetch) {
  const authenticate=createBookHandlers(config,fetcher).authenticate;
  async function command(auth:Awaited<ReturnType<typeof authenticate>>,value:unknown) {
    const response=await fetcher(new URL('/rest/v1/rpc/learning_video_command',auth.base),{
      method:'POST',headers:{...auth.headers,'Content-Type':'application/json'},body:JSON.stringify({p_command:value}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000),
    });
    if(!response.ok){
      const body=await response.json().catch(()=>({}));
      const mapped=typeof body.message==='string'?messages[body.message]:undefined;
      if(mapped) throw new ApiError(...mapped);
      throw new ApiError(response.status===401?401:503,'영상 저장을 확인하지 못했어요. 같은 요청으로 다시 시도해 주세요.');
    }
    const body:unknown=await response.json();
    if(!body || typeof body!=='object' || Array.isArray(body))throw new ApiError(503,'저장 결과를 확인하지 못했어요.');
    return body;
  }
  function fail(error:unknown) {
    if(error instanceof ApiError) return json({error:/[가-힣]/.test(error.message)?error.message:'로그인과 요청 형식을 확인해 주세요.'},error.status);
    if(error instanceof z.ZodError) return json({error:'한 번에 영상 20개까지, 입력 형식과 자막 범위를 확인해 주세요.'},400);
    return json({error:'연결을 확인한 뒤 다시 시도해 주세요.'},503);
  }
  return {
    async POST(request:Request) {
      try {
        const auth=await authenticate(request), batch=batchSchema.parse(await readBody(request,65536));
        const results=[];
        for(const [index,item] of batch.items.entries()) {
          let parsed:ReturnType<typeof normalizeYouTubeUrl>;
          try {parsed=normalizeYouTubeUrl(item.url);} catch { results.push({index,error:'지원하는 유튜브 영상 링크인지 확인해 주세요.'});continue; }
          try {
            const value=await command(auth,{action:'VIDEO_ADD',requestId:childId(batch.requestId,index,'request'),workspaceId:childId(batch.requestId,index,'workspace'),videoId:parsed.videoId,startSeconds:parsed.startSeconds,title:item.title??`YouTube · ${parsed.videoId}`});
            results.push({index,...value});
          } catch(error) {
            results.push({index,error:error instanceof ApiError?error.message:'연결을 확인하고 같은 목록으로 다시 시도해 주세요.'});
          }
        }
        return json({results});
      } catch(error) {return fail(error);}
    },
    async COMMAND(request:Request) {
      try {
        const auth=await authenticate(request), value=videoCommandSchema.parse(await readBody(request,450000));
        if(value.action==='VIDEO_SOURCE' && (value.contextStart>value.contextEnd || value.contextEnd>Array.from(value.transcript).length || value.contextEnd-value.contextStart>12000)) throw new ApiError(400,'AI에 전달할 자막은 저장한 원문 안에서 12,000자 이하로 선택해 주세요.');
        return json(await command(auth,value));
      } catch(error) {return fail(error);}
    },
  };
}
