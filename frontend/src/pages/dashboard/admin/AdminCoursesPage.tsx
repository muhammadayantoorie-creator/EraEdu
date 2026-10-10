import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../services/api';
import toast from 'react-hot-toast';

interface Organization { id: string; name: string }
interface Teacher { id: string; name: string; email: string; organizationIds: string[] }
interface CourseRow {
  _id: string; title: string; category: string; createdBy: string | null;
  assignedTeacherName: string; assignedTeacherEmail: string; organizationId: string | null;
  enrollmentCount: number; maxStudents: number | null; topics: string[];
}

const AdminCoursesPage = () => {
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<CourseRow | null>(null);
  const [organizationId, setOrganizationId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [saving, setSaving] = useState(false);
  const requestRef = useRef(0);

  const loadCourses = async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/admin/courses', { params: { search, page, limit: 50 } });
      if (requestId !== requestRef.current) return;
      setCourses(data.data || []);
      setTotal(data.pagination?.total ?? 0);
    } catch (err: any) {
      if (requestId !== requestRef.current) return;
      setError(err.response?.data?.error?.message || 'Could not load courses.');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  };

  const loadOptions = async () => {
    setOptionsError(null);
    try {
      const { data } = await api.get('/admin/course-options');
      setOrganizations(data.data.organizations || []);
      setTeachers(data.data.teachers || []);
    } catch (err: any) {
      setOptionsError(err.response?.data?.error?.message || 'Could not load institutions and teachers.');
    }
  };

  useEffect(() => { void loadOptions(); }, []);
  useEffect(() => { void loadCourses(); }, [search, page]);
  useEffect(() => { setPage(1); }, [search]);

  const openAssignment = (course: CourseRow) => {
    setAssignment(course);
    setOrganizationId(course.organizationId || '');
    setTeacherId(course.createdBy || '');
  };

  const saveAssignment = async () => {
    if (!assignment || !organizationId || !teacherId) {
      toast.error('Select an institution and eligible teacher.');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/admin/courses/${assignment._id}/assignment`, { organizationId, teacherId });
      toast.success('Course assignment saved.');
      setAssignment(null);
      await loadCourses();
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || 'Could not assign the course.');
    } finally {
      setSaving(false);
    }
  };

  const availableTeachers = teachers.filter(teacher => teacher.organizationIds.includes(organizationId));

  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-2xl font-bold text-gray-900">Courses</h1><p className="text-sm text-gray-500">Assign course management to registered institution teachers.</p></div>
      <Link to="/dashboard/admin/courses/new" className="rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white">Create Course</Link>
    </header>
    <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search course titles" aria-label="Search courses"
      className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2" />
    {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error} <button onClick={() => void loadCourses()} className="ml-2 underline">Retry</button></div>
      : loading ? <p className="text-sm text-gray-500">Loading courses…</p>
        : courses.length === 0 ? <p className="rounded-lg border bg-white p-6 text-sm text-gray-500">{search ? 'No courses match this search.' : 'No courses have been created yet.'}</p>
          : <div className="overflow-x-auto rounded-xl border bg-white"><table className="min-w-full text-left text-sm"><thead className="bg-gray-50 text-gray-600"><tr><th className="px-4 py-3">Course</th><th className="px-4 py-3">Assigned teacher</th><th className="px-4 py-3">Students</th><th className="px-4 py-3">Topics</th><th className="px-4 py-3">Actions</th></tr></thead><tbody>{courses.map(course => <tr key={course._id} className="border-t"><td className="px-4 py-3"><p className="font-medium">{course.title}</p><p className="text-xs text-gray-500">{course.category}</p></td><td className="px-4 py-3"><p>{course.assignedTeacherName}</p><p className="text-xs text-gray-500">{course.assignedTeacherEmail}</p></td><td className="px-4 py-3">{course.enrollmentCount}{course.maxStudents != null ? ` / ${course.maxStudents}` : ' / unlimited'}</td><td className="px-4 py-3">{course.topics.length}</td><td className="px-4 py-3"><div className="flex gap-3"><Link to={`/courses/${course._id}`} className="text-primary-700 underline">View</Link><button onClick={() => openAssignment(course)} className="text-primary-700 underline">Assign</button></div></td></tr>)}</tbody></table></div>}
    <div className="flex items-center justify-between text-sm text-gray-600"><span>{total} total courses</span><div className="flex gap-2"><button disabled={page === 1 || loading} onClick={() => setPage(value => value - 1)} className="rounded border px-3 py-1 disabled:opacity-40">Previous</button><button disabled={page * 50 >= total || loading} onClick={() => setPage(value => value + 1)} className="rounded border px-3 py-1 disabled:opacity-40">Next</button></div></div>
    {assignment && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div role="dialog" aria-modal="true" aria-label="Assign course" className="w-full max-w-md space-y-4 rounded-xl bg-white p-6"><h2 className="text-lg font-semibold">Assign {assignment.title}</h2><p className="text-sm text-gray-600">Course content, enrollments, exams, and attempt history stay with this course.</p>
      {optionsError && <div role="alert" className="text-sm text-red-700">{optionsError} <button onClick={() => void loadOptions()} className="underline">Retry</button></div>}
      <label className="block text-sm">Institution<select value={organizationId} disabled={!!assignment.organizationId} onChange={event => { setOrganizationId(event.target.value); setTeacherId(''); }} className="mt-1 w-full rounded-lg border p-2"><option value="">Select institution</option>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
      <label className="block text-sm">Registered teacher<select value={teacherId} onChange={event => setTeacherId(event.target.value)} className="mt-1 w-full rounded-lg border p-2"><option value="">Select teacher</option>{availableTeachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name} ({teacher.email})</option>)}</select></label>
      {organizationId && availableTeachers.length === 0 && <p className="text-sm text-amber-700">No active registered teachers belong to this institution.</p>}
      <div className="flex justify-end gap-3"><button onClick={() => setAssignment(null)} className="px-3 py-2 text-sm">Cancel</button><button disabled={saving || !!optionsError || !organizationId || !teacherId} onClick={() => void saveAssignment()} className="rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Saving…' : 'Save assignment'}</button></div>
    </div></div>}
  </div>;
};

export default AdminCoursesPage;
