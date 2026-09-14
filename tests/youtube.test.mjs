import assert from 'node:assert/strict';
import { mergeYouTubeLibraryItems } from '../apps/web/src/lib/youtube-library.ts';
import { test } from 'node:test';
import { normalizeYouTubeUrl, normalizeTranscript, videoCommandSchema } from '../apps/web/src/lib/youtube.ts';
const id='dQw4w9WgXcQ';
test('YouTube links normalize only explicit single videos and timestamps',()=>{
 for(const url of [`https://www.youtube.com/watch?v=${id}`,`https://youtu.be/${id}`,`https://youtube.com/shorts/${id}`,`https://m.youtube.com/embed/${id}`]) assert.deepEqual(normalizeYouTubeUrl(url),{videoId:id,startSeconds:0,url:`https://www.youtube.com/watch?v=${id}`});
 assert.equal(normalizeYouTubeUrl(`https://youtu.be/${id}?t=1h2m3s`).startSeconds,3723);
 assert.equal(normalizeYouTubeUrl(`https://youtube.com/watch?v=${id}&t=42`).startSeconds,42);
 assert.equal(normalizeYouTubeUrl(`https://youtube.com/embed/${id}?start=12.5`).startSeconds,12.5);
 for(const value of [`http://youtube.com/watch?v=${id}`,`https://youtube.com.evil.test/watch?v=${id}`,`https://evil@youtube.com/watch?v=${id}`,`https://youtube.com:444/watch?v=${id}`,`https://youtube.com/playlist?list=123`,`https://youtube.com/watch?v=${id}&v=abcdefghijk`,`https://youtu.be/${id}/extra`,`https://youtu.be/${id}?t=-1`,`https://youtu.be/${id}?t=9999999`,`https://youtu.be/invalid`,`javascript:alert(1)`]) assert.throws(()=>normalizeYouTubeUrl(value),value);
});
test('subtitle import preserves supplied times and rejects malformed or oversized input',()=>{
 assert.equal(normalizeTranscript('\ufeffhello\r\nworld','txt'),'hello\nworld');
 const srt='1\r\n00:00:01,000 --> 00:00:02,500\r\nHello <b>world</b>\r\n';
 assert.match(normalizeTranscript(srt,'srt'),/00:00:01,000 --> 00:00:02,500/);
 assert.match(normalizeTranscript(srt,'srt'),/Hello world/);
 assert.match(normalizeTranscript('WEBVTT\n\n00:01.000 --> 00:02.000\nHello','vtt'),/Hello/);
 for(const [text,format] of [['x'.repeat(100001),'txt'],['abc\u0000def','txt'],['not subtitles','srt'],['00:00:03,000 --> 00:00:02,000\nwrong','srt']]) assert.throws(()=>normalizeTranscript(text,format));
});
test('video commands validate ownership fields, limits and preserve original notes',()=>{
 const uuid='12345678-1234-4234-9234-123456789abc';
 const tick={action:'VIDEO_TICK',requestId:uuid,sessionId:uuid,deviceId:uuid,generation:1,positionSeconds:10,durationSeconds:100,playing:true,rate:1};
 assert.deepEqual(videoCommandSchema.parse(tick),tick);
 for(const bad of [{...tick,elapsed:300},{...tick,rate:0},{...tick,positionSeconds:-1},{...tick,durationSeconds:NaN},{...tick,generation:0}]) assert.equal(videoCommandSchema.safeParse(bad).success,false);
 const note={action:'VIDEO_NOTE',requestId:uuid,workspaceId:uuid,noteId:uuid,positionSeconds:0,content:'  Hello\n'};
 assert.equal(videoCommandSchema.parse(note).content,note.content);
 assert.equal(videoCommandSchema.safeParse({...note,content:' '}).success,false);
});

test('YouTube library first page displays each video once while preserving order',()=>{
 const first={id:'TFnThlz9gaQ',title:'First occurrence',kind:'video'};
 const other={id:'abcdefghijk',title:'Another video',kind:'video'};
 const page=[first,other,{...first,title:'Repeated playlist entry'}];
 assert.deepEqual(mergeYouTubeLibraryItems([],page),[first,other]);
 assert.equal(page.length,3,'provider page is not mutated');
});

test('YouTube library pagination and repeated pages preserve unique selections and item kinds',()=>{
 const video={id:'TFnThlz9gaQ',title:'Video',kind:'video'};
 const channel={id:video.id,title:'Channel',kind:'channel'};
 const next={id:'abcdefghijk',title:'Next',kind:'video'};
 const merged=mergeYouTubeLibraryItems([video],[video,next,next,channel]);
 assert.deepEqual(merged,[video,next,channel]);
 assert.deepEqual(mergeYouTubeLibraryItems(merged,[video,next,next,channel]),merged);
 assert.deepEqual(merged.filter(item=>item.kind==='video').map(item=>item.id),[video.id,next.id]);
 assert.deepEqual(mergeYouTubeLibraryItems([],[next]),[next],'new list replaces previous results');
});
