# 학습실 활동 탭 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 학습실 상세 화면을 활동 탭(영상·메모 / 말하기 / 질문·노트 / 자료)으로 나눠 한 번에 한 가지만 보여준다.

**Architecture:** 탭 목록과 주소 값 해석은 `learning-room-view.ts`의 순수 함수로 두고 `node:test`로 검증한다. 방 컴포넌트는 `?view=` 값을 읽어 어떤 묶음을 그릴지 정하고, 플레이어는 항상 마운트한 채 숨기며 영상 탭을 벗어날 때 기존 정지 경로로 영상을 멈춘다. 말하기 패널만 탭을 벗어날 때 언마운트한다.

**Tech Stack:** Next.js 16.3.5 App Router, React 19.3, TypeScript 5.9, Tailwind 4, `node:test` 단위 테스트.

**Spec:** `docs/superpowers/specs/2026-09-16-learning-room-tabs-design.md`

## Global Constraints

- 작업 브랜치는 `feat/learning-room-tabs`다. 이 브랜치에는 학습실 자동 재개(`0a78d16`)와 앱 아이콘(`5e7d18a`)이 이미 들어 있다.
- 라우트를 추가·삭제하지 않는다. 데이터베이스·마이그레이션·API를 변경하지 않는다.
- 기능을 삭제하지 않는다. 모든 기능은 유지하며 위치만 바뀐다.
- 스피킹·라이팅 방의 화면 구성은 바뀌지 않는다. 탭 바는 탭이 둘 이상일 때만 그린다.
- 화면 안에서 전환만 하는 버튼에는 `aria-pressed`를 쓴다. `aria-current="page"`는 페이지를 옮기는 링크 전용이다.
- 탭 버튼은 최소 높이 44px(`min-h-11`)를 지키고, 390px에서 가로 스크롤을 만들지 않는다(줄바꿈).
- 화면 문구는 한국어다.
- `apps/web/src/lib/*.ts`는 상대 경로에 확장자를 붙여 import하고(`./x.ts`), 컴포넌트는 `@/lib/x` 형태를 쓴다. `tsconfig`는 `noUncheckedIndexedAccess: true`다.
- 세션·관측 코드(`observeVideo`, `observeSpeech`, `transition`, `start`)는 이동만 하고 로직을 수정하지 않는다.
- 각 작업은 `pnpm test`, `pnpm typecheck`, `pnpm lint`가 통과한 뒤 커밋한다.

## File Structure

| 파일 | 책임 |
|---|---|
| `apps/web/src/components/learning-room-view.ts` (수정) | 탭 목록·주소 해석 순수 함수 추가 |
| `tests/learning-room-view.test.mjs` (수정) | 위 함수 검증 |
| `apps/web/src/components/learning-room-tabs.tsx` (신규) | 탭 바 UI와 녹음 중 이동 확인 |
| `apps/web/src/components/learning-room.tsx` (수정) | 탭 상태 보유, 묶음별 렌더 분기, 플레이어 정지 조율 |
| `apps/web/src/components/learning-video-panel.tsx` (수정) | 내부 하위 탭 제거, 위에서 받은 탭 값으로 렌더 |
| `apps/web/src/app/(workspace)/learn/items/[id]/page.tsx` (수정) | `Suspense` 경계 |
| `apps/web/src/app/(workspace)/learn/[id]/page.tsx` (수정) | `Suspense` 경계 |
| `docs/LEARNING_ROOM.md` (수정) | 화면 설명 갱신 |

**작업이 넷인 이유:** 방과 영상 패널은 같은 prop을 주고받으므로 한 작업에서 함께 바꿔야 타입 검사가 통과한다. 둘을 떼면 어느 쪽을 먼저 하든 중간 상태가 깨진다.

---

### Task 1: 탭 목록과 주소 해석 순수 함수

**Files:**
- Modify: `apps/web/src/components/learning-room-view.ts`
- Test: `tests/learning-room-view.test.mjs`

