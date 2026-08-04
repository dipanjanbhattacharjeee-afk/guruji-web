import React, { useState, useMemo } from 'react';
import { Trash2, AlertTriangle, Users, BookOpen, GraduationCap, Database, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { Button } from '@/components/shared/Button';
import { Modal } from '@/components/shared/Modal';
import { Card } from '@/components/shared/Card';
import { Input } from '@/components/shared/Input';
import {
  deleteStudentData,
  deleteBatchFolders,
  deleteAcademicYearFolder,
  deleteEntireAppData,
  revokeStudentDbAccess,
  removePermission,
} from '@/services/driveService';
import toast from 'react-hot-toast';

type DeleteType = 'student' | 'batch' | 'year' | 'app';

interface ConfirmModalProps {
  type: DeleteType;
  itemName: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  loading: boolean;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({ type, itemName, onConfirm, onCancel, loading }) => {
  const [confirmText, setConfirmText] = useState('');
  const requiredText = type === 'app' ? 'DELETE EVERYTHING' : 'DELETE';

  const descriptions: Record<DeleteType, string> = {
    student: `This will permanently delete the student "${itemName}" and their submission folder from Google Drive. Their access will be revoked.`,
    batch: `This will permanently delete the batch "${itemName}" and ALL its files (question papers, submissions) from Google Drive. All students in this batch will lose access.`,
    year: `This will permanently delete the academic year "${itemName}" and ALL batches, files, and student data within it from Google Drive.`,
    app: `This will PERMANENTLY DELETE the entire GURUJI app data from your Google Drive, including ALL academic years, batches, students, files, and configurations. This action CANNOT be undone. You will be logged out after deletion.`,
  };

  return (
    <Modal open onClose={onCancel} title="Confirm Permanent Deletion">
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-800">
            <p className="font-semibold mb-1">Warning: This action cannot be undone!</p>
            <p>{descriptions[type]}</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">
            Type <span className="font-mono bg-stone-100 px-1.5 py-0.5 rounded text-red-600">{requiredText}</span> to confirm:
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
            placeholder={requiredText}
          />
        </div>

        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
            onClick={onConfirm}
            loading={loading}
            disabled={confirmText !== requiredText}
          >
            Delete Permanently
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export const Maintenance: React.FC = () => {
  const { user, db, rootFolderId, dbFileId, connectFileId, updateDb, logout } = useAppStore();
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [batchSearch, setBatchSearch] = useState('');
  const [showAllStudents, setShowAllStudents] = useState(false);
  const [showAllBatches, setShowAllBatches] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    type: DeleteType;
    itemName: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  const ITEMS_PER_PAGE = 15;

  if (!db || !user || !rootFolderId || !dbFileId || !connectFileId) return null;

  const currentYear = db.academicYears.find((y) => y.isCurrent);
  const currentBatches = db.batches.filter((b) => b.academicYearId === currentYear?.id);

  // Flat list of all students with batch info for easier searching
  const allStudents = useMemo(() => {
    return db.students
      .filter((s) => s.status !== 'REMOVED')
      .map((s) => {
        const batch = db.batches.find((b) => b.id === s.batchId);
        return { ...s, batchLabel: batch ? `${batch.className} - ${batch.batchName}` : 'Unknown' };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [db.students, db.batches]);

  // Filtered students based on search
  const filteredStudents = useMemo(() => {
    if (!studentSearch.trim()) return allStudents;
    const search = studentSearch.toLowerCase();
    return allStudents.filter(
      (s) =>
        s.name.toLowerCase().includes(search) ||
        s.email.toLowerCase().includes(search) ||
        s.batchLabel.toLowerCase().includes(search)
    );
  }, [allStudents, studentSearch]);

  // Filtered batches based on search
  const filteredBatches = useMemo(() => {
    if (!batchSearch.trim()) return currentBatches;
    const search = batchSearch.toLowerCase();
    return currentBatches.filter(
      (b) =>
        b.className.toLowerCase().includes(search) ||
        b.batchName.toLowerCase().includes(search)
    );
  }, [currentBatches, batchSearch]);

  // Paginated results
  const displayedStudents = showAllStudents ? filteredStudents : filteredStudents.slice(0, ITEMS_PER_PAGE);
  const displayedBatches = showAllBatches ? filteredBatches : filteredBatches.slice(0, ITEMS_PER_PAGE);

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  // ─── Delete Student ─────────────────────────────────────────────────────────
  const handleDeleteStudent = async (studentId: string) => {
    const student = db.students.find((s) => s.id === studentId);
    if (!student) return;

    const batch = db.batches.find((b) => b.id === student.batchId);

    setConfirmModal({
      type: 'student',
      itemName: student.name,
      onConfirm: async () => {
        setLoading(true);
        try {
          // Delete from Drive
          await deleteStudentData(
            student,
            dbFileId,
            connectFileId,
            batch?.questionPapersFolderId || '',
            user.accessToken,
          );

          // Update DB
          updateDb(() => ({
            ...db,
            students: db.students.filter((s) => s.id !== studentId),
            payments: db.payments.filter((p) => p.studentId !== studentId),
          }));

          toast.success(`Deleted student "${student.name}" permanently`);
          setConfirmModal(null);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to delete student');
        } finally {
          setLoading(false);
        }
      },
    });
  };

  // ─── Delete Batch ───────────────────────────────────────────────────────────
  const handleDeleteBatch = async (batchId: string) => {
    const batch = db.batches.find((b) => b.id === batchId);
    if (!batch) return;

    const studentsInBatch = db.students.filter((s) => s.batchId === batchId);

    setConfirmModal({
      type: 'batch',
      itemName: `${batch.className} - ${batch.batchName}`,
      onConfirm: async () => {
        setLoading(true);
        try {
          // Revoke all student permissions first
          for (const student of studentsInBatch) {
            await revokeStudentDbAccess(dbFileId, connectFileId, student.email, user.accessToken).catch(() => {});
          }

          // Delete batch folders from Drive
          await deleteBatchFolders(
            {
              batchFolderId: batch.driveFolderId,
              questionPapersFolderId: batch.questionPapersFolderId,
              submissionsFolderId: batch.submissionsFolderId,
            },
            user.accessToken,
          );

          // Update DB - remove batch, its students, payments, announcements, online classes
          const studentIds = studentsInBatch.map((s) => s.id);
          updateDb(() => ({
            ...db,
            batches: db.batches.filter((b) => b.id !== batchId),
            students: db.students.filter((s) => s.batchId !== batchId),
            payments: db.payments.filter((p) => !studentIds.includes(p.studentId)),
            announcements: db.announcements.filter((a) => a.batchId !== batchId),
            onlineClasses: db.onlineClasses.filter((c) => c.batchId !== batchId),
          }));

          toast.success(`Deleted batch "${batch.className} - ${batch.batchName}" and ${studentsInBatch.length} students permanently`);
          setConfirmModal(null);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to delete batch');
        } finally {
          setLoading(false);
        }
      },
    });
  };

  // ─── Delete Academic Year ───────────────────────────────────────────────────
  const handleDeleteYear = async (yearId: string) => {
    const year = db.academicYears.find((y) => y.id === yearId);
    if (!year) return;

    const batchesInYear = db.batches.filter((b) => b.academicYearId === yearId);
    const studentsInYear = db.students.filter((s) => batchesInYear.some((b) => b.id === s.batchId));

    setConfirmModal({
      type: 'year',
      itemName: year.label,
      onConfirm: async () => {
        setLoading(true);
        try {
          // Revoke all student permissions
          for (const student of studentsInYear) {
            await revokeStudentDbAccess(dbFileId, connectFileId, student.email, user.accessToken).catch(() => {});
          }

          // Delete year folder from Drive (includes all batch folders)
          await deleteAcademicYearFolder(year.label, rootFolderId, user.accessToken);

          // Update DB
          const batchIds = batchesInYear.map((b) => b.id);
          const studentIds = studentsInYear.map((s) => s.id);
          
          updateDb((currentDb) => {
            const newYears = currentDb.academicYears.filter((y) => y.id !== yearId);
            // If we deleted the current year, set another as current
            if (year.isCurrent && newYears.length > 0) {
              newYears[0].isCurrent = true;
            }
            return {
              ...currentDb,
              academicYears: newYears,
              batches: currentDb.batches.filter((b) => b.academicYearId !== yearId),
              students: currentDb.students.filter((s) => !batchIds.includes(s.batchId)),
              payments: currentDb.payments.filter((p) => !studentIds.includes(p.studentId)),
              announcements: currentDb.announcements.filter((a) => !batchIds.includes(a.batchId)),
              onlineClasses: currentDb.onlineClasses.filter((c) => !batchIds.includes(c.batchId)),
            };
          });

          toast.success(`Deleted academic year "${year.label}" with ${batchesInYear.length} batches and ${studentsInYear.length} students`);
          setConfirmModal(null);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to delete academic year');
        } finally {
          setLoading(false);
        }
      },
    });
  };

  // ─── Delete Entire App ──────────────────────────────────────────────────────
  const handleDeleteApp = async () => {
    setConfirmModal({
      type: 'app',
      itemName: 'GURUJI App Data',
      onConfirm: async () => {
        setLoading(true);
        try {
          // Delete entire root folder
          await deleteEntireAppData(rootFolderId, user.accessToken);

          toast.success('All GURUJI data deleted. Logging out...');
          
          // Clear local storage
          localStorage.removeItem('sm_dbFileId');
          
          // Wait a moment then logout
          setTimeout(() => {
            logout();
          }, 1500);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to delete app data');
          setLoading(false);
        }
      },
    });
  };

  const SectionHeader: React.FC<{ id: string; icon: React.ReactNode; title: string; subtitle: string; count?: number }> = ({
    id, icon, title, subtitle, count,
  }) => (
    <button
      onClick={() => toggleSection(id)}
      className="w-full flex items-center justify-between p-4 hover:bg-stone-50 transition-colors rounded-lg"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center text-stone-600">
          {icon}
        </div>
        <div className="text-left">
          <p className="font-medium text-stone-800">{title}</p>
          <p className="text-xs text-stone-500">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {count !== undefined && (
          <span className="text-xs bg-stone-100 text-stone-600 px-2 py-0.5 rounded-full">{count}</span>
        )}
        {expandedSection === id ? <ChevronUp size={16} className="text-stone-400" /> : <ChevronDown size={16} className="text-stone-400" />}
      </div>
    </button>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-stone-800">Maintenance</h2>
        <p className="text-sm text-stone-500">Permanently delete data from your Google Drive</p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">
          <p className="font-semibold">Data deletion is permanent</p>
          <p>Deleted files and folders cannot be recovered. Make sure you have backups if needed.</p>
        </div>
      </div>

      {/* Delete Students */}
      <Card className="overflow-hidden">
        <SectionHeader
          id="students"
          icon={<Users size={18} />}
          title="Delete Students"
          subtitle="Remove individual students and their submission folders"
          count={allStudents.length}
        />
        {expandedSection === 'students' && (
          <div className="border-t border-stone-100">
            {/* Search Input */}
            <div className="p-3 border-b border-stone-100 bg-stone-50">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  type="text"
                  placeholder="Search by name, email, or batch..."
                  value={studentSearch}
                  onChange={(e) => { setStudentSearch(e.target.value); setShowAllStudents(false); }}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-stone-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
              </div>
              {studentSearch && (
                <p className="text-xs text-stone-500 mt-2">
                  Found {filteredStudents.length} of {allStudents.length} students
                </p>
              )}
            </div>

            {/* Student List */}
            <div className="max-h-96 overflow-y-auto">
              {filteredStudents.length === 0 ? (
                <p className="text-sm text-stone-500 text-center py-6">
                  {studentSearch ? 'No students match your search' : 'No active students'}
                </p>
              ) : (
                <>
                  <div className="divide-y divide-stone-50">
                    {displayedStudents.map((student) => (
                      <div key={student.id} className="flex items-center justify-between px-4 py-3 hover:bg-stone-50">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-stone-700 truncate">{student.name}</p>
                          <p className="text-xs text-stone-500 truncate">{student.email}</p>
                          <p className="text-[10px] text-stone-400 truncate">{student.batchLabel}</p>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="text-red-600 hover:bg-red-50 border-red-200 ml-2 flex-shrink-0"
                          onClick={() => handleDeleteStudent(student.id)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    ))}
                  </div>

                  {/* Show More Button */}
                  {filteredStudents.length > ITEMS_PER_PAGE && !showAllStudents && (
                    <button
                      onClick={() => setShowAllStudents(true)}
                      className="w-full py-3 text-sm text-amber-600 hover:bg-amber-50 border-t border-stone-100 font-medium"
                    >
                      Show all {filteredStudents.length} students
                    </button>
                  )}
                  {showAllStudents && filteredStudents.length > ITEMS_PER_PAGE && (
                    <button
                      onClick={() => setShowAllStudents(false)}
                      className="w-full py-3 text-sm text-stone-500 hover:bg-stone-50 border-t border-stone-100"
                    >
                      Show less
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Delete Batches */}
      <Card className="overflow-hidden">
        <SectionHeader
          id="batches"
          icon={<BookOpen size={18} />}
          title="Delete Batches"
          subtitle="Remove entire batches with all files and students"
          count={currentBatches.length}
        />
        {expandedSection === 'batches' && (
          <div className="border-t border-stone-100">
            {/* Search Input */}
            {currentBatches.length > 5 && (
              <div className="p-3 border-b border-stone-100 bg-stone-50">
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input
                    type="text"
                    placeholder="Search by class or batch name..."
                    value={batchSearch}
                    onChange={(e) => { setBatchSearch(e.target.value); setShowAllBatches(false); }}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-stone-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  />
                </div>
                {batchSearch && (
                  <p className="text-xs text-stone-500 mt-2">
                    Found {filteredBatches.length} of {currentBatches.length} batches
                  </p>
                )}
              </div>
            )}

            {/* Batch List */}
            <div className="max-h-96 overflow-y-auto">
              {filteredBatches.length === 0 ? (
                <p className="text-sm text-stone-500 text-center py-6">
                  {batchSearch ? 'No batches match your search' : 'No batches in current year'}
                </p>
              ) : (
                <>
                  <div className="divide-y divide-stone-50">
                    {displayedBatches.map((batch) => {
                      const studentCount = db.students.filter((s) => s.batchId === batch.id).length;
                      return (
                        <div key={batch.id} className="flex items-center justify-between px-4 py-3 hover:bg-stone-50">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-stone-700">{batch.className} - {batch.batchName}</p>
                            <p className="text-xs text-stone-500">{studentCount} students · ₹{batch.monthlyFee}/month</p>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="text-red-600 hover:bg-red-50 border-red-200 ml-2 flex-shrink-0"
                            onClick={() => handleDeleteBatch(batch.id)}
                          >
                            <Trash2 size={14} className="mr-1" /> Delete
                          </Button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Show More Button */}
                  {filteredBatches.length > ITEMS_PER_PAGE && !showAllBatches && (
                    <button
                      onClick={() => setShowAllBatches(true)}
                      className="w-full py-3 text-sm text-amber-600 hover:bg-amber-50 border-t border-stone-100 font-medium"
                    >
                      Show all {filteredBatches.length} batches
                    </button>
                  )}
                  {showAllBatches && filteredBatches.length > ITEMS_PER_PAGE && (
                    <button
                      onClick={() => setShowAllBatches(false)}
                      className="w-full py-3 text-sm text-stone-500 hover:bg-stone-50 border-t border-stone-100"
                    >
                      Show less
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Delete Academic Years */}
      <Card className="overflow-hidden">
        <SectionHeader
          id="years"
          icon={<GraduationCap size={18} />}
          title="Delete Academic Years"
          subtitle="Remove entire years with all batches and data"
          count={db.academicYears.length}
        />
        {expandedSection === 'years' && (
          <div className="border-t border-stone-100 p-4 space-y-2">
            {db.academicYears.length === 0 ? (
              <p className="text-sm text-stone-500 text-center py-4">No academic years</p>
            ) : (
              db.academicYears.map((year) => {
                const batchCount = db.batches.filter((b) => b.academicYearId === year.id).length;
                const studentCount = db.students.filter((s) => 
                  db.batches.filter((b) => b.academicYearId === year.id).some((b) => b.id === s.batchId)
                ).length;
                return (
                  <div key={year.id} className="flex items-center justify-between px-2 py-2 hover:bg-stone-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-stone-700">
                        {year.label}
                        {year.isCurrent && (
                          <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Current</span>
                        )}
                      </p>
                      <p className="text-xs text-stone-500">{batchCount} batches · {studentCount} students</p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="text-red-600 hover:bg-red-50 border-red-200"
                      onClick={() => handleDeleteYear(year.id)}
                    >
                      <Trash2 size={14} className="mr-1" /> Delete
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </Card>

      {/* Delete Entire App */}
      <Card className="overflow-hidden border-red-200">
        <div className="p-4 bg-red-50">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center text-red-600">
              <Database size={18} />
            </div>
            <div>
              <p className="font-medium text-red-800">Delete Entire App</p>
              <p className="text-xs text-red-600">Remove all GURUJI data from your Google Drive</p>
            </div>
          </div>
          <p className="text-sm text-red-700 mb-4">
            This will permanently delete the <code className="bg-red-100 px-1 rounded">Guruji_App_Data</code> folder 
            and ALL its contents: {db.academicYears.length} academic years, {db.batches.length} batches, 
            {db.students.length} students, all files and configurations. You will be logged out and will need 
            to set up GURUJI again from scratch.
          </p>
          <Button
            variant="primary"
            className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
            onClick={handleDeleteApp}
          >
            <Trash2 size={14} className="mr-1" /> Delete Everything
          </Button>
        </div>
      </Card>

      {/* Confirm Modal */}
      {confirmModal && (
        <ConfirmModal
          type={confirmModal.type}
          itemName={confirmModal.itemName}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
          loading={loading}
        />
      )}
    </div>
  );
};
