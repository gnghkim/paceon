# Adaptive Learning Scheduler — DESIGN.md

Version: 0.1  
Status: Design Specification  
Platform: Web / PWA  
Primary Theme: Light  
Optional Theme: Dark  
Design Direction: Calm Adaptive Learning

---

# 1. Design Vision

이 제품은 일반적인 학생용 공부앱이나 게임형 학습앱이 아니다.

디자인 목표는 다음과 같다.

> **Linear처럼 정돈되어 있고, Sunsama처럼 차분하며, Readwise처럼 학습 진도가 잘 보이는 AI 학습 플래너.**

사용자는 앱을 열었을 때 많은 기능을 마주하는 것이 아니라 아래 세 가지를 즉시 이해할 수 있어야 한다.

1. 오늘 무엇을 해야 하는가
2. 현재 목표 대비 얼마나 진행했는가
3. 지금 속도라면 언제 끝나는가

AI는 전면에 드러나는 챗봇이 아니라 학습계획을 조용히 관리하는 **Invisible Intelligence**로 표현한다.

---

# 2. Design Principles

## 2.1 Calm

화면은 사용자를 자극하지 않는다.

- 과도한 Gradient 금지
- 과도한 Animation 금지
- Gamification 최소화
- 불필요한 Badge 최소화
- 지나치게 많은 색상 사용 금지

UI는 학습을 방해하지 않아야 한다.

---

## 2.2 Action First

대시보드보다 오늘 해야 할 행동이 먼저다.

홈 화면의 핵심 질문:

> 오늘 무엇을 공부해야 하지?

따라서 기본 홈은 Dashboard가 아니라 **Today**다.

---

## 2.3 Progress Must Be Visible

사용자는 항상 자신의 위치를 알 수 있어야 한다.

최소 다음을 시각화한다.

- 실제 진도
- 계획 진도
- Ahead / Behind
- 목표 완료일
- 예상 완료일
- 오늘 목표
- 실제 수행량

---

## 2.4 AI Should Explain, Not Dominate

AI는 별도 Chatbot UI를 기본으로 사용하지 않는다.

AI 출력은 주로 다음 형태로 나타낸다.

- Insight
- Recommendation
- Schedule Adjustment
- Difficulty Estimate
- Completion Forecast

예:

> 최근 7일간 독서 속도가 증가하여 예상 완료일이 3일 앞당겨졌습니다.

---

## 2.5 User Control

자동 재계획을 하더라도 사용자가 이유를 이해할 수 있어야 한다.

자동 변경에는 반드시 설명을 제공한다.

예:

> 오늘 계획보다 12페이지 적게 읽어, 남은 6회 학습에 2페이지씩 분산했습니다.

필요하면 사용자가 다음을 선택할 수 있다.

- 유지
- 재조정
- 되돌리기
- 일정 고정

---

# 3. Visual References

디자인 방향 참고:

- Linear: 전체적인 UI 밀도와 정돈감
- Sunsama: Today 중심의 하루 계획 UX
- Motion: Calendar와 자동 일정 배치
- Readwise Reader: 독서 진도와 Resource 중심 표현
- Superlist: 모바일 내비게이션과 Quick Add

직접적인 복제는 하지 않는다.

---

# 4. Brand Personality

브랜드 성격:

- Intelligent
- Calm
- Focused
- Trustworthy
- Personal
- Adaptive
- Modern

피해야 할 느낌:

- 유치한 교육앱
- 과한 게임 UI
- 기업용 ERP
- 복잡한 BI Dashboard
- AI Chat 중심 제품
- 지나치게 화려한 생산성 앱

---

# 5. Color System

## 5.1 Light Theme

### Background

```css
--background: #FAFAF8;
--surface: #FFFFFF;
--surface-subtle: #F5F5F2;
--surface-muted: #EFEFED;
```

### Text

```css
--text-primary: #1C1D20;
--text-secondary: #72757D;
--text-tertiary: #9A9CA2;
--text-disabled: #BFC1C6;
```

### Border

