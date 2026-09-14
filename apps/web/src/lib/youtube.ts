import { z } from 'zod';

const maxPosition = 604800;
const seconds = z.number().finite().min(0).max(maxPosition);
const uuid = z.uuid();
const base = { requestId: uuid, workspaceId: uuid };
export const videoCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action:z.literal('VIDEO_EDIT'), ...base, title:z.string().trim().min(1).max(120), favorite:z.boolean(), archived:z.boolean() }),
  z.strictObject({ action:z.literal('VIDEO_SOURCE'), ...base, expectedVersion:z.number().int().min(0).max(2147483647), transcript:z.string().max(200000).refine(v=>Array.from(v).length<=100000 && !v.includes('\0')), contextStart:z.number().int().min(0).max(100000), contextEnd:z.number().int().min(0).max(100000) }),
  z.strictObject({ action:z.literal('VIDEO_NOTE'), ...base, noteId:uuid, positionSeconds:seconds, content:z.string().min(1).max(4000).refine(v=>v.trim().length>0) }),
  z.strictObject({ action:z.literal('VIDEO_TICK'), requestId:uuid, sessionId:uuid, deviceId:uuid, generation:z.number().int().min(1).max(2147483647), positionSeconds:seconds, durationSeconds:seconds.nullable(), playing:z.boolean(), rate:z.number().finite().min(0.25).max(4) }),
]);

function invalid(): never { throw new Error('지원하는 유튜브 영상 링크와 시작 시간을 확인해 주세요.'); }
function timestamp(value: string) {
  if (/^\d+(?:\.\d+)?s?$/.test(value)) return Number(value.replace(/s$/, ''));
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match || !match[0]) return invalid();
  return Number(match[1] ?? 0)*3600 + Number(match[2] ?? 0)*60 + Number(match[3] ?? 0);
}
export function normalizeYouTubeUrl(value: string): {videoId:string;startSeconds:number;url:string} {
  if (typeof value !== 'string' || value.length>2048) return invalid();
  let link:URL;
  try { link=new URL(value.trim()); } catch { return invalid(); }
  if (link.protocol!=='https:' || link.username || link.password || link.port || !['youtube.com','www.youtube.com','m.youtube.com','youtu.be','www.youtu.be'].includes(link.hostname)) return invalid();
  const parts=link.pathname.split('/').filter(Boolean);
  let videoId:string|null=null;
  if (['youtu.be','www.youtu.be'].includes(link.hostname)) {
    if(parts.length===1) videoId=parts[0]??null;
  } else if(link.pathname==='/watch' && link.searchParams.getAll('v').length===1) videoId=link.searchParams.get('v');
  else if(parts.length===2 && ['shorts','embed'].includes(parts[0]!)) videoId=parts[1]??null;
  if(!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return invalid();
  if(link.searchParams.getAll('t').length>1 || link.searchParams.getAll('start').length>1) return invalid();
  const hash=new URLSearchParams(link.hash.slice(1));
  const raw=link.searchParams.get('t')??link.searchParams.get('start')??hash.get('t');
  const startSeconds=raw===null?0:timestamp(raw);
  if(!Number.isFinite(startSeconds) || startSeconds<0 || startSeconds>maxPosition) return invalid();
  return {videoId,startSeconds,url:`https://www.youtube.com/watch?v=${videoId}`};
}

function cueTime(text:string) {
  const pieces=text.replace(',', '.').split(':').map(Number);
  if(pieces.some(v=>!Number.isFinite(v)||v<0) || pieces.length<2 || pieces.length>3 || pieces.at(-1)!>=60 || (pieces.length===3&&pieces[1]!>=60)) throw new Error('자막 시간 형식을 확인해 주세요.');
  return pieces.reduce((n,v)=>n*60+v,0);
}
export function normalizeTranscript(value:string, format:'txt'|'srt'|'vtt'='txt'):string {
  if(new TextEncoder().encode(value).length>1048576 || value.includes('\0')) throw new Error('자막은 1MiB 이하의 텍스트 파일이어야 해요.');
  const text=value.replace(/^\ufeff/,'').replace(/\r\n?/g,'\n');
  let normalized=text;
  if(format!=='txt') {
    const blocks=text.split(/\n\s*\n/);
    const cues:string[]=[];
    for(const block of blocks) {
      if(/^(WEBVTT|NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(block.trim())) continue;
      const lines=block.trim().split('\n');
      const index=lines.findIndex(line=>line.includes('-->'));
      if(index<0) { if(block.trim()) throw new Error('TXT, SRT 또는 VTT 형식을 확인해 주세요.'); continue; }
      const match=/^((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})(?:\s+.*)?$/.exec(lines[index]!);
      if(!match || cueTime(match[1]!)>=cueTime(match[2]!)) throw new Error('자막의 시작·종료 시간을 확인해 주세요.');
      const content=lines.slice(index+1).join('\n').replace(/<[^>]*>/g,'').trim();
      if(content) cues.push(`[${match[1]} --> ${match[2]}]\n${content}`);
    }
    if(!cues.length && text.trim()) throw new Error('읽을 수 있는 자막 구간이 없어요.');
    normalized=cues.join('\n\n');
  }
  normalized=normalized.trim();
  if(Array.from(normalized).length>100000) throw new Error('자막은 100,000자 이하로 나누어 올려 주세요.');
  return normalized;
}