**Interfaces:**
- Consumes: `LearningKind`(`'LISTENING' | 'SPEAKING' | 'WRITING'`)는 `./learning-types`에 있고 이 파일 첫 줄에서 이미 `import type`으로 가져온다.
- Produces:
  - `type LearningRoomTab = 'video' | 'speak' | 'ask' | 'source'`
  - `roomTabs(kind: LearningKind): readonly { id: LearningRoomTab; label: string }[]`
  - `resolveRoomTab(kind: LearningKind, view: string | null): LearningRoomTab`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/learning-room-view.test.mjs`의 import 줄을 아래로 바꾼다(기존 이름 넷에 둘을 더한다).

```js
import { mergeLearningPages, playResumesPause, resolveRoomTab, roomTabs, sessionTiming, timerStatusLabel } from '../apps/web/src/components/learning-room-view.ts';
```

파일 끝에 테스트를 추가한다. 들여쓰기는 이 파일의 관례대로 공백 1칸이다.

```js
test('listening keeps four activity tabs while the other rooms keep one', () => {
 assert.deepEqual(roomTabs('LISTENING').map(t => t.id), ['video', 'speak', 'ask', 'source']);
 assert.deepEqual(roomTabs('LISTENING').map(t => t.label), ['영상·메모', '말하기', '질문·노트', '자료']);
 assert.deepEqual(roomTabs('SPEAKING').map(t => t.id), ['speak']);
 assert.deepEqual(roomTabs('WRITING').map(t => t.id), ['ask']);
});