```css
--border-default: #E7E7E3;
--border-strong: #D7D7D2;
```

### Primary

```css
--primary: #5965E8;
--primary-hover: #4D58D6;
--primary-soft: #EEF0FF;
```

### Semantic

```css
--success: #3C9A72;
--success-soft: #EAF6F0;

--warning: #D69A45;
--warning-soft: #FBF2E4;

--danger: #D75B5B;
--danger-soft: #FBECEC;

--info: #4D82C8;
--info-soft: #EAF2FB;
```

---

## 5.2 Resource Colors

Resource별 색상은 최대 6개만 사용한다.

기본 Palette:

```css
--resource-blue: #5C7BEF;
--resource-purple: #8A6FD1;
--resource-green: #56A17C;
--resource-amber: #C99047;
--resource-rose: #C96D7A;
--resource-teal: #4B9EA0;
```

Resource 생성 시 하나를 할당한다.

색상은 장식용보다 식별용으로 사용한다.

---

## 5.3 Status Colors

```text
On Track   → Primary / Neutral
Ahead      → Success
Behind     → Warning
Overdue    → Danger
Completed  → Success / Muted
Review     → Amber
AI Insight → Primary Soft
```

---

# 6. Dark Theme

Dark mode는 지원하지만 기본값은 Light다.

```css
--background: #151619;
--surface: #1D1F23;
--surface-subtle: #24262B;

--text-primary: #F2F2F0;
--text-secondary: #A8ABB2;

--border-default: #303239;

--primary: #7B83F3;
```

Dark mode에서도 지나치게 높은 Contrast를 피한다.

---

# 7. Typography

기본 글꼴:

```text
Pretendard
```

fallback:

```css
font-family:
  Pretendard,
  Inter,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

영문 숫자 가독성을 위해 Inter 사용 가능.

---

## 7.1 Type Scale

```text
Display
32px / 40px / 700

H1
28px / 36px / 700

H2
22px / 30px / 650

H3
18px / 26px / 650

Body Large
16px / 24px / 400

Body
14px / 22px / 400

Small
13px / 20px / 400

Caption
12px / 18px / 500
```

숫자 및 진행률은 tabular numerals 사용을 권장한다.

```css
font-variant-numeric: tabular-nums;
```

---

# 8. Spacing

8px Grid를 기본으로 한다.

```text
4
8
12
16
20
24
32
40
48
64
```

기본 카드 Padding:

```text
Desktop: 20~24px
Mobile: 16px
```

---

# 9. Border Radius

```text
Small control     6px
Button            8px
Card              12px
Large card/modal  16px
```

과도하게 둥근 pill 디자인은 Badge, Filter, Status에만 사용한다.

---

# 10. Shadow

Shadow는 최소화한다.

Card 기본:

```css
box-shadow:
0 1px 2px rgba(0,0,0,0.03),
0 4px 12px rgba(0,0,0,0.03);
```

Border를 Shadow보다 우선 사용한다.

---

# 11. Desktop Layout

기본 구조:

```text
┌───────────────────────────────────────────────────────────────┐
│ Header                                                        │
├──────────────┬───────────────────────────────┬────────────────┤
│ Sidebar      │ Main                          │ Context Panel  │
│              │                               │                │
│ Today        │ Today's Focus                 │ Insight        │
│ Calendar     │ Sessions                      │ Progress       │
│ Library      │                               │ AI             │
│ Habits       │                               │                │
│ Insights     │                               │                │
└──────────────┴───────────────────────────────┴────────────────┘
```

권장 너비:

```text
Sidebar:
220~240px

Main:
min 560px
flex 1

Context Panel:
280~320px
```

전체 최대 Content Width:

```text
1440px
```

---

# 12. Sidebar

Desktop Navigation:

```text
Logo

Today
Calendar

Library
Habits

Insights

────────

Settings
```

현재 메뉴만 강조한다.

선택 상태:

```text
background: primary-soft
text: primary
```

아이콘과 Text 사용.

아이콘만 사용하는 Sidebar는 피한다.

---

# 13. Header

Header에는 핵심 기능만 둔다.

```text
Page Title

                        Search
                        Quick Add
                        User
