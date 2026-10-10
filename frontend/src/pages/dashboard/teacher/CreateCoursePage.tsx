import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import api from '../../../services/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../../store/authStore';
import { parseCourseCapacity } from '../../../utils/courseCapacity';

const CreateCoursePage = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const coursesPath = user?.role === 'admin'
    ? '/dashboard/admin/courses'
    : '/dashboard/teacher/courses';
  const [loading, setLoading] = useState(false);
  const [assignmentOptions, setAssignmentOptions] = useState<{
    organizations: Array<{ id: string; name: string }>;
    teachers: Array<{ id: string; name: string; email: string; organizationIds: string[] }>;
  }>({ organizations: [], teachers: [] });
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [showSuggestedCategories, setShowSuggestedCategories] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: '',
    difficulty: 'Beginner',
    maxStudents: '',
  });

  const categories = [
    'Web Development',
    'Mobile Development',
    'Data Science',
    'Machine Learning',
    'DevOps',
    'Cybersecurity',
    'Database',
    'Cloud Computing',
    'Programming Languages',
    'Software Engineering',
    'Other',
  ];

  const loadAssignmentOptions = async () => {
    setOptionsError(null);
    try {
      const { data } = await api.get('/admin/course-options');
      setAssignmentOptions(data.data);
    } catch (error: any) {
      setOptionsError(error.response?.data?.error?.message || 'Could not load eligible teachers and institutions.');
    }
  };

  useEffect(() => { if (user?.role === 'admin') void loadAssignmentOptions(); }, [user?.role]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.title.trim()) {
      toast.error('Please enter a course title');
      return;
    }
    if (user?.role === 'admin' && (!organizationId || !teacherId)) {
      toast.error('Select an institution and registered teacher.');
      return;
    }

    let maxStudentsValue: number | null;
    try {
      maxStudentsValue = parseCourseCapacity(formData.maxStudents);
    } catch (error) {
      toast.error((error as Error).message);
      return;
    }

    setLoading(true);
    try {
      await api.post(user?.role === 'admin' ? '/admin/courses' : '/courses', {
        ...formData,
        category: formData.category.trim() || 'Other',
        description: formData.description || `Learn ${formData.title}`,
        maxStudents: maxStudentsValue,
        ...(user?.role === 'admin' ? { organizationId, teacherId } : {}),
      });
      toast.success('Course created successfully!');
      navigate(coursesPath);
    } catch (error: any) {
      console.error('Create course error:', error);
      const errorData = error.response?.data;
      const status = error.response?.status;
      const message = errorData?.message || errorData?.error?.message || errorData?.error || 'Failed to create course';
      
      console.error('Course creation failed:', { status, errorData });
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate(coursesPath)}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeftIcon className="h-4 w-4 mr-2" />
          Back to Courses
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Create New Course</h1>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
        {user?.role === 'admin' && <div className="space-y-4 rounded-lg border border-primary-100 bg-primary-50/50 p-4">
          <p className="text-sm font-medium text-gray-800">Assign this course to a teacher</p>
          {optionsError && <div role="alert" className="text-sm text-red-700">{optionsError} <button type="button" onClick={() => void loadAssignmentOptions()} className="underline">Retry</button></div>}
          <label className="block text-sm">Institution<select value={organizationId} onChange={event => { setOrganizationId(event.target.value); setTeacherId(''); }} className="mt-1 w-full rounded-lg border border-gray-300 p-2"><option value="">Select institution</option>{assignmentOptions.organizations.map(organization => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
          <label className="block text-sm">Registered teacher<select value={teacherId} onChange={event => setTeacherId(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2"><option value="">Select teacher</option>{assignmentOptions.teachers.filter(teacher => teacher.organizationIds.includes(organizationId)).map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name} ({teacher.email})</option>)}</select></label>
          {organizationId && !assignmentOptions.teachers.some(teacher => teacher.organizationIds.includes(organizationId)) && <p className="text-sm text-amber-700">No active registered teachers belong to this institution.</p>}
        </div>}
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Course Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            placeholder="Enter your course title"
            required
            autoFocus
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            placeholder="Brief description of the course (optional)"
          />
        </div>

        {/* Category & Difficulty */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Category
            </label>
            <input
              type="text"
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Enter your own category (optional)"
            />
            <button
              type="button"
              onClick={() => setShowSuggestedCategories((show) => !show)}
              aria-expanded={showSuggestedCategories}
              className="mt-2 text-sm text-indigo-600 hover:text-indigo-800"
            >
              {showSuggestedCategories ? 'Hide category suggestions' : 'Show category suggestions'}
            </button>
            {showSuggestedCategories && (
              <div className="mt-2 flex flex-wrap gap-2" aria-label="Suggested categories">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      setFormData((current) => ({ ...current, category: cat }));
                      setShowSuggestedCategories(false);
                    }}
                    className="rounded-full border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:border-indigo-500 hover:text-indigo-700"
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Difficulty
            </label>
            <select
              value={formData.difficulty}
              onChange={(e) => setFormData({ ...formData, difficulty: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
            </select>
          </div>
        </div>

        {/* Max Students */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Max Students <span className="text-gray-400 font-normal">(optional — blank = unlimited)</span>
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={formData.maxStudents}
            onChange={(e) => setFormData({ ...formData, maxStudents: e.target.value })}
            placeholder="e.g. 50"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={() => navigate(coursesPath)}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !formData.title.trim()}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {loading ? (
              <>
                <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                Creating...
              </>
            ) : (
              'Create Course'
            )}
          </button>
        </div>
      </form>

      {/* Help text */}
      <p className="text-sm text-gray-500 mt-4 text-center">
        After creating a course, you can add topics and questions from the Topics section.
      </p>
    </div>
  );
};

export default CreateCoursePage;
