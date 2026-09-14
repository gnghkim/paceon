import { z } from 'zod';
import { ApiError, createBookHandlers, json, readBody, type Config } from './books-api.ts';
import { parseLearningCommand, publicLearningJob, type LearningCommand } from './learning.ts';

const errors: Record<string, [number, string]> = {
  LEARNING_NOT_FOUND:[404,'학습 기록을 찾을 수 없어요.'],
  LEARNING_CONFLICT:[409,'다른 기기에서 학습 중이거나 내용이 변경되었어요. 최신 상태를 확인해 주세요.'],
  LEARNING_INVALID:[400,'학습 내용과 요청 정보를 확인해 주세요.'],
  LEARNING_LIMIT:[429,'진행 중인 요청이나 사용 한도를 확인하고 잠시 후 다시 시도해 주세요.'],
};
export function createLearningHandlers(config: Config | undefined, aiEnabled = false, fetcher: typeof fetch = globalThis.fetch) {
  const authenticate = createBookHandlers(config, fetcher).authenticate;
  type Auth = Awaited<ReturnType<typeof authenticate>>;
  async function rest(auth:Auth, table:string, query:Record<string,string> = {}, body?:unknown) {
    const url = new URL(`/rest/v1/${table}`,auth.base);
    url.search = new URLSearchParams(query).toString();
    const response = await fetcher(url, {
      method:body === undefined ? 'GET' : 'POST',
      headers:{...auth.headers,'Content-Type':'application/json'},
      ...(body === undefined ? {} : {body:JSON.stringify(body)}),
      cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000),
    });
    if (response.status === 401 || response.status === 403) throw new ApiError(401,'다시 로그인해 주세요.');
    if (!response.ok) {
      const value = await response.json().catch(() => ({}));
      const known = typeof value?.message === 'string' ? errors[value.message] : undefined;
      if(known) throw new ApiError(known[0],known[1]);
      throw new ApiError(503,'학습 정보를 처리하지 못했어요. 같은 요청으로 다시 확인해 주세요.');
    }
    return response.json();
  }
  async function rows(auth:Auth, table:string, query:Record<string,string>={}) {
    const value:unknown = await rest(auth,table,{select:'*',user_id:`eq.${auth.userId}`,limit:'101',...query});
    if(!Array.isArray(value) || value.some(row => !row || typeof row !== 'object')) throw new ApiError(503,'학습 정보를 불러오지 못했어요.');
    return value as Record<string,unknown>[];
  }
  function handle(error:unknown) {
    if(error instanceof z.ZodError) return json({error:'학습 내용, 시간대와 요청 정보를 확인해 주세요.'},400);
    if(error instanceof ApiError) return json({error:/[가-힣]/.test(error.message)?error.message:'요청을 처리하지 못했어요.'},error.status);
    return json({error:'연결을 확인하고 다시 시도해 주세요. 저장 결과가 불명확하면 같은 요청으로 재확인해 주세요.'},503);
  }
  async function execute(auth:Auth, command:LearningCommand) {
    if(['MESSAGE','SUMMARY','RETRY'].includes(command.action) && !aiEnabled) throw new ApiError(503,'AI를 현재 사용할 수 없어요. 작성한 내용은 초안으로 저장할 수 있어요.');
    const value = await rest(auth,'rpc/learning_command',{}, {p_command:command});
    if(!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(503,'저장 결과를 확인하지 못했어요.');
    const result = { ...value };
    if(result.job) result.job = publicLearningJob(result.job);
    return json(result, ['MESSAGE','SUMMARY','RETRY'].includes(command.action) ? 202 : command.action === 'CREATE' ? 201 : 200);
  }
  return {
    async LIST(request:Request) {
      try {
        const auth = await authenticate(request);
        const url=new URL(request.url);
        const raw = url.searchParams.get('offset') ?? '0';
        if(!/^\d+$/.test(raw) || Number(raw)>100000 || [...url.searchParams.keys()].some(k=>k!=='offset') || url.searchParams.getAll('offset').length>1) throw new ApiError(400,'목록 조회 범위를 확인해 주세요.');
        const [workspaces,sessions] = await Promise.all([
          rows(auth,'learning_workspaces',{order:'updated_at.desc,id.desc',offset:raw}),
          rows(auth,'learning_sessions',{order:'updated_at.desc,id.desc',limit:'100'}),
        ]);
        const page=workspaces.slice(0,100);
        const videos=page.length?await rows(auth,'learning_videos',{select:'workspace_id,video_id,start_seconds,position_seconds,duration_seconds,favorite,archived,updated_at',workspace_id:`in.(${page.map(w=>w.id).join(',')})`,limit:'100'}):[];
        return json({workspaces:page,sessions,videos,aiEnabled,nextOffset:workspaces.length>100?Number(raw)+100:null});
      } catch(error) {return handle(error);}
    },
    async GET(request:Request,id:string) {
      try {
        const auth = await authenticate(request); z.uuid().parse(id);
        const url=new URL(request.url), rawPage=url.searchParams.get('page')??'0';
        if(!/^\d+$/.test(rawPage)||Number(rawPage)>1000||[...url.searchParams.keys()].some(k=>k!=='page')||url.searchParams.getAll('page').length>1) throw new ApiError(400,'기록 조회 범위를 확인해 주세요.');
        const page=Number(rawPage);
        const workspaces = await rows(auth,'learning_workspaces',{id:`eq.${id}`,limit:'1'});
        const workspace=workspaces[0];
        if(!workspace) throw new ApiError(404,'학습 공간을 찾을 수 없어요.');
        const [sessions,messages,jobs,videos,notes,visits] = await Promise.all([
          rows(auth,'learning_sessions',{workspace_id:`eq.${id}`,order:'started_at.desc,id.desc',limit:'101',offset:String(page*100)}),
          rows(auth,'learning_messages',{workspace_id:`eq.${id}`,order:'created_at.desc,id.desc',limit:'201',offset:String(page*200)}),
          rows(auth,'learning_ai_jobs',{select:'id,workspace_id,session_id,kind,status,output,error_code,created_at,updated_at',workspace_id:`eq.${id}`,order:'created_at.desc,id.desc',limit:'31',offset:String(page*30)}),
          rows(auth,'learning_videos',{workspace_id:`eq.${id}`,limit:'1'}),
          rows(auth,'learning_video_notes',{workspace_id:`eq.${id}`,order:'created_at.desc,id.desc',limit:'101',offset:String(page*100)}),
          rows(auth,'learning_video_visits',{workspace_id:`eq.${id}`,order:'created_at.desc,id.desc',limit:'101',offset:String(page*100)}),
        ]);
        return json({workspace,sessions:sessions.slice(0,100),messages:messages.slice(0,200).reverse(),jobs:jobs.slice(0,30).map(publicLearningJob),video:videos[0]??null,videoNotes:notes.slice(0,100),videoVisits:visits.slice(0,100),aiEnabled,page,hasMore:{sessions:sessions.length>100,messages:messages.length>200,jobs:jobs.length>30,videoNotes:notes.length>100,videoVisits:visits.length>100}});
      } catch(error) {return handle(error);}
    },
    async COMMAND(request:Request) {
      try {const auth=await authenticate(request);return await execute(auth,parseLearningCommand(await readBody(request,65536)));}
      catch(error) {return handle(error);}
    },
    async POST(request:Request) {
      try {
        const auth=await authenticate(request);
        const body=z.record(z.string(),z.unknown()).parse(await readBody(request,65536));
        if('action' in body) throw new ApiError(400,'요청 형식을 확인해 주세요.');
        return await execute(auth,parseLearningCommand({...body,action:'CREATE'}));
      } catch(error) {return handle(error);}
    },
    async PATCH(request:Request,id:string) {
      try {
        const auth=await authenticate(request);z.uuid().parse(id);
        const body=z.record(z.string(),z.unknown()).parse(await readBody(request,65536));
        if('action' in body || 'workspaceId' in body) throw new ApiError(400,'요청 형식을 확인해 주세요.');
        return await execute(auth,parseLearningCommand({...body,action:'SAVE_DRAFT',workspaceId:id}));
      } catch(error) {return handle(error);}
    },
  };
}