```

높이:

```text
56~64px
```

Header를 과도하게 크게 만들지 않는다.

---

# 14. Mobile Navigation

하단 Navigation 사용.

```text
Today    Plan      +      Library    Insights
```

권장:

```text
Today
Calendar
Add
Library
Insights
```

가운데 Add 버튼은 강조한다.

Add Action:

```text
Add Book
Upload PDF
Add Course
Add Habit
Manual Resource
```

---

# 15. Today Screen

가장 중요한 화면이다.

목표:

> 사용자가 앱을 연 후 3초 안에 오늘 할 일을 이해할 수 있어야 한다.

구조:

```text
Today · Sep 14

Good evening

──────────────

Today's Focus
2h 10m planned

[Session]
[Session]

──────────────

Later Today

[Habit]
[Review]

──────────────

AI Insight
```

---

## 15.1 Today's Summary

상단:

```text
Today
September 14

2h 10m planned
3 sessions
```

필요하면:

```text
82% weekly target
```

표시.

---

## 15.2 Session Card

예:

```text
┌──────────────────────────────────────────┐
│ ● BOOK                                   │
│                                          │
│ Atomic Habits                            │
│ Chapter 6                                │
│                                          │
│ 142 → 161p          ~32 min              │
│                                          │
│ ████████████░░░░                         │
│ 54%               +3% ahead             │
│                                          │
│                        [Start reading]   │
└──────────────────────────────────────────┘
```

표현 순서:

1. Resource type
2. Resource title
3. 오늘 학습단위
4. workload / 예상시간
5. 전체 진도
6. Start CTA

---

# 16. Progress Visualization

이 제품의 대표적인 Visual Component다.

## 16.1 Plan vs Actual Progress

Actual과 Planned를 동시에 보여준다.

Option A:

```text
Actual
██████████████░░░░     54%

Plan
█████████████░░░░░     51%
```

Option B:

```text
██████████████●────────

             ▲
          Planned
```

Mobile에서는 Option B를 선호한다.

---

## 16.2 Ahead / Behind

```text
+3% Ahead
```

```text
12 pages behind
```

표현은 비난하지 않는다.

피해야 할 표현:

```text
FAILED
BAD
YOU MISSED
```

사용:

```text
Behind plan
Needs adjustment
Schedule updated
```

---

# 17. Completion Forecast

이 서비스의 핵심 UI다.

Resource Detail과 Resource Card에서 사용한다.

```text
Expected completion

OCT 18

Target
OCT 24

6 days ahead
```

또는 Timeline:

```text
NOW            EXPECTED            TARGET

●────────────────●──────────────────○

Sep 14          Oct 18             Oct 24
```

Ahead:

```text
Success
```

Behind:

```text
Warning
```

Overdue:

```text
Danger
```

---

# 18. Resource Library

Grid보다 List + Cover 조합을 기본으로 한다.

Desktop:

```text
Cover

Atomic Habits
James Clear

██████████░░░░

142 / 320p
54%

Expected Oct 18
6 days ahead
```

Resource filters:

```text
All
Active
Reading
Learning
Completed
Paused
```

정렬:

```text
Recently Active
Progress
Target Date
Title
```

---

# 19. Resource Detail

구조:

```text
Cover + Metadata

Title
Author

Progress
54%

142 / 320p

Expected completion
Oct 18

Target
Oct 24

6 days ahead

──────────────

Tabs

Overview
Plan
Units
History
Insights
```

---

## 19.1 Overview

표시:

```text
Current progress
Plan progress
Estimated completion
Current pace
Average session
Difficulty
```

---

## 19.2 Units

예:

```text
✓ Chapter 1

✓ Chapter 2

● Chapter 3
  72~98p

○ Chapter 4
  99~128p
```

AI difficulty:

```text
●●●○○ Moderate
```

---

# 20. Calendar

Calendar는 업무 일정앱처럼 복잡하게 만들지 않는다.

지원:

```text
Day
Week
Month
```

Default:

```text
Week
```

Session Card:

```text
Grammar in Use
Unit 14

