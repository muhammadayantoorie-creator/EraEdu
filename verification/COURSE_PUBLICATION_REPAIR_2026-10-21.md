# Historical course publication repair — 21 October 2026

Historical snapshot from 21 October. The publication requirement described here
was superseded by migration 034 on 23 October: enrolled students can now
join code exams independently of course publication. See the
[current exam access rollout](FIX_EXAM_COURSE_ACCESS.md).

The new screenshot referred to a second exam using a different course from
the first reviewed exam. Live inspection found an active exam, one
active enrolled student, matching teacher/course ownership, and an unpublished
linked course. No other teacher exams or published topic exams shared it.

A bounded transaction verified the exact exam, course and teacher identifiers,
locked the reviewed rows and published only that linked course. The database
returned `courses_published = 1`. A separate post-commit query confirmed:

| Condition | Verified result |
| --- | --- |
| Course published | true |
| Exam active | true |
| Active enrolled students | 1 |
| Other teacher exams sharing the course | 0 |

The original publication refusal is therefore resolved in the live database.
No exam questions, answers, submissions, enrollment or security rules were
changed. There was no application-code change or new schema migration.
The public API health check returned HTTP 200 with database readiness `ok`.
The catalog also returned HTTP 200, exposing two published courses while
omitting management-only fields.

The existing start was **21 October 2026, 12:41 PM Pakistan time** (07:41 UTC),
with a one-minute duration. Independent verification at **12:57:32 PM Pakistan
time** found the exam window had ended at **12:42 PM**. Taking the exam again
requires the owning teacher to choose a new start time; no replacement schedule
was inferred from a request to fix course publication.

Verification of the live data condition does not constitute a signed-in student
start/submission test, particularly after the scheduled window has ended.
