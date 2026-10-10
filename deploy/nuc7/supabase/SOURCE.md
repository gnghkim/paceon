# 출처

`supabase/supabase` 저장소 커밋 `ff80bb14991e68667c04f74248b954e8babe6fde`의 `docker/volumes/`에서 그대로 복사했다. 고치지 않는다.

| 이 폴더 | 원본 |
| --- | --- |
| `envoy/*` | `docker/volumes/api/envoy/*` (API 관문. `/auth`·`/rest`는 anon·service 키가 있어야 통과, `/pg/`는 service 키로만 열림. 밖에서 `/pg/`를 막는 것은 Tunnel 경로 규칙이다) |
| `db/roles.sql` | 서비스 역할 비밀번호를 `POSTGRES_PASSWORD`로 맞춘다 |
| `db/jwt.sql` | `app.settings.jwt_exp` |
| `db/webhooks.sql` | `supabase_functions` 스키마(Cloud와 같게) |

쓰지 않아 복사하지 않은 것: `realtime.sql`, `logs.sql`, `pooler.sql`, `_supabase.sql`(Realtime·로그 분석·풀러용).

버전을 올릴 때는 새 커밋에서 같은 파일을 다시 받고, `compose.yaml`의 이미지 버전을 그 커밋의 `docker/docker-compose.yml`과 맞춘 뒤 Task 3의 로컬 확인을 다시 한다.