40m
```

Resource Color를 사용한다.

상태:

```text
Completed
Current
Future
Overdue
Pinned
```

---

## 20.1 Drag & Drop

사용자가 Future Session을 이동할 수 있다.

이동 후 Replanner가 필요하면:

```text
Moving this session affects 4 future sessions.

[Recalculate]
[Keep as is]
```

를 표시한다.

---

# 21. Schedule Adjustment UI

대표 UX 중 하나다.

```text
Plan updated

오늘 계획보다 12페이지 적게 읽었습니다.

Before             Updated

Tue 20p            22p
Wed 20p     →      22p
Thu 20p            22p

Target date
Oct 24             Oct 24

목표일을 유지하기 위해
남은 6회 학습에 2페이지씩 분산했습니다.

[Keep change]
[Adjust]
[Undo]
```

AI가 아니라 Scheduler가 계산한 변경이어도 동일한 Component를 사용한다.

---

# 22. AI Insight

AI는 Card 형태로 표현한다.

```text
✦ Pace Insight

최근 7일간 독서 속도가
18.2 → 21.4 pages/day로 증가했습니다.

현재 속도라면 목표보다
6일 먼저 완독할 수 있습니다.

이번 주 계획은 변경하지 않았습니다.

[Why?]
[Adjust plan]
```

AI Card 색상:

```text
primary-soft
```

AI 답변을 과도하게 길게 표시하지 않는다.

기본 2~4문장.

---

# 23. Difficulty UI

AI Difficulty를 내부 숫자로 노출하지 않는다.

Default:

```text
Difficulty

● ● ● ○ ○

Moderate
```

상세 클릭:

```text
Estimated difficulty
3.2 / 5

Confidence
72%

Why

• 개념 밀도가 높음
• 이전 Unit보다 분량이 많음
• 유사 Unit 평균 학습시간이 길었음
```

---

# 24. Mastery UI

진도와 Mastery를 절대 같은 것으로 표현하지 않는다.

예:

```text
Progress
54%

Mastery
41%
```

Mastery가 없는 Resource는 해당 영역 자체를 숨긴다.

억지로 0%를 표시하지 않는다.

---

# 25. Analytics

초기 Analytics는 복잡하게 만들지 않는다.

4개 Summary Metric:

```text
6h 42m
Study time

87%
Plan completion

+3 days
Ahead

18
Day streak
```

Activity Chart:

```text
Mon ███████
Tue ████
Wed █████████
Thu ███
Fri ██████
```

차트보다 숫자 해석을 우선한다.

---

# 26. Habit UI

Resource Session과 비슷하게 보이되 별도 Type을 사용한다.

```text
Walk
30 minutes

3 / 5 this week
```

Habit streak는 보조 지표이며 게임화하지 않는다.

---

# 27. Empty States

Empty State는 사용자가 바로 행동할 수 있어야 한다.

Bad:

```text
No resources.
```

Good:

```text
아직 학습자료가 없습니다.

읽고 있는 책이나 공부 중인 교재를 추가하면
자동으로 학습 일정을 만들어드립니다.

[Add your first resource]
```

---

# 28. Loading States

Skeleton 사용.

전체 페이지 Spinner는 피한다.

AI 분석처럼 시간이 걸리는 작업:

```text
Analyzing your resource

✓ File uploaded
✓ Contents detected
● Building learning units
○ Estimating difficulty
```

Progress 상태를 보여준다.

---

# 29. Error States

외부 API 실패를 기술적으로 표현하지 않는다.

Bad:

```text
Google Books API 429
```

Good:

```text
도서 정보를 불러오지 못했습니다.

다른 도서 검색 서비스를 시도하거나
직접 정보를 입력할 수 있습니다.

