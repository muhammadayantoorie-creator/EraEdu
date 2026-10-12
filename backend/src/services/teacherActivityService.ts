import { supabase } from '../config/supabase';

export interface TeacherActivity {
  id: string;
  type: 'enrollment' | 'submission' | 'topic';
  text: string;
  occurredAt: string;
  href: string;
}

const PAGE_SIZE = 500;
const SOURCE_LIMIT = 10;
const FEED_LIMIT = 5;

async function allRows(table: string, columns: string, filter: (query: any) => any): Promise<any[]> {
  const rows: any[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await filter(supabase.from(table).select(columns))
      .order('id', { ascending: true }).range(start, start + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to load ${table}: ${error.message}`);
    if (!Array.isArray(data)) throw new Error(`Failed to load ${table}: no rows returned`);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

async function latestRows(table: string, columns: string, timestamp: string, filter: (query: any) => any): Promise<any[]> {
  const { data, error } = await filter(supabase.from(table).select(columns))
    .order(timestamp, { ascending: false, nullsFirst: false }).limit(SOURCE_LIMIT);
  if (error) throw new Error(`Failed to load ${table}: ${error.message}`);
  if (!Array.isArray(data)) throw new Error(`Failed to load ${table}: no rows returned`);
  return data;
}

const chunks = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) => ids.slice(index * 100, index * 100 + 100));

export const teacherActivityService = {
  async getRecent(teacherId: string): Promise<TeacherActivity[]> {
    // created_by and teacher_id represent the current assigned course/exam
    // manager, including the reassignment policy in migration 024.
    const [courses, teacherExams] = await Promise.all([
      allRows('courses', 'id, title', query => query.eq('created_by', teacherId)),
      allRows('teacher_quizzes', 'id, title, course_id', query => query.eq('teacher_id', teacherId)),
    ]);
    const courseIds = courses.map(course => course.id);
    const courseMap = new Map(courses.map(course => [course.id, course.title]));
    // A stale teacher_id must not expose a course now assigned elsewhere.
    const authorizedExams = teacherExams.filter(exam => !exam.course_id || courseMap.has(exam.course_id));
    const examIds = authorizedExams.map(exam => exam.id);
    const examMap = new Map(authorizedExams.map(exam => [exam.id, exam.title]));

    const [topicsByChunk, enrollmentsByChunk, submissionsByChunk] = await Promise.all([
      Promise.all(chunks(courseIds).map(ids => allRows('topics', 'id, title, course_id, created_at', query => query.in('course_id', ids)))),
      Promise.all(chunks(courseIds).map(ids => latestRows('enrollments', 'id, user_id, course_id, enrolled_at', 'enrolled_at', query => query.in('course_id', ids)))),
      Promise.all(chunks(examIds).map(ids => latestRows('quiz_attempts', 'id, user_id, quiz_id, topic_id, completed_at', 'completed_at',
        query => query.in('quiz_id', ids).eq('status', 'completed').is('topic_id', null)))),
    ]);
    const topics = topicsByChunk.flat();
    const topicIds = topics.map(topic => topic.id);
    const topicMap = new Map(topics.map(topic => [topic.id, topic]));
    const topicSubmissionsByChunk = await Promise.all(chunks(topicIds).map(ids => latestRows('quiz_attempts', 'id, user_id, quiz_id, topic_id, completed_at', 'completed_at',
      query => query.in('topic_id', ids).eq('status', 'completed'))));
    const enrollments = enrollmentsByChunk.flat();
    const submissions = [...submissionsByChunk.flat(), ...topicSubmissionsByChunk.flat()];

    const studentIds = [...new Set([...enrollments, ...submissions].map(row => row.user_id).filter(Boolean))];
    const quizIds = [...new Set(submissions.filter(row => row.topic_id).map(row => row.quiz_id).filter(Boolean))];
    const [usersByChunk, topicExamsByChunk] = await Promise.all([
      Promise.all(chunks(studentIds).map(ids => allRows('users', 'id, name', query => query.in('id', ids)))),
      Promise.all(chunks(quizIds).map(ids => allRows('quizzes', 'id, title, topic_id', query => query.in('id', ids)))),
    ]);
    const studentMap = new Map(usersByChunk.flat().map(user => [user.id, user.name]));
    const topicExamMap = new Map(topicExamsByChunk.flat().map(exam => [exam.id, exam]));
    const studentName = (id: string) => studentMap.get(id) || 'Former student';
    const events = new Map<string, TeacherActivity>();
    const add = (event: TeacherActivity) => {
      if (event.occurredAt && Number.isFinite(Date.parse(event.occurredAt))) events.set(event.id, event);
    };

    for (const enrollment of enrollments) {
      const courseTitle = courseMap.get(enrollment.course_id);
      if (courseTitle) add({ id: `enrollment:${enrollment.id}`, type: 'enrollment',
        text: `${studentName(enrollment.user_id)} enrolled in ${courseTitle}`,
        occurredAt: enrollment.enrolled_at, href: `/courses/${enrollment.course_id}` });
    }
    for (const attempt of submissions) {
      const isTopicExam = !!attempt.topic_id;
      const topic = isTopicExam ? topicMap.get(attempt.topic_id) : null;
      const topicExam = isTopicExam ? topicExamMap.get(attempt.quiz_id) : null;
      const title = isTopicExam
        ? (topicExam?.topic_id === attempt.topic_id ? topicExam.title : null) || topic?.title
        : examMap.get(attempt.quiz_id);
      if (title) add({ id: `submission:${attempt.id}`, type: 'submission',
        text: `${studentName(attempt.user_id)} submitted ${title}`,
        occurredAt: attempt.completed_at,
        href: isTopicExam ? `/courses/${topic.course_id}/topics/${topic.id}` : `/quiz/teacher-results/${attempt.id}` });
    }
    for (const topic of topics) {
      if (courseMap.has(topic.course_id)) add({ id: `topic:${topic.id}`, type: 'topic',
        text: `Topic added: ${topic.title} in ${courseMap.get(topic.course_id)}`,
        occurredAt: topic.created_at, href: `/courses/${topic.course_id}/topics/${topic.id}` });
    }
    return [...events.values()].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.id.localeCompare(b.id)).slice(0, FEED_LIMIT);
  },
};
