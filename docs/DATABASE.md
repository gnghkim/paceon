# PaceOn Database — Phase 1

## 도메인과 소유권

User는 `auth.users`를 사용한다. 별도의 비밀번호 테이블은 만들지 않는다. 모든 public 업무 행에 `user_id`를 두고 RLS로 `auth.uid()`와 일치하는 행만 허용한다. FK는 부모의 ID뿐 아니라 소유자를 포함한다. 같은 사용자의 서로 다른 자료도 unit/session/event 연결에서 혼합할 수 없다.

| 테이블 | 역할 및 주요 계약 |
| --- | --- |
| learner_profiles | 사용자 시간대·선호 시간과 추정 속도. 표본이 없는 수치는 NULL |
| resources | 자료 메타데이터, workload 단위, 최초 완료 분량. BOOK은 PAGE 단위 |
| resource_units | 자료 안의 단위, 순서, 선택적 상위 단위, 페이지 범위 |
| goals | 자료별 목표. 시작일·목표일·선호 일일 분량·모드 |
| availability_rules | 사용자 전체의 ISO 요일(월=1~일=7)별 가용 분. 자료별로 시간 예산 중복 생성하지 않음 |
| plans | 목표에 속한 단일 자료 계획. 목표일과 예측 완료일 별도 보존. 변경 버전 |
| replan_runs | 재계획 결과·원인·정책 버전·전후 snapshot. append-only |
| schedule_sessions | 계획의 날짜·계획 분량·페이지 범위·고정/완료 상태·배정 버전 |
| progress_events | 신규 학습/복습/무효화 이벤트. 멱등성 키와 선택적 세션·단위 참조. append-only |

필요한 인덱스는 소유자, 자료 순서, 계획 날짜, 사용자 학습일, FK 조회에 둔다. 인증되지 않은 `anon`은 업무 테이블 권한이 없다. authenticated는 자신의 일반 행 CRUD, 이력 테이블 SELECT/INSERT만 가능하다. 삭제 이력이 있는 자료/계획은 FK로 삭제가 제한되므로 `ARCHIVED` 상태를 사용한다. 계정 삭제는 신뢰된 서버의 Auth 삭제에 따라 소유 데이터를 cascade 정리한다. service_role은 관리 권한이며 브라우저에 제공하지 않는다.

## 날짜와 진도

- `created_at`, `updated_at`, `started_at`, `completed_at`는 `timestamptz`. PostgreSQL은 절대 시각을 저장하며 UTC로 교환한다.
- `study_date`, `start_date`, `target_date`, `forecast_date`는 시간 없는 지역 달력 날짜 `date`. 계획/이벤트에는 유효한 timezone을 snapshot으로 보존한다. 프로필 timezone 변경이 과거 학습일을 바꾸지 않는다.
- `initial_completed_workload`는 등록 전에 완료한 분량. 책에서 80이면 80페이지까지 완료했다는 뜻이다. 이후 첫 신규 페이지는 81이다. 기록이 생기면 최초 기준값과 workload 단위는 변경할 수 없다.
- `LEARNING`은 신규 학습, `REVIEW`는 복습. 둘 다 실제 분량 양수. 페이지가 있으면 양 끝 포함 분량과 일치해야 한다. 단위·세션·자료 참조와 자료 총 페이지 상한은 DB가 검증한다.
- `VOID`는 특정 원본 LEARNING/REVIEW를 무효화한다. 원본을 삭제하지 않고 `voids_event_id`로 연결한다. 같은 원본은 한 번만 무효화 가능하며 다른 자료 또는 VOID를 다시 무효화할 수 없다. VOID의 분량은 0, 페이지·소요시간은 NULL이다.
- 정정은 VOID와 새 기록을 한 transaction에 저장한다. 유효 진도는 최초 기준값 + 무효화되지 않은 LEARNING 합계, 속도는 유효 신규 학습 중 소요시간이 양수인 표본에서 계산한다. NULL/0분과 복습은 속도 표본에서 제외한다.
- 이번 단계에서는 projection을 저장하지 않는다. 중복 페이지·초과 총량과 연속 진도 정책은 Phase 5 기록 서비스에서 자료 row lock 안에 검증해야 한다. DB에 insert 가능한 이벤트를 검증 완료한 학습 실적으로 간주하면 안 된다.