[Retry]
[Enter manually]
```

---

# 30. Interaction

기본 Animation:

```text
150~220ms
```

사용:

- hover
- card expand
- modal
- schedule move
- progress update

금지:

- 과한 spring
- bounce
- confetti 기본 사용
- 지속적인 animated background

완독 같은 중요한 milestone에서는 작은 축하 Animation 정도는 허용한다.

---

# 31. Buttons

Primary:

```text
Start study
Save
Create plan
```

Secondary:

```text
Adjust
View details
```

Ghost:

```text
Cancel
Why?
```

Danger:

```text
Delete
Remove
```

Button height:

```text
Small: 32px
Default: 40px
Large: 44~48px
```

---

# 32. Form Design

한 화면에 지나치게 많은 설정을 보여주지 않는다.

Plan 생성:

Step 1

```text
What are you studying?
```

Step 2

```text
Where are you now?
```

Step 3

```text
How do you want to plan?
```

Step 4

```text
When can you study?
```

Step 5

```text
Review your plan
```

Wizard 방식 권장.

---

# 33. Resource Add Flow

```text
Add Resource

[Search Book]

[Scan ISBN]

[Upload PDF]

[Add Course]

[Manual]
```

Book Search 결과:

```text
Cover
Title
Author
Publisher
Pages

[Use this book]
```

---

# 34. Responsive Breakpoints

권장:

```text
Mobile
< 640px

Tablet
640~1024px

Desktop
> 1024px

Wide
> 1280px
```

---

# 35. Tablet

Tablet에서는 Sidebar를 collapsed 가능하게 한다.

Context Panel은 Main 아래로 이동 가능.

---

# 36. Mobile

Mobile에서는:

- Sidebar 없음
- Bottom Navigation
- Context Panel 없음
- Insight는 Card로 Inline 표시
- Calendar는 Day/Agenda 중심
- Long table 금지
- Modal보다 Bottom Sheet 우선

---

# 37. Accessibility

최소 기준:

- WCAG AA Contrast
- Keyboard navigation
- Visible focus ring
- aria-label
- Dialog focus trap
- Button hit area minimum 40px
- Color alone으로 상태 전달 금지

예:

```text
● Ahead
```

처럼 색 + Text 동시 사용.

---

# 38. Icon System

Lucide Icons 사용 권장.

Icon Style:

```text
stroke width 1.5~2
```

Resource Type:

```text
Book
FileText
GraduationCap
Video
ListChecks
```

AI:

```text
Sparkles
```

과도하게 Robot icon을 사용하지 않는다.

---

# 39. Component Library

shadcn/ui를 기반으로 한다.

필수 Component:

```text
Button
Card
Dialog
Sheet
Tabs
DropdownMenu
Popover
Tooltip
Progress
Badge
Input
Select
Calendar
Command
Skeleton
Toast
AlertDialog
```

Custom Domain Components:

```text
SessionCard

ResourceCard

ProgressComparison

CompletionForecast

ScheduleAdjustment

AIInsightCard

DifficultyIndicator

MasteryIndicator

WeeklySummary

LearningUnitRow
```

---

# 40. Domain Component API Principles

UI Component에 Business Logic을 넣지 않는다.

Bad:

```text
ResourceCard가 completion date를 계산
```

Good:

```text
ResourceCard는 이미 계산된 데이터를 받음
```

Example:

```typescript
<ResourceCard
  title="Atomic Habits"
  progress={54}
  plannedProgress={51}
  expectedCompletion="2026-10-18"
  targetDate="2026-10-24"
  status="ahead"
/>
```

---

# 41. Design Tokens

가능하면 Tailwind theme에 Token을 정의한다.

직접 Hex를 Component 내부에서 반복하지 않는다.

Example:

```text
bg-background
bg-surface
text-primary
text-secondary
border-default

bg-primary
bg-primary-soft

