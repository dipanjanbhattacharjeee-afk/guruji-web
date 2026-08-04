import React, { useMemo, useState, useRef } from 'react';
import { Upload, FileText, FolderOpen, Folder, Eye, ChevronLeft, AlertTriangle, RefreshCw, ExternalLink, Trash2 } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { Card } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { Select } from '@/components/shared/Input';
import { EmptyState } from '@/components/shared/EmptyState';
import { Loader } from '@/components/shared/Loader';
import { FilePreviewModal } from '@/components/shared/FilePreviewModal';
import { Modal } from '@/components/shared/Modal';
import { uploadFile, listFiles, deleteFile } from '@/services/driveService';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';

export const FileDistribution: React.FC = () => {
  const { db, user } = useAppStore();
  const [selectedYearId, setSelectedYearId] = useState(
    () => db?.academicYears.find((y) => y.isCurrent)?.id ?? db?.academicYears[0]?.id ?? '',
  );
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [folderType, setFolderType] = useState<'qp' | 'sub'>('qp');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ id: string; name: string; mimeType?: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const years = db?.academicYears ?? [];
  const batches = (db?.batches ?? []).filter((b) => b.academicYearId === selectedYearId);
  const batch = batches.find((b) => b.id === selectedBatchId);

  // Students in this batch that have a personal submissions folder — shown as
  // one "folder" per student when browsing Submissions.
  const submissionStudents = (db?.students ?? [])
    .filter((s) => s.batchId === selectedBatchId && s.submissionsFolderId)
    .sort((a, b) => a.name.localeCompare(b.name));

  const selectedStudent = selectedStudentId
    ? submissionStudents.find((s) => s.id === selectedStudentId)
    : undefined;

  const folderId = folderType === 'qp'
    ? batch?.questionPapersFolderId
    : selectedStudent?.submissionsFolderId;

  const { data: files, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['drive-files', folderId],
    queryFn: () => folderId && user ? listFiles(folderId, user.accessToken) : Promise.resolve([]),
    enabled: !!folderId && !!user,
    retry: false,
  });

  // Newest first
  const sortedFiles = useMemo(
    () => (files ?? []).slice().sort((a, b) => b.createdTime.localeCompare(a.createdTime)),
    [files],
  );

  const selectYear = (id: string) => {
    setSelectedYearId(id);
    setSelectedBatchId('');
    setSelectedStudentId(null);
  };

  const selectBatch = (id: string) => {
    setSelectedBatchId(id);
    setSelectedStudentId(null);
  };

  const selectFolderType = (type: 'qp' | 'sub') => {
    setFolderType(type);
    setSelectedStudentId(null);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !folderId) return;

    setUploading(true);
    try {
      await uploadFile(file, user.accessToken, folderId);
      toast.success(`${file.name} uploaded`);
      refetch();
    } catch (err) {
      toast.error('Upload failed'); console.error(err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm || !user) return;
    setDeleting(true);
    try {
      await deleteFile(deleteConfirm.id, user.accessToken);
      toast.success(`${deleteConfirm.name} deleted`);
      setDeleteConfirm(null);
      refetch();
    } catch (err) {
      toast.error('Delete failed');
      console.error(err);
    } finally {
      setDeleting(false);
    }
  };

  const yearOptions = years.length > 0
    ? years.map((y) => ({ value: y.id, label: y.label + (y.isCurrent ? ' (Current)' : '') }))
    : [{ value: '', label: 'No academic years yet' }];

  const batchOptions = [
    { value: '', label: '— Select batch —' },
    ...batches.map((b) => ({ value: b.id, label: `${b.className} — ${b.batchName}` })),
  ];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[160px]">
            <Select
              label="Academic Year"
              value={selectedYearId}
              onChange={(e) => selectYear(e.target.value)}
              options={yearOptions}
            />
          </div>
          <div className="flex-1 min-w-[180px]">
            <Select
              label="Batch"
              value={selectedBatchId}
              onChange={(e) => selectBatch(e.target.value)}
              options={batchOptions}
            />
          </div>
          <div>
            <p className="text-xs font-medium text-stone-700 mb-1">Folder</p>
            <div className="flex gap-2">
              <button
                onClick={() => selectFolderType('qp')}
                className={`px-3 py-2 text-xs rounded-lg border transition-colors ${
                  folderType === 'qp' ? 'bg-amber-600 text-white border-amber-600' : 'border-stone-300 text-stone-600 hover:border-amber-300'
                }`}
              >
                Question Papers
              </button>
              <button
                onClick={() => selectFolderType('sub')}
                className={`px-3 py-2 text-xs rounded-lg border transition-colors ${
                  folderType === 'sub' ? 'bg-orange-600 text-white border-orange-600' : 'border-stone-300 text-stone-600 hover:border-orange-300'
                }`}
              >
                Submissions
              </button>
            </div>
          </div>
          {/* Only Question Papers is tutor-uploadable; Submissions is student-write-only */}
          {selectedBatchId && folderType === 'qp' && folderId && (
            <div className="ml-auto">
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleUpload}
                className="hidden"
                accept="*/*"
              />
              <Button
                variant="primary"
                size="sm"
                icon={<Upload size={13} />}
                loading={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                Upload File
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Content */}
      {!selectedBatchId ? (
        <EmptyState icon={<FolderOpen size={40} />} title="Select a Batch" description="Choose a batch to view and manage files." />
      ) : folderType === 'qp' ? (
        !batch?.questionPapersFolderId ? (
          <EmptyState icon={<FolderOpen size={40} />} title="No Drive Folder" description="This batch was created without Drive folder setup. Re-create the batch to generate folders." />
        ) : isLoading ? (
          <Loader text="Loading files from Drive…" />
        ) : isError ? (
          <FetchErrorState error={error} onRetry={refetch} />
        ) : sortedFiles.length === 0 ? (
          <EmptyState
            icon={<FileText size={40} />}
            title="No Files Yet"
            description="Upload question papers for students."
            action={
              <Button size="sm" icon={<Upload size={13} />} onClick={() => fileInputRef.current?.click()}>
                Upload File
              </Button>
            }
          />
        ) : (
          <FileListCard files={sortedFiles} onView={setPreviewFile} onDelete={setDeleteConfirm} />
        )
      ) : (
        // ── Submissions: student-folder drill-down ──────────────────────────
        !selectedStudentId ? (
          submissionStudents.length === 0 ? (
            <EmptyState icon={<FolderOpen size={40} />} title="No Students Yet" description="Add students to this batch to see their submission folders here." />
          ) : (
            <Card>
              <div className="divide-y divide-stone-50">
                {submissionStudents.map((s) => (
                  <div
                    key={s.id}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-stone-50/50 transition-colors"
                  >
                    <button
                      onClick={() => setSelectedStudentId(s.id)}
                      className="flex-1 flex items-center gap-3 min-w-0 text-left"
                    >
                      <Folder className="w-4 h-4 text-orange-400 flex-shrink-0" />
                      <p className="text-sm font-medium text-stone-800 truncate">{s.name}</p>
                      {s.status !== 'ACTIVE' && (
                        <span className="text-[10px] uppercase tracking-wide text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">
                          {s.status}
                        </span>
                      )}
                    </button>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <a
                        href={`https://drive.google.com/drive/folders/${s.submissionsFolderId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Open this exact folder in Google Drive"
                        className="p-1.5 text-stone-300 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                      >
                        <ExternalLink size={14} />
                      </a>
                      <button onClick={() => setSelectedStudentId(s.id)}>
                        <ChevronLeft className="w-4 h-4 text-stone-300 rotate-180" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setSelectedStudentId(null)}
                className="flex items-center gap-1 text-xs font-medium text-orange-600 hover:underline"
              >
                <ChevronLeft size={14} /> Back to students
              </button>
              {selectedStudent?.submissionsFolderId && (
                <a
                  href={`https://drive.google.com/drive/folders/${selectedStudent.submissionsFolderId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-medium text-stone-400 hover:text-orange-600"
                  title={selectedStudent.submissionsFolderId}
                >
                  <ExternalLink size={12} /> Open in Google Drive
                </a>
              )}
            </div>
            {isLoading ? (
              <Loader text="Loading files from Drive…" />
            ) : isError ? (
              <FetchErrorState error={error} onRetry={refetch} />
            ) : sortedFiles.length === 0 ? (
              <EmptyState icon={<FileText size={40} />} title="No Submissions Yet" description={`${selectedStudent?.name ?? 'This student'} hasn't submitted any files yet.`} />
            ) : (
              <FileListCard files={sortedFiles} onView={setPreviewFile} onDelete={setDeleteConfirm} />
            )}
          </div>
        )
      )}

      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />

      {/* Delete Confirmation Modal */}
      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete File">
        {deleteConfirm && (
          <div className="space-y-4">
            <p className="text-sm text-stone-600">
              Are you sure you want to delete <strong className="text-stone-800">{deleteConfirm.name}</strong>?
            </p>
            <p className="text-xs text-red-500">
              This will permanently remove the file from Google Drive. This action cannot be undone.
            </p>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setDeleteConfirm(null)} className="flex-1">
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleDelete}
                loading={deleting}
                className="flex-1 !bg-red-600 hover:!bg-red-700"
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

// ─── Couldn't load files from Drive — shown instead of a misleading "empty" ───
// state, since a failed fetch (e.g. an expired session token) looks identical
// to a genuinely empty folder unless we distinguish it explicitly.

const FetchErrorState: React.FC<{ error: unknown; onRetry: () => void }> = ({ error, onRetry }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-center">
    <AlertTriangle className="w-10 h-10 text-red-400" />
    <div>
      <p className="font-semibold text-stone-800 text-sm">Couldn't load files from Drive</p>
      <p className="text-xs text-stone-500 mt-1 max-w-sm">
        {error instanceof Error ? error.message : 'Unknown error'}
      </p>
      <p className="text-xs text-stone-400 mt-1">
        Your session may have expired — try logging out and back in if this persists.
      </p>
    </div>
    <Button size="sm" variant="outline" icon={<RefreshCw size={13} />} onClick={onRetry}>
      Retry
    </Button>
  </div>
);

// ─── Shared file list, newest first, opens the file directly (not a folder) ───

const FileListCard: React.FC<{
  files: { id: string; name: string; webViewLink: string; createdTime: string; mimeType: string }[];
  onView: (file: { id: string; name: string; mimeType?: string }) => void;
  onDelete: (file: { id: string; name: string }) => void;
}> = ({ files, onView, onDelete }) => (
  <Card>
    <div className="divide-y divide-stone-50">
      {files.map((file) => (
        <div key={file.id} className="flex items-center justify-between px-4 py-3 hover:bg-stone-50/50">
          <div className="flex items-center gap-3 min-w-0">
            <FileText className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-stone-800 truncate">{file.name}</p>
              <p className="text-xs text-stone-400">
                {new Date(file.createdTime).toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onView(file)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
            >
              <Eye size={13} /> View
            </button>
            <button
              onClick={() => onDelete({ id: file.id, name: file.name })}
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              title="Delete file"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  </Card>
);