test('an unknown or foreign view value falls back to the first tab of that room', () => {
 assert.equal(resolveRoomTab('LISTENING', 'source'), 'source');
 assert.equal(resolveRoomTab('LISTENING', null), 'video');
 assert.equal(resolveRoomTab('LISTENING', ''), 'video');
 assert.equal(resolveRoomTab('LISTENING', 'VIDEO'), 'video', '대소문자를 바꾸지 않는다. 맞는 탭이 없어 기본 탭으로 떨어진 결과다');
 assert.equal(resolveRoomTab('LISTENING', 'bogus'), 'video');
 assert.equal(resolveRoomTab('WRITING', 'speak'), 'ask', '그 방에 없는 탭은 기본 탭이 된다');
 assert.equal(resolveRoomTab('SPEAKING', 'ask'), 'speak');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test tests/learning-room-view.test.mjs`
Expected: FAIL. `roomTabs`가 없어 `SyntaxError: The requested module ... does not provide an export named 'roomTabs'`가 난다.

- [ ] **Step 3: 최소 구현을 넣는다**

`apps/web/src/components/learning-room-view.ts`에서 `const startHints` 선언 바로 위에 추가한다.

```ts
export type LearningRoomTab = 'video' | 'speak' | 'ask' | 'source';

const roomTabsByKind: Record<LearningKind, readonly { id: LearningRoomTab; label: string }[]> = {
  LISTENING: [
    { id: 'video', label: '영상·메모' },
    { id: 'speak', label: '말하기' },
    { id: 'ask', label: '질문·노트' },
    { id: 'source', label: '자료' },
  ],
  SPEAKING: [{ id: 'speak', label: '말하기' }],
  WRITING: [{ id: 'ask', label: '질문·노트' }],
};

/** 방 종류가 가진 활동 탭. 길이가 1이면 탭 바를 그리지 않는다. */
export const roomTabs = (kind: LearningKind) => roomTabsByKind[kind];

/** 주소의 view 값을 그 방에 있는 탭으로 바꾼다. 없거나 모르는 값은 첫 탭이다. */
export function resolveRoomTab(kind: LearningKind, view: string | null): LearningRoomTab {
  const tabs = roomTabs(kind);
  return tabs.find(tab => tab.id === view)?.id ?? tabs[0]!.id;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --test tests/learning-room-view.test.mjs`
Expected: PASS. 기존 4개와 새 2개를 합쳐 6개가 통과한다.

- [ ] **Step 5: 전체 검사와 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add apps/web/src/components/learning-room-view.ts tests/learning-room-view.test.mjs
git commit -m "feat(web): decide learning room tabs from the room kind and the view query"
```

---

### Task 2: 탭 바 컴포넌트

**Files:**
- Create: `apps/web/src/components/learning-room-tabs.tsx`

**Interfaces:**
- Consumes: Task 1의 `LearningRoomTab`. `cn`은 `@/lib/utils`에 있다.
- Produces: `LearningRoomTabs` 컴포넌트.

```ts
function LearningRoomTabs(props: {
  tabs: readonly { id: LearningRoomTab; label: string }[];
  current: LearningRoomTab;
  onSelect: (tab: LearningRoomTab) => void;
}): React.ReactElement | null;
```

- [ ] **Step 1: 컴포넌트를 만든다**

탭이 하나면 `null`을 돌려준다. 스타일은 기존 학습 영역 탭(`learning-areas-shell.tsx` 59~68줄)의 밑줄 방식을 따르되, 가로 스크롤 대신 줄바꿈한다.

```tsx
'use client';
import { cn } from '@/lib/utils';
import type { LearningRoomTab } from './learning-room-view';

export function LearningRoomTabs({ tabs, current, onSelect }: {
  tabs: readonly { id: LearningRoomTab; label: string }[];
  current: LearningRoomTab;
  onSelect: (tab: LearningRoomTab) => void;
}) {
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="학습 활동" className="flex flex-wrap gap-1 border-b border-border">
      {tabs.map((tab) => {
        const active = tab.id === current;
        return (
          <button
            key={tab.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(tab.id)}
            className={cn(
              'min-h-11 border-b-2 px-4 py-3 text-sm font-medium',
              active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: 타입과 린트를 확인한다**

Run: `pnpm typecheck && pnpm lint`
Expected: 통과. 아직 아무도 이 컴포넌트를 쓰지 않아 화면은 변하지 않는다.

- [ ] **Step 3: 커밋**

```bash
git add apps/web/src/components/learning-room-tabs.tsx
git commit -m "feat(web): add the learning room activity tab bar"
```

---

### Task 3: 방 화면과 영상 패널을 탭으로 나눈다

**Files:**
- Modify: `apps/web/src/components/learning-room.tsx`
- Modify: `apps/web/src/components/learning-video-panel.tsx`
- Modify: `apps/web/src/app/(workspace)/learn/items/[id]/page.tsx`
- Modify: `apps/web/src/app/(workspace)/learn/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 1의 `resolveRoomTab`, `roomTabs`, `LearningRoomTab`. Task 2의 `LearningRoomTabs`.
- Produces: `LearningVideoPanel`이 `tab: LearningRoomTab`을 필수 prop으로 받는다. 방과 패널을 한 작업에서 함께 바꿔야 타입 검사가 통과한다.

**배경(현재 코드):** `learning-room.tsx`는 946줄이다. 타이머 섹션은 645줄에서 열려 736줄 `</section>`에서 닫힌다. 영상 패널 765줄, 말하기 패널 772줄, 이전 말하기 기록 773줄, 글쓰기 묶음은 774줄 `{features.writing && (<>`에서 열려 923줄 `</>)}`에서 닫히고, "이전 기록 더 보기"가 924줄, `SessionHistory`가 943줄이다. `learning-video-panel.tsx`는 84줄이며 17줄에 내부 탭 상태, 48줄에 플레이어, 49줄에 보관 설정 `<details>`, 58~61줄에 하위 탭 `<nav>`, 64·70·82줄에 메모·자막·시청 구간 블록이 있다.

- [ ] **Step 1: 영상 패널이 탭 값을 받게 한다**

`learning-video-panel.tsx` 9~15줄의 시그니처를 바꾸고, 17줄 `const [tab, setTab] = useState<'notes' | 'source' | 'visits'>('notes');`를 **삭제**한다.

```tsx
export function LearningVideoPanel({ video, title, tab, notes, visits, stopped, stopToken, onObservation, activity, reload, stopPlaybackRef }: {
  stopPlaybackRef: RefObject<(() => Promise<void>) | null>;
  video: LearningVideo; title: string; tab: LearningRoomTab; notes: LearningVideoNote[]; visits: LearningVideoVisit[];
  stopped: boolean; stopToken: number;
  onObservation: (value: PlaybackObservation) => Promise<boolean>;
  activity: () => void; reload: () => Promise<void>;
}) {
```

import를 더한다.

```tsx
import type { LearningRoomTab } from './learning-room-view';
```

- [ ] **Step 2: 플레이어는 영상 탭에서만 보이게 한다**

48줄의 `<YouTubePlayer ... />`를 감싼다. 마운트는 유지하고 화면에서만 감춘다.

```tsx
    <div className={tab === 'video' ? undefined : 'hidden'}>
      <YouTubePlayer stopPlaybackRef={stopPlaybackRef} videoId={video.video_id} initialPosition={video.position_seconds ?? video.start_seconds} stopped={stopped} stopToken={stopToken} seek={seek} onPosition={setPosition} onObservation={onObservation} />
    </div>
```

- [ ] **Step 3: 하위 탭을 걷어내고 블록 조건을 바꾼다**

- 58~61줄 `<nav aria-label="영상 학습 도구"> … </nav>` 전체를 삭제한다. 그 안의 `<a href="#learning-draft">AI 질문</a>` 앵커도 함께 사라진다. 질문은 상위 탭 "질문·노트"로 간다.
- 49~57줄 "영상 제목과 보관 설정" `<details>`를 `{tab === 'source' && (…)}`로 감싼다.
- 64줄 `{tab === 'notes' && …}`를 `{tab === 'video' && …}`로 바꾼다.
- 70줄 `{tab === 'source' && …}`는 그대로 둔다. 값 이름이 이미 `source`다.
- 82줄 `{tab === 'visits' && …}`를 `{tab === 'source' && …}`로 바꾼다. 자막과 시청 구간이 한 탭에 함께 온다.

- [ ] **Step 4: 방에 import를 더한다**

`learning-room.tsx` 3줄과 13줄을 바꾸고, 13줄 아래에 두 줄을 더한다.

```tsx
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
```

```tsx
import { mergeLearningPages, playResumesPause, resolveRoomTab, roomTabs, sessionTiming, timerStatusLabel, type LearningRoomTab } from './learning-room-view';
import { LearningRoomTabs } from './learning-room-tabs';
import { cn } from '@/lib/utils';
```

- [ ] **Step 5: 주소에서 탭을 읽는다**

50줄 `const [stopToken, setStopToken] = useState(0);` 바로 아래에 한 줄을 넣는다.

```tsx
  const searchParams = useSearchParams();
```

- [ ] **Step 6: 탭을 해석하고, 영상 탭을 벗어나면 영상을 멈춘다**

**주소의 원본 값을 비교하면 안 된다.** 기본 탭은 쿼리가 없어 `searchParams.get('view')`가 `null`이므로, 영상 탭(기본)에서 말하기 탭으로 옮길 때 "직전 값이 video였는가"가 거짓이 되어 영상이 계속 재생된다. 반드시 **해석된 탭 값**으로 비교한다.

604줄 `const canonical = data ? workspaceHref(data.workspace) : null;` 바로 아래, **조기 반환(608줄 `if (!data)`)보다 앞에** 넣는다. 훅의 의존성 배열은 렌더 중에 평가되므로 이 순서를 지켜야 참조 오류가 나지 않는다.

```tsx
  const resolvedTab = data ? resolveRoomTab(data.workspace.kind, searchParams.get('view')) : null;
  const tabHref = (next: LearningRoomTab) =>
    data && next === roomTabs(data.workspace.kind)[0]!.id ? canonical! : `${canonical}?view=${next}`;
  const lastTab = useRef<LearningRoomTab | null>(null);
  useEffect(() => {
    const previous = lastTab.current;
    lastTab.current = resolvedTab;
    if (previous === 'video' && resolvedTab !== null && resolvedTab !== 'video') {
      state.current.videoPlaying = false;
      void stopPlaybackRef.current?.();
    }
  }, [resolvedTab]);
```

`state.current.videoPlaying = false`를 함께 두는 이유는, 정지 보고가 도착하기 전 다음 하트비트가 재생 중으로 오해하지 않게 하기 위해서다.

- [ ] **Step 7: 잘못된 주소를 정리한다**

스펙 4장의 "주소를 정리한다"가 이 단계다. `?view=bogus`나 라이팅 방의 `?view=speak`처럼 해석 결과와 다른 값이 남아 있으면 주소를 바로잡는다. Step 6의 효과 바로 아래에 넣는다.

```tsx
  useEffect(() => {
    if (!data || !canonical || resolvedTab === null) return;
    const raw = searchParams.get('view');
    if (raw !== null && raw !== resolvedTab) router.replace(tabHref(resolvedTab));
    // tabHref는 data·canonical에서만 계산되므로 의존성에 넣지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, canonical, resolvedTab, searchParams, router]);
```

- [ ] **Step 8: 탭 목록과 선택 동작을 만든다**

`features`를 정하는 624줄(`const features = learningRoomFeatures(data.workspace.kind);`) 바로 아래에 넣는다. 이 지점은 조기 반환 뒤라 `data`가 반드시 있다.

```tsx
  const tabs = roomTabs(data.workspace.kind);
  const tab = resolvedTab!;
  const selectTab = (next: LearningRoomTab) => router.replace(tabHref(next));
```

- [ ] **Step 9: 탭 바를 그린다**

타이머 섹션이 닫히는 736줄 `</section>` 다음 줄에 넣는다.

```tsx
      <LearningRoomTabs tabs={tabs} current={tab} onSelect={selectTab} />
```

- [ ] **Step 10: 묶음별로 렌더를 나눈다**

765~773줄을 아래로 바꾼다. 영상 패널은 항상 마운트하고, 영상·자료 탭이 아닐 때만 화면에서 감춘다. 자막과 시청 구간이 이 패널 안에 있어 자료 탭에서도 보여야 한다.

```tsx
      {features.video && data.video && (
        <div className={cn(tab === 'video' || tab === 'source' ? undefined : 'hidden')}>
          <LearningVideoPanel
            video={data.video} title={data.workspace.title}
            tab={tab}
            notes={videoNotes}
            visits={videoVisits}
            stopped={locked || view.pendingEnd}
            stopToken={stopToken} stopPlaybackRef={stopPlaybackRef} onObservation={observeVideo} activity={activity} reload={reload}
          />
        </div>
      )}
      {features.speech && tab === 'speak' && <SpeechPanel workspaceId={id} ownerId={auth!.user.id} stopped={locked || view.pendingEnd || current?.pause_reason === 'MANUAL'} stopToken={stopToken} stopSpeechRef={stopSpeechRef} onMedia={observeSpeech} stopVideo={async () => { await stopPlaybackRef.current?.(); }} writingLink={features.writing} />}
      {features.legacySpeech && tab === 'ask' && <LegacySpeechRecords workspaceId={id} />}
```

774줄을 바꾼다.

```tsx
      {features.writing && tab === 'ask' && (<>
```

924줄 `{hasMore && (`를 바꿔 "이전 기록 더 보기"도 질문·노트 탭에만 둔다.

```tsx
      {tab === 'ask' && hasMore && (
```

`SessionHistory`(943줄)는 탭 밖에 그대로 둔다.

- [ ] **Step 11: 두 방 페이지에 Suspense 경계를 넣는다**

`useSearchParams`는 클라이언트 훅이며, 번들된 Next 문서(`apps/web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`)는 가장 가까운 `Suspense` 경계까지 클라이언트 렌더로 내려간다고 설명하고 경계를 권장한다. 두 페이지 파일은 내용이 같다. 각각 아래로 바꾼다.

```tsx
import { Suspense } from 'react';
import { LearningRoom } from '@/components/learning-room';
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={<p role="status">학습실을 불러오는 중…</p>}>
      <LearningRoom key={id} id={id} />
    </Suspense>
  );
}
```

- [ ] **Step 12: 검사**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: 모두 통과. `build`는 Suspense 경계 누락을 잡아내므로 이 작업에서는 반드시 돌린다.

- [ ] **Step 13: 커밋**

```bash
git add apps/web/src/components/learning-room.tsx apps/web/src/components/learning-video-panel.tsx "apps/web/src/app/(workspace)/learn/items/[id]/page.tsx" "apps/web/src/app/(workspace)/learn/[id]/page.tsx"
git commit -m "feat(web): split the learning room into activity tabs"
```

---

### Task 4: 녹음 중 탭 이동은 한 번 확인받는다

**Files:**
- Modify: `apps/web/src/components/speech-panel.tsx`
- Modify: `apps/web/src/components/learning-room.tsx`
- Modify: `apps/web/src/components/learning-room-tabs.tsx`

**Interfaces:**
- Consumes: Task 2의 `LearningRoomTabs`, Task 3의 탭 배선.
- Produces: `LearningRoomTabs`가 `blocked?: boolean`을 받아 막혀 있으면 선택을 보류하고 확인 줄을 보여준다. `SpeechPanel`이 `onRecordingChange?: (recording: boolean) => void`를 받는다.

**배경:** `speech-panel.tsx` 24줄에 `const [recording, setRecording] = useState(false);`가 있고, 76줄에 `useEffect(() => { if (stopped || stopToken > 0) void stop(); }, [stopped, stopToken, stop]);`가 있다.

- [ ] **Step 1: 녹음 상태를 방에 알린다**

`speech-panel.tsx` 9~15줄 시그니처에 `onRecordingChange`를 더한다.

```tsx
export function SpeechPanel({ workspaceId, ownerId, stopped, stopToken, stopSpeechRef, onMedia, stopVideo, onRecordingChange, writingLink = true }: {
  workspaceId: string; ownerId: string; stopped: boolean; stopToken: number;
  stopSpeechRef: RefObject<(() => Promise<void>) | null>;
  onMedia: (phase: 'prepare' | 'active' | 'stop') => Promise<string | null>;
  stopVideo: () => Promise<void>;
  onRecordingChange?: (recording: boolean) => void;
  writingLink?: boolean;
}) {
```

76줄 아래에 효과를 더한다. 언마운트할 때 거짓으로 되돌려, 탭을 옮긴 뒤에도 방이 녹음 중이라고 오해하지 않게 한다.

```tsx
  useEffect(() => { onRecordingChange?.(recording); return () => onRecordingChange?.(false); }, [recording, onRecordingChange]);
```

- [ ] **Step 2: 방이 녹음 상태를 들고 있게 한다**

`learning-room.tsx`의 `const searchParams = useSearchParams();` 아래에 넣는다. `useCallback`은 이미 import되어 있다.

```tsx
  const [recording, setRecording] = useState(false);
  const onRecordingChange = useCallback((value: boolean) => setRecording(value), []);
```

Task 3 Step 10에서 만든 `SpeechPanel` 사용처에 `onRecordingChange={onRecordingChange}`를 더한다.

- [ ] **Step 3: 탭 바가 확인을 받게 한다**

`learning-room-tabs.tsx` 전체를 아래로 바꾼다.

```tsx
'use client';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import type { LearningRoomTab } from './learning-room-view';

export function LearningRoomTabs({ tabs, current, blocked = false, onSelect }: {
  tabs: readonly { id: LearningRoomTab; label: string }[];
  current: LearningRoomTab;
  blocked?: boolean;
  onSelect: (tab: LearningRoomTab) => void;
}) {
  const [pending, setPending] = useState<LearningRoomTab | null>(null);
  if (tabs.length < 2) return null;
  const choose = (next: LearningRoomTab) => {
    if (next === current) return;
    if (blocked) { setPending(next); return; }
    onSelect(next);
  };
  return (
    <div className="space-y-3">
      <nav aria-label="학습 활동" className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map((tab) => {
          const active = tab.id === current;
          return (
            <button
              key={tab.id}
              type="button"
              aria-pressed={active}
              onClick={() => choose(tab.id)}
              className={cn(
                'min-h-11 border-b-2 px-4 py-3 text-sm font-medium',
                active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
      {pending && (
        <div role="alert" className="space-y-3 rounded-xl bg-warning-soft p-4 text-sm">
          <p>녹음 중이에요. 다른 활동으로 옮기면 녹음이 멈춰요.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { const next = pending; setPending(null); onSelect(next); }}>녹음을 멈추고 이동</Button>
            <Button variant="outline" onClick={() => setPending(null)}>계속 녹음</Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 방에서 `blocked`를 넘긴다**

Task 3 Step 9에서 넣은 탭 바 사용처를 바꾼다.

```tsx
      <LearningRoomTabs tabs={tabs} current={tab} blocked={recording} onSelect={selectTab} />
```

- [ ] **Step 5: 검사**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 통과.

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/components/learning-room-tabs.tsx apps/web/src/components/learning-room.tsx apps/web/src/components/speech-panel.tsx
git commit -m "feat(web): confirm before a tab change stops an active recording"
```

---

### Task 5: 문서 갱신과 실제 브라우저 검증

**Files:**
- Modify: `docs/LEARNING_ROOM.md`

**Interfaces:**
- Consumes: Task 3~4의 완성된 화면.
- Produces: 없음.

- [ ] **Step 1: 문서를 고친다**

`docs/LEARNING_ROOM.md`의 "YouTube로 공부하기" 절 첫 문단 뒤에 한 문단을 넣는다.

```markdown
리스닝 방은 **영상·메모 / 말하기 / 질문·노트 / 자료** 탭으로 나뉜다. 현재 탭은 주소의 `?view=`에 남아 새로고침과 뒤로가기에서 유지되며, 알 수 없는 값은 기본 탭으로 정리한다. 영상 탭을 벗어나면 영상을 멈추고 마지막 위치를 저장하고, 녹음 중에 탭을 옮기려 하면 한 번 확인한다. 스피킹·라이팅 방은 활동이 하나여서 탭을 표시하지 않는다.
```

- [ ] **Step 2: 로컬 환경을 띄운다**

```bash
supabase start
pnpm --filter @paceon/web dev
```

확인된 임시 계정으로 로그인하고 영상이 있는 리스닝 방을 연다. 계정이 없으면 로컬 Auth 관리자 API로 만들고, `POST /api/learning/videos`에 `{requestId, items:[{url}]}`로 영상을 하나 등록한다. 확인이 끝나면 임시 계정을 지운다.

- [ ] **Step 3: 화면 길이를 잰다**

브라우저를 390px 폭으로 줄이고 콘솔에서 실행한다.

```js
({ height: document.documentElement.scrollHeight, screens: (document.documentElement.scrollHeight / innerHeight).toFixed(1) })
```

Expected: 변경 전 3,096px(약 3.7화면)에서 크게 줄어든다. 측정값을 커밋 메시지에 적는다.

실제 결과(2026-09-16, 영상 1개·기록 없는 방): 영상 탭 1,499px(1.8화면), 말하기 탭 1,420px(1.7화면), 라이팅 방 1,267px(1.5화면). 1.5화면 목표에는 못 미쳤고, 남은 높이의 780px가 영상·재생 도구·쉐도잉·메모 한 덩어리다. 이 구성은 영상 탭에 있어야 하므로 1.8화면에서 마무리하기로 했다.

- [ ] **Step 4: 시간 집계가 어긋나지 않는지 확인한다**

영상을 재생한 뒤 "말하기" 탭으로 옮기고 30초 기다린다. 영상이 멈추는지 보고 DB로 확인한다.

```bash
docker exec -i supabase_db_PaceOn psql -U postgres -d postgres -tA -F'|' \
  -c "select status, coalesce(pause_reason,'-'), elapsed_seconds from public.learning_sessions order by started_at desc limit 1"
```

Expected: 탭을 옮긴 뒤 `elapsed_seconds`가 더 늘지 않는다. 다시 "영상·메모" 탭에서 재생하면 세션이 재개되고 다시 늘어난다.

- [ ] **Step 5: 나머지 동작을 확인한다**

- 새로고침과 뒤로가기에서 탭이 유지·복귀되는지.
- 주소에 `?view=bogus`를 직접 넣으면 기본 탭으로 가고 주소가 정리되는지.
- 녹음을 시작한 뒤 다른 탭을 누르면 확인 줄이 뜨고, "녹음을 멈추고 이동"을 누르면 미분석 녹음이 남아 있는지.
- 라이팅 방과 스피킹 방에서 탭 바가 보이지 않는지.

- [ ] **Step 6: 커밋**

```bash
git add docs/LEARNING_ROOM.md
git commit -m "docs: describe the learning room activity tabs"
```
