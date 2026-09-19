-- 독서 회상 카드: 읽고 나서 책을 덮고 떠올린 것을, 간격을 두고 다시 묻는다.
--
-- 지금까지 PaceOn이 잰 것은 읽은 쪽수와 시간이다. 그것은 넣은 양이지 남은 양이
-- 아니다. 다시 읽는 것보다 기억에서 꺼내는 쪽이 오래 남으므로, 읽은 직후 한 번
-- 꺼내게 하고 그것을 복습에 태운다. 특정 사용자에게 효과를 보장하지 않는다.
--
-- 표를 새로 만들지 않고 복습 표에 종류를 더한다. 간격 계산, 하루 세 개 제한,
-- 복습 기록 함수가 그대로 쓰이고, 오늘의 복습에 단어와 회상이 자연히 섞인다.
-- 복습은 과목을 가리지 않는 층이다. 영어 어휘는 그 첫 쓰임새였을 뿐이다.
--
-- 회상 카드에서 phrase는 물을 말(책 제목과 쪽 범위), meaning은 사용자가 직접
-- 떠올려 적은 내용이다. AI가 채우지 않는다.

alter table public.learning_expressions
  add column kind text not null default 'EXPRESSION'
    check (kind in ('EXPRESSION', 'RECALL')),
  add column resource_id uuid,
  add column start_page integer,
  add column end_page integer,
  -- 남의 책을 가리킬 수 없게 소유자까지 함께 묶는다. 다른 표와 같은 방식이다.
  add constraint learning_expressions_resource_fk
    foreign key (resource_id, user_id) references public.resources(id, user_id)
    on delete cascade,
  -- 회상 카드는 반드시 어느 책의 것이고, 표현 카드는 책에 묶이지 않는다.
  add constraint learning_expressions_recall_has_resource
    check ((kind = 'RECALL') = (resource_id is not null)),
  add constraint learning_expressions_page_range
    check (
      (start_page is null and end_page is null)
      -- 한쪽만 있으면 비교가 NULL이 되어 CHECK를 통과한다. 둘 다 있는지를 먼저 본다.
      or (kind = 'RECALL' and start_page is not null and end_page is not null
          and start_page >= 1 and end_page >= start_page and end_page <= 1000000)
    ),
  -- 회상은 사용자가 적은 것이 답이다. 뜻 찾기 줄에 절대 서지 않는다.
  add constraint learning_expressions_recall_no_lookup
    check (kind = 'EXPRESSION' or lookup_status = 'NONE');

-- 같은 표현을 두 번 저장하지 않는 규칙은 표현에만 둔다. 같은 범위를 다시 읽고
-- 다시 떠올리는 것은 중복이 아니라 또 한 번의 인출이다.
alter table public.learning_expressions
  drop constraint learning_expressions_user_id_phrase_key;
create unique index learning_expressions_phrase_once_idx
  on public.learning_expressions(user_id, phrase) where kind = 'EXPRESSION';

create index learning_expressions_resource_idx
  on public.learning_expressions(user_id, resource_id, created_at desc)
  where kind = 'RECALL';
