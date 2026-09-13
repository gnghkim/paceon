# PaceOn Scheduler — Phase 2

## 입력과 결과

`scheduleBook`는 `totalPages`, `completedThroughPage`(연속 완료 지점), `startDate`, `timezone`, `mode`, `dailyPages`, ISO 요일별 `availableMinutes`, `minutesPerPage`를 받는다. `dailyPages`는 Pace/Balanced에서 필수이며 Deadline에서는 생략 가능하다. 날짜는 YYYY-MM-DD 지역 달력 날짜다. 오늘을 내부에서 읽지 않는다. 같은 입력에 같은 결과를 반환하고 입력 객체를 수정하지 않는다.

`replanBook`는 여기에 `asOfDate`와 기존 세션을 받는다. 다음 날 이후만 재배정한다. 과거·오늘·완료·고정·진행 중 세션은 원본을 보존한다. 보존된 과거/오늘 분량은 실제 진도가 아니므로 완료 분량에 합산하지 않는다. 미래 고정/진행 중 세션만 남은 페이지에서 예약 제외한다. 미래 완료 세션은 완료 지점 안에 있어야 한다.

결과는 `ok`, `completed`, `conflict` 중 하나다. 성공에는 신규 세션, 보존 세션, 교체 대상 ID, 완료 예상일과 구조화된 변경 이유가 들어 있다. 충돌에는 보존 세션과 충돌 코드만 반환하고 부분 일정은 반환하지 않는다. 호출자는 conflict 결과를 적용하면 안 된다. ID와 계획 버전 발급은 저장 계층의 책임이다.

## 모드 정책 v1

- **Pace:** 가능한 날마다 선호 `dailyPages`를 유지하고 마지막 날만 잔여량을 배치한다. 특정 요일의 잔여 시간이 해당 분량을 담지 못하면 건너뛰거나 몰래 축소하지 않고 `TIME_CAPACITY`를 반환한다.
- **Deadline:** 목표일까지 수용 가능한 분량을 계산한다. 남은 날짜의 실제 수용량을 고려하여 가능한 한 균등하게 배분한다. 부족하면 `DEADLINE_CAPACITY`를 반환하며 목표일을 자동 변경하지 않는다.
- **Balanced:** 선호 분량으로 목표 충족을 시도하고 부족하면 일일 상한까지 증가시킨다. 기본 증가 상한은 **20%**, 정수 페이지로 내림한다. 시간 제약이 더 작으면 그 범위에서 배분한다. 목표일까지 부족하면 같은 상한으로 이후 학습일을 추가한다. 목표일이 없으면 선호 분량과 가용시간 안에서 진행한다.

완료 지점이 총 페이지와 같으면 새 세션 0개와 `completed`다. 목표일이 시작일보다 이르면 명시적 충돌이다. 요일이 없거나 모든 시간 예산이 0이면 `NO_AVAILABILITY`. 기본 탐색 상한은 시작일 포함 **3660일**이며 초과 시 `HORIZON_EXCEEDED`다. 호출자가 상한을 줄일 수 있다. 잘못된 날짜·비유한 수·소수 페이지·중복 요일은 `INVALID_INPUT`이다.

## 시간과 여러 자료

시간은 분 단위이며 계산 중에는 반올림하지 않는다. 하루 배정 가능 페이지는 `floor((가용 분 - 예약 분) / minutesPerPage)`다. 결과의 예상 분도 실제 곱을 보존하며, UI 반올림이 배분에 영향을 주지 않는다.

`reservedMinutes`는 다른 자료의 날짜별 사용 시간을 받는다. 미래 고정 세션 시간은 엔진이 자동으로 더하므로 호출자가 중복 포함하면 안 된다. 고정 분량이 이미 읽은 페이지와 겹치거나 고정끼리 겹치거나, 가용 요일·시간을 초과하면 원본을 보존하고 충돌을 반환한다. 남은 페이지는 고정 범위를 제외한 정렬 구간으로 배분한다. 시간대별 슬롯은 없으므로 같은 날짜에서는 페이지 순서대로 학습한다고 가정한다. 선행 페이지를 고정일 당일까지 배정할 수 없으면 `PINNED_ORDER` 충돌이다. 미래 고정 세션이 요청 시작일보다 앞서면 조용히 무시하지 않고 같은 충돌을 반환한다.

