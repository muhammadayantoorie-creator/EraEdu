import { useEffect, useState } from 'react';
import { DataTable, QuizOpeningConfirmationModal } from '../../../components/shared';
import api from '../../../services/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../../store/authStore';
import {
  PlusIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  TrashIcon,
  ClipboardDocumentIcon,
  CheckCircleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';

interface Quiz {
  _id: string;
  title: string;
  description: string;
  courseId?: string;
  courseTitle?: string;
  questions: QuestionItem[];
  timeLimit?: number;
  scheduledStart?: string;
  cameraMonitoring?: boolean;
  createdAt: string;
  accessCode: string;
  className?: string;
  section?: string;
  totalMarks?: number;
  passingPercentage?: number;
  attemptsAllowed?: number;
  scheduledEnd?: string;
  shuffleQuestions?: boolean;
  randomOptions?: boolean;
  negativeMarking?: boolean;
  aiGenerated?: boolean;
  status?: string;
  violationLimit?: number;
}

interface TeacherCourse {
  _id: string;
  title: string;
}

interface BankQuestion {
  _id: string;
  text: string;
  questionType: string;
  topicId: string | null;
  topicName: string;
  courseId: string | null;
  createdBy: string;
  timeLimit: number;
}

interface QuestionItem {
  text: string;
  options: string[];
  correctAnswer: number;
  difficulty: string;
  explanation?: string;
  timeLimit: number; // in seconds
  answerText?: string;
}

const emptySchedule = {
  scheduledDate: '',
  scheduledHour: '12',
  scheduledMinute: '00',
  scheduledPeriod: 'AM' as 'AM' | 'PM',
};

const scheduleToFields = (value?: string) => {
  if (!value) return emptySchedule;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return emptySchedule;
  const hours = date.getHours();
  return {
    scheduledDate: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    scheduledHour: String(hours % 12 || 12),
    scheduledMinute: String(date.getMinutes()).padStart(2, '0'),
    scheduledPeriod: hours >= 12 ? 'PM' as const : 'AM' as const,
  };
};

const scheduleToIso = (date: string, hour: string, minute: string, period: 'AM' | 'PM') => {
  if (!date) return null;
  const twelveHour = Number(hour);
  const hour24 = (twelveHour % 12) + (period === 'PM' ? 12 : 0);
  return new Date(`${date}T${String(hour24).padStart(2, '0')}:${minute}:00`).toISOString();
};

const TeacherQuizzes = () => {
  const user = useAuthStore((state) => state.user);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [teacherCourses, setTeacherCourses] = useState<TeacherCourse[]>([]);
  const [bankQuestions, setBankQuestions] = useState<BankQuestion[]>([]);
  const [bankError, setBankError] = useState<string | null>(null);
  const [bankLoading, setBankLoading] = useState(false);
  const [selectedBankIds, setSelectedBankIds] = useState<string[]>([]);
  const [bankTopicId, setBankTopicId] = useState('all');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null);
  const [quizPendingOpen, setQuizPendingOpen] = useState<Quiz | null>(null);
  const [formMode, setFormMode] = useState<'quiz' | 'question'>('quiz');
  const [creatingCourse, setCreatingCourse] = useState(false);
  const [newCourseTitle, setNewCourseTitle] = useState('');
  const [creatingCourseLoading, setCreatingCourseLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    courseId: '',
    timeLimit: 0,
    ...emptySchedule,
    cameraMonitoring: true,
    violationLimit: 3,
    questionTitle: '',
    questionScheduledStart: '',
    questions: [
      { text: '', options: ['', '', '', ''], correctAnswer: 0, difficulty: 'Medium', explanation: '', timeLimit: 60, answerText: '' }
    ] as QuestionItem[],
  });

  useEffect(() => {
    fetchQuizzes();
    fetchTeacherCourses();
    fetchBankQuestions();
  }, []);

  // Calculate total time whenever questions change
  useEffect(() => {
    const totalSeconds = formData.questions.reduce((sum, q) => sum + (q.timeLimit || 0), 0) + bankQuestions.filter((question) => selectedBankIds.includes(question._id)).reduce((sum, question) => sum + (question.timeLimit || 60), 0);
    const totalMinutes = Math.ceil(totalSeconds / 60);
    if (formData.timeLimit !== totalMinutes) {
      setFormData(prev => ({ ...prev, timeLimit: totalMinutes }));
    }
  }, [formData.questions, selectedBankIds, bankQuestions]);

  const fetchBankQuestions = async () => {
    setBankLoading(true);
    try {
      const response = await api.get('/courses/teacher/questions');
      setBankQuestions(response.data.data || []);
      setBankError(null);
    } catch {
      setBankError('Question bank could not be loaded. Please try again.');
    } finally {
      setBankLoading(false);
    }
  };

  const toggleBankQuestion = (id: string) => {
    const adding = !selectedBankIds.includes(id);
    const next = adding ? [...selectedBankIds, id] : selectedBankIds.filter((selected) => selected !== id);
    setSelectedBankIds(next);
    if (adding && formData.questions.length === 1 && !formData.questions[0].text.trim() && formData.questions[0].options.every((option) => !option.trim())) {
      setFormData((current) => ({ ...current, questions: [] }));
    } else if (!next.length && !formData.questions.length) {
      setFormData((current) => ({ ...current, questions: [{ text: '', options: ['', '', '', ''], correctAnswer: 0, difficulty: 'Medium', explanation: '', timeLimit: 60, answerText: '' }] }));
    }
  };

  const fetchQuizzes = async () => {
    setLoading(true);
    try {
      const response = await api.get('/quizzes/teacher/my-quizzes');
      setQuizzes(response.data.data || []);
    } catch (error: any) {
      console.error('Error fetching exams:', error);
      const message = error.response?.data?.message || 'Failed to load exams';
      toast.error(message);
      setQuizzes([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchTeacherCourses = async () => {
    try {
      const response = await api.get('/courses/teacher/my-courses');
      setTeacherCourses(response.data.data || []);
    } catch (error) {
      console.error('Error fetching teacher courses:', error);
      setTeacherCourses([]);
    }
  };

  const createCourseInline = async () => {
    const title = newCourseTitle.trim();
    if (!title) {
      toast.error('Enter a course name first');
      return;
    }
    setCreatingCourseLoading(true);
    try {
      const response = await api.post('/courses', {
        title,
        description: `Learn ${title}`,
        category: 'Other',
        difficulty: 'Beginner',
        maxStudents: null,
      });
      const course = response.data.data;
      const entry = { _id: course._id || course.id, title: course.title };
      setTeacherCourses((previous) => [...previous, entry]);
      setFormData((previous) => ({ ...previous, courseId: entry._id }));
      setNewCourseTitle('');
      setCreatingCourse(false);
      toast.success('Course created and selected');
    } catch (error: any) {
      toast.error(error.response?.data?.message || error.response?.data?.error?.message || 'Unable to create the course');
    } finally {
      setCreatingCourseLoading(false);
    }
  };

  const handleOpenModal = (quiz?: Quiz) => {
    setSelectedBankIds([]);
    setBankTopicId('all');
    fetchBankQuestions();
    if (quiz) {
      setFormMode('quiz');
      setEditingQuiz(quiz);
      setFormData({
        title: quiz.title,
        description: quiz.description,
        courseId: quiz.courseId || '',
        timeLimit: quiz.timeLimit || 0,
        ...scheduleToFields(quiz.scheduledStart),
        cameraMonitoring: quiz.cameraMonitoring !== false,
        violationLimit: quiz.violationLimit ?? 3,
        questionTitle: '',
        questionScheduledStart: '',
        questions: quiz.questions.length > 0 ? quiz.questions.map(q => ({
          ...q,
          timeLimit: q.timeLimit || 60,
          answerText: q.answerText || ''
        })) : [
          { text: '', options: ['', '', '', ''], correctAnswer: 0, difficulty: 'Medium', explanation: '', timeLimit: 60, answerText: '' }
        ],
      });
    } else {
      setEditingQuiz(null);
      setFormMode('quiz');
      setFormData({
        title: '',
        description: '',
        courseId: '',
        timeLimit: 0,
        ...emptySchedule,
        cameraMonitoring: true,
        violationLimit: 3,
        questionTitle: '',
        questionScheduledStart: '',
        questions: [
          { text: '', options: ['', '', '', ''], correctAnswer: 0, difficulty: 'Medium', explanation: '', timeLimit: 60, answerText: '' }
        ],
      });
    }
    setModalOpen(true);
  };

  const requestQuizOpen = (quiz: Quiz) => setQuizPendingOpen(quiz);

  const editSelectedQuiz = () => {
    if (!quizPendingOpen) return;
    const quiz = quizPendingOpen;
    setQuizPendingOpen(null);
    handleOpenModal(quiz);
  };

  const openSelectedQuiz = () => {
    if (!quizPendingOpen) return;
    const quiz = quizPendingOpen;
    setQuizPendingOpen(null);
    handleOpenModal(quiz);
  };

  const addQuestion = () => {
    setFormData({
      ...formData,
      questions: [
        ...formData.questions,
        { text: '', options: ['', '', '', ''], correctAnswer: 0, difficulty: 'Medium', explanation: '', timeLimit: 60, answerText: '' }
      ],
    });
  };

  const removeQuestion = (index: number) => {
    if (formData.questions.length <= 1 && !selectedBankIds.length) {
      toast.error('Exam must have at least one question');
      return;
    }
    const newQuestions = [...formData.questions];
    newQuestions.splice(index, 1);
    setFormData({ ...formData, questions: newQuestions });
  };

  const updateQuestion = (index: number, field: keyof QuestionItem, value: any) => {
    const newQuestions = [...formData.questions];
    (newQuestions[index] as any)[field] = value;
    setFormData({ ...formData, questions: newQuestions });
  };

  const updateOption = (qIndex: number, oIndex: number, value: string) => {
    const newQuestions = [...formData.questions];
    newQuestions[qIndex].options[oIndex] = value;
    setFormData({ ...formData, questions: newQuestions });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formMode === 'question') {
      if (!formData.courseId) {
        toast.error('Please select a course');
        return;
      }
      if (!formData.questionTitle.trim()) {
        toast.error('Title is required');
        return;
      }
      for (const q of formData.questions) {
        if (!q.text.trim()) {
          toast.error('All questions must have text');
          return;
        }
      }

      try {
        const questionScheduledStart = formData.questionScheduledStart && formData.questionScheduledStart.trim() !== ''
          ? new Date(formData.questionScheduledStart).toISOString()
          : null;

        const totalSeconds = formData.questions.reduce((sum, q) => sum + (q.timeLimit || 60), 0);

        await api.post('/quizzes', {
          title: formData.questionTitle,
          description: formData.description || 'Short-answer assessment',
          courseId: formData.courseId,
          scheduledStart: questionScheduledStart,
          timeLimit: Math.max(1, Math.ceil(totalSeconds / 60)),
          cameraMonitoring: formData.cameraMonitoring,
          violationLimit: formData.violationLimit,
          questions: formData.questions.map((q) => ({
            text: q.text,
            options: [],
            correctAnswer: -1,
            questionType: 'shortAnswer',
            difficulty: q.difficulty,
            explanation: q.explanation,
            timeLimit: q.timeLimit || 60,
          })),
        });

        toast.success(formData.questions.length > 1
          ? `${formData.questions.length} questions created successfully`
          : 'Question created successfully');
        setModalOpen(false);
        fetchQuizzes();
      } catch (error: any) {
        console.error('Save Question Error:', error);
        const message = error.response?.data?.error?.message || error.response?.data?.message || error.message || 'Failed to save question';
        toast.error(message);
      }
      return;
    }

    if (!formData.questions.length && !selectedBankIds.length) {
      toast.error('Add a question or select one from the bank');
      return;
    }
    for (const q of formData.questions) {
      if (!q.text.trim()) {
        toast.error('All questions must have text');
        return;
      }
      if (q.options.some((opt) => !opt.trim())) {
        toast.error('All options must be filled');
        return;
      }
    }

    if (!formData.courseId) {
      toast.error('Please select a course');
      return;
    }

    // Convert the teacher's explicit 12-hour local time to the ISO value the API stores.
    const submitData = {
      ...formData,
      timeLimit: Math.max(1, Math.ceil((formData.questions.reduce((sum, question) => sum + (question.timeLimit || 60), 0) + bankQuestions.filter((question) => selectedBankIds.includes(question._id)).reduce((sum, question) => sum + (question.timeLimit || 60), 0)) / 60)),
      scheduledStart: scheduleToIso(formData.scheduledDate, formData.scheduledHour, formData.scheduledMinute, formData.scheduledPeriod),
      cameraMonitoring: formData.cameraMonitoring,
      bankQuestionIds: editingQuiz ? undefined : selectedBankIds,
    };

    try {
      if (editingQuiz) {
        await api.put(`/quizzes/${editingQuiz._id}`, submitData);
        toast.success('Exam updated successfully');
      } else {
        await api.post('/quizzes', submitData);
        toast.success('Exam created successfully');
      }
      setModalOpen(false);
      fetchQuizzes();
    } catch (error: any) {
      console.error('Save Exam Error:', error);
      const message = error.response?.data?.error?.message || error.response?.data?.message || error.message || 'Failed to save exam';
      toast.error(message);
    }
  };

  const handleDelete = async (quiz: Quiz) => {
    if (!confirm(`Delete exam "${quiz.title}"?`)) return;

    try {
      await api.delete(`/quizzes/${quiz._id}`);
      toast.success('Exam deleted');
      setQuizzes(quizzes.filter((q) => q._id !== quiz._id));
    } catch (error) {
      toast.error('Failed to delete exam');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Code copied to clipboard!');
  };

  const filteredQuizzes = quizzes.filter((quiz) =>
    quiz.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns = [
    {
      key: 'title' as keyof Quiz,
      header: 'Exam',
      render: (quiz: Quiz) => (
        <div>
          <p className="font-medium text-gray-900">{quiz.title}</p>
          <p className="text-sm text-gray-500 line-clamp-1">{quiz.description}</p>
        </div>
      ),
    },
    {
      key: 'accessCode' as keyof Quiz,
      header: 'Access Code',
      render: (quiz: Quiz) => (
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-lg text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg">
            {quiz.accessCode}
          </span>
          <button
            onClick={(event) => { event.stopPropagation(); copyToClipboard(quiz.accessCode); }}
            className="p-1 text-gray-400 hover:text-indigo-600 transition-colors"
            title="Copy code"
          >
            <ClipboardDocumentIcon className="h-4 w-4" />
          </button>
        </div>
      ),
    },
    {
      key: 'courseTitle' as keyof Quiz,
      header: 'Course',
      render: (quiz: Quiz) => (
        <span className="text-gray-700">{quiz.courseTitle || 'General'}</span>
      ),
    },
    {
      key: 'questions' as keyof Quiz,
      header: 'Questions',
      render: (quiz: Quiz) => (
        <span className="text-gray-600">{quiz.questions?.length || 0} questions</span>
      ),
    },
    {
      key: 'timeLimit' as keyof Quiz,
      header: 'Time',
      render: (quiz: Quiz) => (
        <span className="text-gray-600">{quiz.timeLimit || 30} min</span>
      ),
    },
    {
      key: 'scheduledStart' as keyof Quiz,
      header: 'Scheduled',
      render: (quiz: Quiz) => (
        quiz.scheduledStart ? (
          <span className="text-indigo-600 text-sm">
            {new Date(quiz.scheduledStart).toLocaleString()}
          </span>
        ) : (
          <span className="text-gray-400 text-sm">Anytime</span>
        )
      ),
    },
    {
      key: '_id' as keyof Quiz,
      header: 'Actions',
      render: (quiz: Quiz) => (
        <div className="flex items-center gap-2">
          <button
            onClick={(event) => { event.stopPropagation(); requestQuizOpen(quiz); }}
            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            title="Edit"
          >
            <PencilIcon className="h-5 w-5" />
          </button>
          <button
            onClick={(event) => { event.stopPropagation(); handleDelete(quiz); }}
            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Delete"
          >
            <TrashIcon className="h-5 w-5" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Exams</h1>
          <p className="text-sm text-gray-500 mt-1">Create exams and share them with students via code</p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
        >
          <PlusIcon className="h-5 w-5" />
          Create Exam
        </button>
      </header>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="relative">
          <MagnifyingGlassIcon className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search exams..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <DataTable
          columns={columns}
          data={filteredQuizzes}
          isLoading={loading}
          emptyMessage="No exams found. Click 'Create Exam' to create your first exam!"
          onRowClick={requestQuizOpen}
        />
      </div>

      <QuizOpeningConfirmationModal
        isOpen={Boolean(quizPendingOpen)}
        quiz={quizPendingOpen ? {
          title: quizPendingOpen.title,
          course: quizPendingOpen.courseTitle,
          className: quizPendingOpen.className,
          section: quizPendingOpen.section,
          questionCount: quizPendingOpen.questions?.length || 0,
          totalMarks: quizPendingOpen.totalMarks,
          timeLimit: quizPendingOpen.timeLimit,
          passingPercentage: quizPendingOpen.passingPercentage,
          attemptsAllowed: quizPendingOpen.attemptsAllowed,
          startTime: quizPendingOpen.scheduledStart,
          endTime: quizPendingOpen.scheduledEnd,
          shuffleQuestions: quizPendingOpen.shuffleQuestions,
          randomOptions: quizPendingOpen.randomOptions,
          negativeMarking: quizPendingOpen.negativeMarking,
          aiGenerated: quizPendingOpen.aiGenerated,
          status: quizPendingOpen.status || (quizPendingOpen.scheduledStart ? 'Scheduled' : 'Draft'),
          violationLimit: quizPendingOpen.violationLimit ?? 3,
          questions: quizPendingOpen.questions,
        } : null}
        onClose={() => setQuizPendingOpen(null)}
        onEdit={editSelectedQuiz}
        onOpen={openSelectedQuiz}
      />

      {/* Create/Edit Quiz Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-xl p-6 max-w-3xl w-full mx-4 my-8 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {editingQuiz ? 'Edit Exam' : 'Create'}
            </h3>

            {!editingQuiz && (
              <div className="mb-4 inline-flex rounded-lg border border-gray-300 p-1">
                <button
                  type="button"
                  onClick={() => setFormMode('quiz')}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    formMode === 'quiz' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Exam
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFormMode('question');
                    setFormData((prev) => ({
                      ...prev,
                      title: '',
                      description: '',
                      ...emptySchedule,
                      questionTitle: '',
                      questionScheduledStart: '',
                      questions: [prev.questions[0] || { text: '', options: ['', '', '', ''], correctAnswer: 0, difficulty: 'Medium', explanation: '', timeLimit: 60, answerText: '' }],
                    }));
                  }}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    formMode === 'question' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Question
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {formMode === 'quiz' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Exam Title</label>
                      <input
                        type="text"
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        placeholder="Enter exam title"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Course</label>
                      <select
                        value={formData.courseId}
                        onChange={(e) => {
                          setFormData({ ...formData, courseId: e.target.value });
                          setSelectedBankIds([]);
                          setBankTopicId('all');
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        required
                      >
                        <option value="">Select a course</option>
                       {teacherCourses.map((course) => (
                         <option key={course._id} value={course._id}>
                           {course.title}
                         </option>
                       ))}
                      </select>
                      <button type="button" onClick={() => setCreatingCourse((value) => !value)} className="mt-2 text-xs font-semibold text-primary-700 hover:text-primary-800">
                        {creatingCourse ? 'Cancel new course' : '+ Create a course manually'}
                      </button>
                      {creatingCourse && <div className="mt-2 flex gap-2"><input value={newCourseTitle} onChange={(event) => setNewCourseTitle(event.target.value)} placeholder="New course name" className="min-w-0 flex-1 rounded-lg border border-primary-200 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500" /><button type="button" onClick={createCourseInline} disabled={creatingCourseLoading} className="rounded-lg bg-primary-700 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-800 disabled:opacity-60">{creatingCourseLoading ? 'Creating…' : 'Create'}</button></div>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Total Time (minutes)</label>
                      <div className="w-full px-3 py-2 border border-gray-200 bg-gray-50 text-gray-500 rounded-lg">
                        {formData.timeLimit} minutes (calculated from questions)
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Scheduled Start Time (Optional)
                    </label>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.5fr_0.7fr_0.7fr_0.7fr]">
                      <input
                        type="date"
                        value={formData.scheduledDate}
                        onChange={(e) => setFormData({ ...formData, scheduledDate: e.target.value })}
                        aria-label="Scheduled start date"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      />
                      <select value={formData.scheduledHour} onChange={(e) => setFormData({ ...formData, scheduledHour: e.target.value })} aria-label="Scheduled start hour" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                        {Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => <option key={hour} value={hour}>{hour}</option>)}
                      </select>
                      <select value={formData.scheduledMinute} onChange={(e) => setFormData({ ...formData, scheduledMinute: e.target.value })} aria-label="Scheduled start minute" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                        {Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0')).map((minute) => <option key={minute} value={minute}>:{minute}</option>)}
                      </select>
                      <select value={formData.scheduledPeriod} onChange={(e) => setFormData({ ...formData, scheduledPeriod: e.target.value as 'AM' | 'PM' })} aria-label="Scheduled start AM or PM" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                      </select>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Choose a date to schedule the exam. Time uses 1–12 with AM/PM.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="Brief description of the exam"
                    />
                  </div>

                  <div className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg bg-gray-50">
                    <input
                      id="cameraMonitoring"
                      type="checkbox"
                      checked={formData.cameraMonitoring}
                      onChange={(e) => setFormData({ ...formData, cameraMonitoring: e.target.checked })}
                      className="mt-1 h-4 w-4 text-indigo-600 focus:ring-indigo-500 rounded"
                    />
                    <label htmlFor="cameraMonitoring" className="text-sm text-gray-700 cursor-pointer">
                      <span className="font-medium">Require camera monitoring</span>
                      <p className="text-xs text-gray-500 mt-0.5">
                        When ON, students must enable their webcam to take this exam. When OFF, no camera is required.
                      </p>
                    </label>
                  </div>
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                    <label htmlFor="violationLimit" className="block text-sm font-semibold text-red-900">Automatic submission violation limit</label>
                    <div className="mt-2 flex items-center gap-3">
                      <input
                        id="violationLimit"
                        type="number"
                        min="1"
                        max="100"
                        step="1"
                        value={formData.violationLimit}
                        onChange={(e) => setFormData({ ...formData, violationLimit: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })}
                        className="w-28 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900 focus:border-red-500 focus:ring-2 focus:ring-red-500"
                        required
                      />
                      <span className="text-sm text-red-800">violations</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-red-700">The student's exam is automatically submitted immediately when this number of violations is reached.</p>
                  </div>
                </>
              )}

              {formMode === 'question' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Course</label>
                    <select
                      value={formData.courseId}
                      onChange={(e) => setFormData({ ...formData, courseId: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      required
                    >
                      <option value="">Select a course</option>
                      {teacherCourses.map((course) => (
                        <option key={course._id} value={course._id}>
                          {course.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Question Title</label>
                    <input
                      type="text"
                      value={formData.questionTitle}
                      onChange={(e) => setFormData({ ...formData, questionTitle: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="Enter question title"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Scheduled Start Time (Optional)</label>
                    <input
                      type="datetime-local"
                      value={formData.questionScheduledStart}
                      onChange={(e) => setFormData({ ...formData, questionScheduledStart: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      If set, students cannot start the question before this time
                    </p>
                  </div>
                  <div className="md:col-span-3 flex items-start gap-3 p-3 border border-gray-200 rounded-lg bg-gray-50">
                    <input
                      id="cameraMonitoringQ"
                      type="checkbox"
                      checked={formData.cameraMonitoring}
                      onChange={(e) => setFormData({ ...formData, cameraMonitoring: e.target.checked })}
                      className="mt-1 h-4 w-4 text-indigo-600 focus:ring-indigo-500 rounded"
                    />
                    <label htmlFor="cameraMonitoringQ" className="text-sm text-gray-700 cursor-pointer">
                      <span className="font-medium">Require camera monitoring</span>
                      <p className="text-xs text-gray-500 mt-0.5">
                        When ON, students must enable their webcam. When OFF, no camera is required.
                      </p>
                    </label>
                  </div>
                </div>
              )}

              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-md font-semibold text-gray-900">Questions</h4>
                  <button
                    type="button"
                    onClick={addQuestion}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition-colors"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add Question
                  </button>
                </div>

                {formMode === 'quiz' && !editingQuiz && (
                  <div className="mb-5 rounded-lg border border-gray-200 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h5 className="text-sm font-semibold text-gray-900">Add from question bank</h5>
                      <button type="button" onClick={fetchBankQuestions} className="text-xs font-medium text-indigo-700 hover:text-indigo-900">Refresh bank</button>
                    </div>
                    {!formData.courseId ? (
                      <p className="text-sm text-gray-500">Select a course to see its bank questions.</p>
                    ) : bankLoading ? (
                      <p className="text-sm text-gray-500">Loading question bank…</p>
                    ) : bankError ? (
                      <p role="alert" className="text-sm text-red-700">{bankError}</p>
                    ) : (
                      <>
                        <label htmlFor="bank-topic" className="block text-xs font-medium text-gray-600">Topic</label>
                        <select id="bank-topic" value={bankTopicId} onChange={(event) => setBankTopicId(event.target.value)} className="mt-1 mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                          <option value="all">All topics</option>
                          {[...new Map(bankQuestions.filter((question) => question.courseId === formData.courseId && question.createdBy === user?._id && question.topicId).map((question) => [question.topicId, question.topicName])).entries()].map(([id, name]) => (
                            <option key={id} value={id || ''}>{name}</option>
                          ))}
                        </select>
                        {bankQuestions.filter((question) => question.courseId === formData.courseId && question.createdBy === user?._id && question.topicId && (bankTopicId === 'all' || question.topicId === bankTopicId)).length === 0 ? (
                          <p className="text-sm text-gray-500">No bank questions in this course/topic yet. You can still write questions below.</p>
                        ) : (
                          <div className="max-h-48 space-y-2 overflow-y-auto">
                            {bankQuestions.filter((question) => question.courseId === formData.courseId && question.createdBy === user?._id && question.topicId && (bankTopicId === 'all' || question.topicId === bankTopicId)).map((question) => (
                              <label key={question._id} className="flex items-start gap-2 rounded border border-gray-200 p-2 text-sm">
                                <input type="checkbox" checked={selectedBankIds.includes(question._id)} onChange={() => toggleBankQuestion(question._id)} disabled={!['multipleChoice', 'shortAnswer'].includes(question.questionType)} className="mt-1" />
                                <span><span className="font-medium">{question.text}</span><span className="block text-xs text-gray-500">{question.topicName} · {question.questionType === 'shortAnswer' ? 'Short answer' : question.questionType === 'multipleChoice' ? 'Multiple choice' : 'Unsupported type'} · {question.timeLimit || 60} seconds</span></span>
                              </label>
                            ))}
                          </div>
                        )}
                        {selectedBankIds.length > 0 && <p className="mt-2 text-xs text-indigo-700">{selectedBankIds.length} bank question{selectedBankIds.length === 1 ? '' : 's'} selected. A snapshot is saved when you create the exam.</p>}
                      </>
                    )}
                  </div>
                )}

                <div className="space-y-6">
                  {formData.questions.map((question, qIndex) => (
                    <div key={qIndex} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-medium text-gray-700">Question {qIndex + 1}</span>
                        <div className="flex items-center gap-3">
                          {/* Time Section */}
                          <div className="flex items-center gap-2 bg-white px-2 py-1 border border-gray-300 rounded-lg">
                            <ClockIcon className="h-4 w-4 text-gray-400" />
                            <input
                              type="number"
                              min="30"
                              max="2700"
                              step="5"
                              value={question.timeLimit}
                              onChange={(e) => updateQuestion(qIndex, 'timeLimit', parseInt(e.target.value))}
                              className="w-16 text-sm border-none focus:ring-0 p-0"
                              placeholder="60"
                            />
                            <span className="text-[10px] font-bold text-gray-400 uppercase">sec</span>
                          </div>

                          {/* Difficulty Section */}
                          <select
                            value={question.difficulty}
                            onChange={(e) => updateQuestion(qIndex, 'difficulty', e.target.value)}
                            className="text-sm px-2 py-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="Easy">Easy</option>
                            <option value="Medium">Medium</option>
                            <option value="Hard">Hard</option>
                          </select>

                          {formData.questions.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeQuestion(qIndex)}
                              className="text-red-500 hover:text-red-700"
                            >
                              <TrashIcon className="h-5 w-5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <textarea
                        value={question.text}
                        onChange={(e) => updateQuestion(qIndex, 'text', e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 mb-3"
                        placeholder="Enter question text"
                        required
                      />

                      {formMode === 'quiz' ? (
                        <div className="space-y-2 mb-3">
                          {question.options.map((option, oIndex) => (
                            <div key={oIndex} className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`correct-${qIndex}`}
                                checked={question.correctAnswer === oIndex}
                                onChange={() => updateQuestion(qIndex, 'correctAnswer', oIndex)}
                                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500"
                              />
                              <input
                                type="text"
                                value={option}
                                onChange={(e) => updateOption(qIndex, oIndex, e.target.value)}
                                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                placeholder={`Option ${oIndex + 1}`}
                                required
                              />
                              {question.correctAnswer === oIndex && (
                                <CheckCircleIcon className="h-5 w-5 text-green-500" />
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                          Students will type their own answer. You will grade their submissions manually from the Submissions page.
                        </div>
                      )}

                      <input
                        type="text"
                        value={question.explanation || ''}
                        onChange={(e) => updateQuestion(qIndex, 'explanation', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        placeholder="Explanation (optional)"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
                >
                  {editingQuiz ? 'Update Exam' : formMode === 'quiz' ? 'Create Exam' : 'Create Question'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


    </div>
  );
};

export default TeacherQuizzes;