text-success
text-warning
text-danger
```

---

# 42. UX Writing

문장은 짧고 자연스럽게 쓴다.

Bad:

```text
AI 기반 학습 일정 최적화 프로세스가 실행되었습니다.
```

Good:

```text
계획을 다시 조정했습니다.
```

Bad:

```text
사용자의 학습량 부족이 감지되었습니다.
```

Good:

```text
오늘 계획보다 12페이지 적게 읽었습니다.
```

---

# 43. Korean-first UI

초기 서비스는 한국어 우선으로 설계한다.

하지만 코드와 DB 값은 영어 enum을 사용한다.

Example:

```text
DEADLINE
PACE
BALANCED
```

UI:

```text
목표일 유지
하루 분량 유지
균형 조정
```

---

# 44. Date / Number Formatting

한국어:

```text
9월 14일
10월 18일
```

상세:

```text
2026년 10월 18일
```

진도:

```text
142 / 320쪽
```

시간:

```text
약 32분
```

---

# 45. Page Hierarchy

MVP:

```text
/login

/today

/calendar

/resources

/resources/new

/resources/[id]

/insights

/settings
```

Habit 추가 시:

```text
/habits
```

---

# 46. Today Priority Logic

화면 순서:

```text
1. Overdue / Needs Attention

2. Today's Focus

3. Later Today

4. Habits

5. AI Insight
```

단, 경고를 과도하게 상단에 쌓지 않는다.

---

# 47. Information Density

Desktop에서는 중간 정도의 정보 밀도를 유지한다.

Linear처럼 compact하지만 읽기 어려울 정도로 조밀하지 않는다.

기본 Row height:

```text
44~52px
```

Learning Unit:

```text
48~56px
```

---

# 48. AI Transparency

AI가 판단한 값과 시스템 계산값을 구분한다.

Example:

```text
Estimated difficulty
AI estimate
```

```text
Current progress
Calculated from your records
```

사용자가 AI 판단을 수정할 수 있으면 더 좋다.

예:

```text
AI: Moderate

[Too easy]
[Accurate]
[Too hard]
```

이 데이터는 Learner Profile 개선에 활용한다.

---

# 49. Notifications

Notification tone은 압박하지 않는다.

Bad:

```text
오늘 목표를 달성하지 못했습니다!
```

Good:

```text
오늘 계획에서 12페이지가 남았습니다.
내일 일정에 반영할까요?
```

---

# 50. Milestones

완독/완강 시:

```text
Completed

Atomic Habits

320 pages
18 sessions
12h 42m

Finished Sep 28
4 days earlier than planned
```

작은 Celebration은 허용.

하지만 게임 보상 체계를 중심으로 만들지 않는다.

---

# 51. Design Anti-patterns

사용 금지 또는 최소화:

```text
Heavy gradients

Glassmorphism everywhere

Neon AI colors

ChatGPT-like main UI

Excessive charts

Excessive cards inside cards

Very rounded everything

Too many badges

Confetti on every completion

Red failure messages

Large marketing hero inside app

Dashboard overloaded with metrics
```

---

# 52. MVP Design Priority

Priority 1:

```text
Today
Session Card
Progress
Completion Forecast
```

Priority 2:

```text
Resource Library
Resource Detail
Calendar
```

Priority 3:

```text
Schedule Adjustment
AI Insight
Analytics
```

---

# 53. Definition of Done — Design

MVP UI는 다음 질문에 즉시 답할 수 있어야 한다.

### Today

```text
오늘 무엇을 해야 하는가?
```

### Resource

```text
지금 얼마나 했는가?
```

### Progress

```text
계획보다 앞서거나 뒤처졌는가?
```

### Forecast

```text
현재 속도면 언제 끝나는가?
```

### Adaptive

```text
왜 일정이 바뀌었는가?
```

---

# 54. Final Product Experience

이 앱을 사용하는 경험은 다음과 같아야 한다.

```text
앱을 연다

↓

오늘 공부할 내용을 확인한다

↓

공부한다

↓

실제 학습량을 입력한다

↓

앱이 자동으로 계획을 조정한다

↓

필요하면 AI가 이유를 설명한다

↓

사용자는 계획을 다시 짤 필요가 없다
```

최종 목표:

> **사용자가 계획을 관리하는 것이 아니라, 시스템이 사용자의 실제 학습을 보면서 계획을 관리한다.**
