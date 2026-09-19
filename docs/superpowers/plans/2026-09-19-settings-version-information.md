# Settings Version Information Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설정 화면에 빌드 대상 Git 커밋을 `YYYYMMDD-7자리해시` 형식으로 표시한다.

**Architecture:** 빌드 시 실행되는 작은 ESM 모듈이 명시적 버전 또는 Git 커밋 날짜·해시를 해석한다. Next.js 설정은 그 결과를 공개 환경 변수로 고정하고, 설정 서버 컴포넌트는 환경 변수만 읽어 렌더링한다.

**Tech Stack:** Next.js 16, TypeScript, Node.js ESM, Node test runner

---

## 파일 구성

- `apps/web/app-version.mjs`: 버전 문자열 형식화와 Git 메타데이터 조회만 담당한다.
- `apps/web/next.config.ts`: 계산된 버전을 `NEXT_PUBLIC_APP_VERSION`으로 빌드에 주입한다.
- `apps/web/src/app/(workspace)/settings/page.tsx`: 설정 화면의 버전 정보 카드를 렌더링한다.
- `tests/app-version.test.mjs`: 버전 우선순위, 형식, 실패 대체 동작을 검증한다.

### Task 1: 커밋 기반 버전 생성

**Files:**
- Create: `apps/web/app-version.mjs`
- Modify: `apps/web/next.config.ts`
- Test: `tests/app-version.test.mjs`

- [ ] **Step 1: 실패하는 단위 테스트 작성**

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatAppVersion, resolveAppVersion } from '../apps/web/app-version.mjs';

test('formats the commit date and seven-character hash', () => {
  assert.equal(formatAppVersion('2026-09-19', 'c77112d91'), '20260919-c77112d');
});

test('prefers an explicit public version', () => {
  assert.equal(resolveAppVersion({ NEXT_PUBLIC_APP_VERSION: 'release-1' }, () => { throw new Error('unused'); }), 'release-1');
});

test('falls back when git metadata is unavailable', () => {
  assert.equal(resolveAppVersion({}, () => { throw new Error('git missing'); }), '개발 버전');
});
```

- [ ] **Step 2: 테스트가 기능 부재로 실패하는지 확인**

Run: `node --test tests/app-version.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `apps/web/app-version.mjs`.

- [ ] **Step 3: 최소 버전 생성 모듈 작성**

```js
import { execFileSync } from 'node:child_process';

export function formatAppVersion(date, sha) {
  const compactDate = date.trim().replaceAll('-', '');
  const shortSha = sha.trim().slice(0, 7);
  return /^\d{8}$/.test(compactDate) && /^[0-9a-f]{7}$/i.test(shortSha)
    ? `${compactDate}-${shortSha}`
    : '개발 버전';
}

export function resolveAppVersion(env = process.env, runGit = (...args) => execFileSync('git', args, { encoding: 'utf8' })) {
  if (env.NEXT_PUBLIC_APP_VERSION?.trim()) return env.NEXT_PUBLIC_APP_VERSION.trim();
  try {
    return formatAppVersion(runGit('log', '-1', '--format=%cs'), runGit('rev-parse', '--short=7', 'HEAD'));
  } catch {
    return '개발 버전';
  }
}
```

- [ ] **Step 4: Next.js 빌드 환경에 버전 주입**

```ts
import type { NextConfig } from 'next';
import { resolveAppVersion } from './app-version.mjs';

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: resolveAppVersion() },
  transpilePackages: [...],
};
```

- [ ] **Step 5: 단위 테스트 통과 확인**

Run: `node --test tests/app-version.test.mjs`

Expected: 3 tests pass.

### Task 2: 설정 화면 버전 카드

**Files:**
- Modify: `apps/web/src/app/(workspace)/settings/page.tsx`
- Test: `tests/app-version.test.mjs`

- [ ] **Step 1: 설정 화면 계약 테스트 추가**

```js
test('settings page exposes the generated app version', async () => {
  const source = await readFile(new URL('../apps/web/src/app/(workspace)/settings/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /버전 정보/);
  assert.match(source, /NEXT_PUBLIC_APP_VERSION/);
});
```

- [ ] **Step 2: 새 테스트가 표시 코드 부재로 실패하는지 확인**

Run: `node --test tests/app-version.test.mjs`

Expected: FAIL because the settings source does not contain `버전 정보`.

- [ ] **Step 3: 설정 화면에 버전 정보 추가**

페이지 함수 안에서 `const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? '개발 버전';`을 선언하고 계정 섹션 아래에 다음 카드를 렌더링한다.

```tsx
<section aria-labelledby="version-title" className="space-y-3">
  <h2 id="version-title" className="font-semibold">버전 정보</h2>
  <div className="rounded-xl border border-border bg-card p-5">
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">앱 버전</span>
      <code className="text-sm font-medium">{appVersion}</code>
    </div>
  </div>
</section>
```

- [ ] **Step 4: 기능 테스트 통과 확인**

Run: `node --test tests/app-version.test.mjs`

Expected: 4 tests pass.

### Task 3: 통합 검증과 커밋

**Files:**
- Modify: `docs/superpowers/plans/2026-09-19-settings-version-information.md` (checkbox completion)

- [ ] **Step 1: 정적 검사와 전체 테스트 실행**

Run: `pnpm typecheck && pnpm lint && pnpm test`

Expected: all commands exit 0.

- [ ] **Step 2: 구현 커밋 생성**

```powershell
git add apps/web/app-version.mjs apps/web/next.config.ts 'apps/web/src/app/(workspace)/settings/page.tsx' tests/app-version.test.mjs docs/superpowers/plans/2026-09-19-settings-version-information.md
git commit -m "Show Git version in settings"
```

- [ ] **Step 3: 실제 커밋 버전으로 프로덕션 빌드 검증**

Run: `pnpm build`

Expected: build exits 0 and embeds the date plus the new commit's seven-character hash.

- [ ] **Step 4: 설정 화면 표시 확인**

Run the production server, open `/settings`, and confirm the `버전 정보` card matches `git log -1 --format=%cs` plus `git rev-parse --short=7 HEAD`.