## 계획 버전과 원자적 적용 계약

`plans.version`은 1로 시작한다. UPDATE마다 DB trigger가 정확히 1 증가시키며 클라이언트가 직접 원하는 버전으로 덮어쓸 수 없다. 설정 수정도 `WHERE id = ... AND version = expected_version` 조건으로 수행하고 변경 행 0개면 충돌로 처리한다. `updated_at`도 DB가 갱신한다.

`schedule_sessions.plan_version`은 해당 분량 배정 당시 버전이다. 과거 snapshot이므로 현재 plans.version과 같을 필요는 없지만 미래 버전은 허용하지 않는다. 기존 과거·완료·고정 세션의 배정 버전은 그대로 둔다. ReplanRun의 APPLIED 결과는 from_version + 1 = to_version, 실패/건너뜀은 같은 버전이다. 같은 계획 버전에 적용 성공한 run은 하나뿐이다.

Phase 5의 저장 RPC는 하나의 PostgreSQL transaction 안에서 다음 순서를 사용한다:

1. 호출 사용자 확인, 자료 및 계획 행을 일정한 순서로 `FOR UPDATE` 잠금.
2. ProgressEvent 멱등성 키가 이미 있으면 원요청과 비교하여 동일 요청만 기존 결과 반환.
3. expected_version 검사, 신규/정정 이벤트 및 유효 진도 범위 검증.
4. 결정론적 엔진 결과의 분량 합계·페이지 중복·세션 보존 검증.
5. 계획 버전 증가, ReplanRun 삽입, 수정 가능한 미래 세션만 갱신.
6. 실패 시 모든 변경 rollback.

이 최종 RPC와 자동 재계획은 아직 구현하지 않았다. 여러 REST 요청을 묶어 원자적이라고 부르지 않는다. 현재 세션 DML은 소유자의 수동 편집만 보호하며 자동 재계획의 과거/고정 보존 정책은 후속 RPC에서 강제한다.

자식 행의 자료 범위·계층·VOID 검증은 AFTER trigger에서 문장 전체의 결과를 검사한다. 자료 행에 `FOR NO KEY UPDATE`를 잡아 메타데이터 수정과 직렬화하며, 외래키가 사용하는 KEY SHARE와 충돌하는 잠금 승격을 피한다. 여러 행을 한 번에 넣어도 순환 계층과 VOID→VOID는 허용하지 않는다.

## 개발 seed와 검증

seed는 `alice@paceon.example`, `bob@paceon.example`의 비로그인 fixture다. encrypted_password와 identity를 만들지 않는다. 실제 로그인 UI용 계정은 Auth API로 별도 생성한다. 고정 UUID와 `ON CONFLICT DO NOTHING`으로 반복 실행할 수 있다.

`supabase db reset --local`은 PaceOn 로컬 데이터만 재생성하므로 개인 데이터를 넣은 이후에는 주의한다. pgTAP 테스트는 별도 fixture를 transaction 내에서 만들고 rollback한다. RLS는 실제 authenticated 역할과 JWT subject를 설정하여 검증하며, 별도 HTTP smoke는 실제 Auth API가 발급한 토큰으로 확인한다.

DB schema에서 생성한 `packages/shared/src/database.types.ts`가 DB 행 타입의 기준이다. `pnpm db:types`로 재생성한다. UI/도메인에서 사용하는 타입은 이 생성 파일을 참조하므로 필드 정의를 수동 복제하지 않는다.

공식 기준: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [DB 테스트](https://supabase.com/docs/guides/database/testing), [PostgreSQL 관계 제약](https://www.postgresql.org/docs/17/ddl-constraints.html).