`scheduleBooks`는 사용자 공통 예산으로 여러 책을 **입력 순서의 우선순위**에 따라 계획한다. 이전 책의 배정 시간을 다음 책의 예약 시간으로 전달한다. 최적화 알고리즘은 아니며, 나중 책 충돌 시 전체 batch를 conflict로 반환한다. 모든 자료에 같은 가용시간과 timezone을 적용한다.

## 실제 속도 추정

`estimateReadingSpeed`는 `asOfDate`와 유효한 신규 학습 표본을 명시적으로 받는다. 최근 **30일(기준일 포함)**의 양수 페이지·양수 분 표본 **3개 이상**이면 총 분 / 총 페이지를 사용한다. 부족하면 호출자가 제공한 양수 `fallbackMinutesPerPage`를 사용한다.

무효화·중복 기록 제거는 저장 계층에서 수행한다. 함수는 동일 ID 중복을 거부한다. 복습, 미래 기록, 기간 밖 기록, NULL/0분은 표본에서 제외한다. 비유한 값과 음수는 잘못된 입력으로 처리한다. 임의의 이상치 클램프는 하지 않으며 결과에 표본 수·총 페이지·총 분과 `observed`/`fallback` 출처를 반환한다. 페이지 속도를 강의/Unit 속도와 섞지 않는다.

## 범위

현재 엔진은 연속 완료 지점 이후의 Book 페이지 전용이다. 복잡한 비연속 진도 projection, 강의 분할, 자동 일마감, 재계획 Undo, DB transaction과 실제 기록 저장은 후속 단계다. AI가 없어도 이 계산 모듈은 동작한다. 이해도는 계산하지 않는다.

## 사용 예

```ts
import { scheduleBook } from '@paceon/scheduler';

const result = scheduleBook({
  totalPages: 320,
  completedThroughPage: 80,
  startDate: '2026-09-14',
  timezone: 'Asia/Seoul',
  mode: 'PACE',
  dailyPages: 20,
  minutesPerPage: 1,
  availability: [1, 2, 3, 4, 5].map(isoWeekday => ({
    isoWeekday, availableMinutes: 60,
  })),
});

if (result.status === 'conflict') {
  // conflicts를 사용자에게 설명하고 DB에 부분 적용하지 않는다.
} else {
  // 12회, 첫 81~100p, 마지막 301~320p, forecastDate = '2026-09-29'.
  // 저장 시 session ID 및 plan_version은 서버에서 부여한다.
}
```

`replanBook`은 같은 입력에 `asOfDate`와 `existingSessions`를 추가한다. 실제 기록 합산과 VOID 처리는 호출 전에 수행하고 `completedThroughPage`를 검증한 뒤 전달한다.

`scheduleBooks`의 우선순위는 배열 순서이며 각 항목은 `{ id, input }`이다. availability/timezone/reservedMinutes는 batch 최상위에서 한 번만 전달한다. 이 API는 여러 책의 신규 계획용이며 여러 기존 계획의 동시 재계획 transaction은 후속 저장 계층에서 조정한다.

API는 YYYY-MM-DD의 0001~9999년, 총 페이지 1~10,000,000, 0~1 증가 비율, 요일당 0~1440분을 허용한다. IEEE-754 계산 오차를 보정하는 미소 허용값만 사용하며 시간 표시를 위한 정수 반올림을 계산에 사용하지 않는다. 잘못된 달력/속도 helper 입력은 RangeError를 던지고, 계획 API는 충돌 결과로 반환한다.

## 검증 명령

`pnpm test`와 `pnpm typecheck`로 엔진 테스트·독립 import·타입 계약을 검사한다. `pnpm build`는 순수 JS/선언 파일 생성과 Next.js 소비자 빌드를 함께 검증한다. 공통 TypeScript 설정에서 `.ts` import를 출력 `.js`로 바꾸므로 원본 Node 실행과 빌드 결과 모두 지원한다.
