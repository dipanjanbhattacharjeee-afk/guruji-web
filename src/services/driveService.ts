/**
 * Google Drive API v3 — "Drive as a Database"
 *
 * Architecture
 * ────────────
 * Tutor's Drive:
 *   Guruji_App_Data/
 *     db_app_data.json          ← full JSON DB (shared as reader with every student)
 *     guruji_connect.json       ← tiny pointer: { dbFileId }
 *                                  shared as "anyone with link → reader"
 *                                  so students can find the DB file ID
 *
 * Student access flow:
 *   1. Student logs in with Google (scope: drive — full scope, needed so they can also
 *      write to their own submissions folder; per-file ACLs still gate what they can touch)
 *   2. App searches Drive for any file named "guruji_connect.json"
 *      shared with this user (corpora=allDrives)
 *   3. Reads { dbFileId } from that pointer file
 *   4. Reads db_app_data.json by that fileId (shared as reader)
 *   5. Validates the student's email → grants portal access
 *
 * Tutor access flow:
 *   1. Tutor logs in with master key + Google (scope: drive — full scope; `drive.file`
 *      is NOT enough because it only covers files the tutor's own session created/opened,
 *      not files a student later creates inside a tutor-owned folder under their own grant)
 *   2. Creates/finds Guruji_App_Data folder
 *   3. Creates/reads db_app_data.json
 *   4. Creates/updates guruji_connect.json with dbFileId, shares it "anyone reader"
 *   5. All writes go through uploadJsonFile (update existing file in-place)
 */

import type { AppDatabase, Batch, TutorInfo, StudentStatus } from '@/types';
import { GURUJI_ROOT_FOLDER, DB_FILE_NAME } from '@/types';

const BASE = 'https://www.googleapis.com';
const CONNECT_FILE_NAME = 'guruji_connect.json';

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ─── Generic Drive request ────────────────────────────────────────────────────

async function driveRequest<T>(
  url: string,
  options: RequestInit,
  token: string,
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers as Record<string, string> | undefined),
      ...authHeader(token),
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive API ${res.status}: ${err}`);
  }
  return res.json() as Promise<T>;
}

// ─── Folder helpers ───────────────────────────────────────────────────────────

export async function findFolder(
  name: string,
  token: string,
  parentId?: string,
): Promise<string | null> {
  const q = parentId
    ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const url = `${BASE}/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`;
  const data = await driveRequest<{ files: { id: string }[] }>(url, {}, token);
  return data.files[0]?.id ?? null;
}

export async function createFolder(
  name: string,
  token: string,
  parentId?: string,
): Promise<string> {
  const meta: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) meta.parents = [parentId];
  const data = await driveRequest<{ id: string }>(
    `${BASE}/drive/v3/files?fields=id`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) },
    token,
  );
  return data.id;
}

export async function getOrCreateFolder(
  name: string,
  token: string,
  parentId?: string,
): Promise<string> {
  return (await findFolder(name, token, parentId)) ?? (await createFolder(name, token, parentId));
}

// ─── File helpers ─────────────────────────────────────────────────────────────

export async function findFile(
  name: string,
  token: string,
  parentId?: string,
): Promise<string | null> {
  const q = parentId
    ? `name='${name}' and '${parentId}' in parents and trashed=false`
    : `name='${name}' and trashed=false`;
  const url = `${BASE}/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`;
  const data = await driveRequest<{ files: { id: string }[] }>(url, {}, token);
  return data.files[0]?.id ?? null;
}

export async function readJsonFile<T>(fileId: string, token: string): Promise<T> {
  const res = await fetch(`${BASE}/drive/v3/files/${fileId}?alt=media`, {
    headers: authHeader(token),
  });
  if (!res.ok) throw new Error(`Read file failed: ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Create a new JSON file (multipart upload) or update an existing one (PATCH media).
 */
export async function uploadJsonFile(
  name: string,
  data: unknown,
  token: string,
  parentId?: string,
  existingFileId?: string,
): Promise<string> {
  const content = JSON.stringify(data, null, 2);

  if (existingFileId) {
    const res = await fetch(
      `${BASE}/upload/drive/v3/files/${existingFileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: content,
      },
    );
    if (!res.ok) throw new Error(`Update file failed: ${await res.text()}`);
    return existingFileId;
  }

  // Multipart upload for new file
  const meta: Record<string, unknown> = { name, mimeType: 'application/json' };
  if (parentId) meta.parents = [parentId];

  const boundary = 'sm_boundary_7e3a9b';
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    JSON.stringify(meta) +
    `\r\n--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    content +
    `\r\n--${boundary}--`;

  const res = await fetch(
    `${BASE}/upload/drive/v3/files?uploadType=multipart&fields=id`,
    {
      method: 'POST',
      headers: {
        ...authHeader(token),
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) throw new Error(`Create file failed: ${await res.text()}`);
  const result = await res.json() as { id: string };
  return result.id;
}

// ─── Sharing helpers ──────────────────────────────────────────────────────────

/** Share a Drive file with a specific email address */
export async function grantPermission(
  fileId: string,
  email: string,
  role: 'reader' | 'writer',
  token: string,
): Promise<void> {
  const res = await fetch(`${BASE}/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role, emailAddress: email }),
  });
  // Non-fatal — log but don't throw (student may already have access)
  if (!res.ok) console.warn(`grantPermission ${email}: ${res.status}`);
}

/**
 * Explicitly share the DB + connect pointer files with a specific student's Google
 * account (in addition to the "anyone with the link" permission).
 *
 * Why this is needed: Drive's `files.list` search only returns files the querying
 * user owns or that are shared with them via a `user`/`domain`/`group` permission.
 * An `anyone`-type permission does NOT make a file discoverable via search for an
 * account that has never manually opened the link — so a student who has never
 * clicked the link before would never find `guruji_connect.json` and would see
 * "Could not find the class database" even though their account is correct.
 * Granting an explicit `user` permission fixes discovery for that student.
 */
export async function grantStudentDbAccess(
  dbFileId: string,
  connectFileId: string,
  studentEmail: string,
  token: string,
): Promise<void> {
  await grantPermission(dbFileId, studentEmail, 'reader', token).catch(() => {});
  await grantPermission(connectFileId, studentEmail, 'reader', token).catch(() => {});
}

/**
 * Counterpart to grantStudentDbAccess — removes a disabled/removed student's explicit
 * reader permission from the DB + connect files. Note: this does NOT change the app's
 * enforced access (that's controlled by the student's `status` field in the DB, checked
 * at login), it just avoids leaving a named grant behind for someone who should no
 * longer have any reason to hold one.
 */
export async function revokeStudentDbAccess(
  dbFileId: string,
  connectFileId: string,
  studentEmail: string,
  token: string,
): Promise<void> {
  await removePermission(dbFileId, studentEmail, token).catch(() => {});
  await removePermission(connectFileId, studentEmail, token).catch(() => {});
}

/** Share a file publicly so anyone with the link can read it */
export async function makePublicReader(fileId: string, token: string): Promise<void> {
  const res = await fetch(`${BASE}/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'anyone', role: 'reader' }),
  });
  if (!res.ok) console.warn(`makePublicReader: ${res.status}`);
}

/** Remove a user's permission from a file */
export async function removePermission(
  fileId: string,
  email: string,
  token: string,
): Promise<void> {
  const res = await fetch(
    `${BASE}/drive/v3/files/${fileId}/permissions?fields=permissions(id,emailAddress)`,
    { headers: authHeader(token) },
  );
  if (!res.ok) return;
  const data = await res.json() as { permissions: { id: string; emailAddress: string }[] };
  const perm = data.permissions?.find((p) => p.emailAddress === email);
  if (!perm) return;
  await fetch(`${BASE}/drive/v3/files/${fileId}/permissions/${perm.id}`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
}

// ─── App initialisation (Tutor) ───────────────────────────────────────────────

export interface DriveSetup {
  rootFolderId: string;
  dbFileId: string;
  connectFileId: string;
  db: AppDatabase;
}

/**
 * Called once on tutor login.
 *
 * Creates (or finds) the root folder and JSON DB file.
 * Also ensures a `guruji_connect.json` pointer file exists and is publicly readable
 * so students can discover the DB file ID without needing the tutor's Drive to be shared.
 */
export async function initializeTutorDrive(
  token: string,
  tutorEmail: string,
  tutorName: string,
): Promise<DriveSetup> {
  // 1. Root folder
  const rootFolderId = await getOrCreateFolder(GURUJI_ROOT_FOLDER, token);

  // 2. DB file
  let dbFileId = await findFile(DB_FILE_NAME, token, rootFolderId);
  let db: AppDatabase;

  if (dbFileId) {
    db = await readJsonFile<AppDatabase>(dbFileId, token);
    // Migrate: ensure onlineClasses field exists for older DBs
    if (!db.onlineClasses) db = { ...db, onlineClasses: [] };
  } else {
    db = {
      tutor: { email: tutorEmail, name: tutorName, masterKeyValidated: true },
      academicYears: [],
      batches: [],
      students: [],
      payments: [],
      announcements: [],
      onlineClasses: [],
    };
    dbFileId = await uploadJsonFile(DB_FILE_NAME, db, token, rootFolderId);
  }

  // 3. Connect pointer file — tiny file shared publicly so students can find the DB ID
  let connectFileId = await findFile(CONNECT_FILE_NAME, token, rootFolderId);
  if (!connectFileId) {
    connectFileId = await uploadJsonFile(
      CONNECT_FILE_NAME,
      { dbFileId, tutorEmail },
      token,
      rootFolderId,
    );
    // Make it publicly readable (anyone with the link)
    await makePublicReader(connectFileId, token);
  }

  // 4. Also ensure db file itself is readable by anyone (students read it directly)
  //    We use makePublicReader here too — it is idempotent.
  await makePublicReader(dbFileId, token);

  // 5. Reconcile per-student access: explicitly share the DB + connect files with every
  //    active student's account so Drive's file search can actually discover them (the
  //    "anyone with the link" permission above is NOT enough for search/discovery — see
  //    grantStudentDbAccess for why). Runs on every tutor login so it also repairs any
  //    student added before this fix existed.
  const activeStudentEmails = db.students
    .filter((s) => s.status === 'ACTIVE')
    .map((s) => s.email);
  await Promise.all(
    activeStudentEmails.map((email) =>
      grantStudentDbAccess(dbFileId, connectFileId, email, token),
    ),
  );

  return { rootFolderId, dbFileId, connectFileId, db };
}

// ─── Student login: find DB via shared connect file ───────────────────────────

/**
 * Called on student login.
 *
 * Strategy:
 *   a) Try to find `guruji_connect.json` among ALL files shared with this user
 *      using corpora=allDrives (works with the full drive scope).
 *   b) Read it to get dbFileId.
 *   c) Read db_app_data.json (it is shared publicly → readable with any valid token).
 *
 * Falls back to a cached dbFileId stored in localStorage from a previous session.
 */
export async function loadStudentDriveData(
  token: string,
): Promise<{ dbFileId: string; db: AppDatabase } | null> {
  let dbFileId: string | null = null;

  // a) Search for the connect pointer file across all shared drives / shared-with-me
  try {
    const q = `name='${CONNECT_FILE_NAME}' and trashed=false`;
    const url =
      `${BASE}/drive/v3/files` +
      `?q=${encodeURIComponent(q)}` +
      `&fields=files(id)` +
      `&corpora=allDrives` +
      `&includeItemsFromAllDrives=true` +
      `&supportsAllDrives=true`;

    const res = await fetch(url, { headers: authHeader(token) });
    if (res.ok) {
      const data = await res.json() as { files: { id: string }[] };
      if (data.files.length > 0) {
        const connectFileId = data.files[0].id;
        const ptr = await readJsonFile<{ dbFileId: string }>(connectFileId, token);
        dbFileId = ptr.dbFileId;
        // Cache the dbFileId locally for faster future loads
        localStorage.setItem('sm_dbFileId', dbFileId);
      }
    }
  } catch {
    // silently fall through to cache
  }

  // b) Fallback to locally cached ID
  if (!dbFileId) {
    dbFileId = localStorage.getItem('sm_dbFileId');
  }

  if (!dbFileId) return null;

  // c) Read the DB file directly by ID (it is public-reader)
  try {
    const db = await readJsonFile<AppDatabase>(dbFileId, token);
    if (!db.onlineClasses) (db as AppDatabase).onlineClasses = [];
    return { dbFileId, db };
  } catch {
    // File ID invalid or revoked — clear cache
    localStorage.removeItem('sm_dbFileId');
    return null;
  }
}

/**
 * Multi-tutor support: Discover ALL tutors that have enrolled a student.
 * Returns array of TutorInfo for each tutor where the student is registered.
 */
export async function discoverAllTutors(token: string, studentEmail: string): Promise<TutorInfo[]> {
  const tutors: TutorInfo[] = [];
  
  try {
    // Search for ALL guruji_connect.json files the student has access to
    const q = `name='${CONNECT_FILE_NAME}' and trashed=false`;
    const url =
      `${BASE}/drive/v3/files` +
      `?q=${encodeURIComponent(q)}` +
      `&fields=files(id)` +
      `&corpora=allDrives` +
      `&includeItemsFromAllDrives=true` +
      `&supportsAllDrives=true`;
    
    const res = await fetch(url, { headers: authHeader(token) });
    if (!res.ok) return tutors;
    
    const data = await res.json() as { files: { id: string }[] };
    
    // Process each connect file in parallel
    const promises = data.files.map(async (file) => {
      try {
        const ptr = await readJsonFile<{ dbFileId: string; tutorEmail?: string }>(file.id, token);
        if (!ptr.dbFileId) return null;
        
        const db = await readJsonFile<AppDatabase>(ptr.dbFileId, token);
        if (!db.tutor || !db.students) return null;
        
        // Find student in this tutor's database
        const student = db.students.find(
          (s) => s.email.toLowerCase() === studentEmail.toLowerCase()
        );
        
        if (!student) return null; // Not enrolled with this tutor
        
        // Get batch names for this student
        const enrolledBatches = db.batches
          .filter((b) => b.id === student.batchId)
          .map((b) => `${b.className} - ${b.batchName}`);
        
        return {
          tutorName: db.tutor.name || db.tutor.email,
          tutorEmail: db.tutor.email,
          dbFileId: ptr.dbFileId,
          connectFileId: file.id,
          enrolledBatches,
          studentStatus: student.status as StudentStatus,
        } as TutorInfo;
      } catch {
        return null;
      }
    });
    
    const results = await Promise.all(promises);
    return results.filter((t): t is TutorInfo => t !== null);
  } catch {
    return tutors;
  }
}

// ─── Drive folder structure ───────────────────────────────────────────────────
//
//  Guruji_App_Data/
//    db_app_data.json
//    guruji_connect.json
//    Academic_Year_2026_2027/
//      Class_10_Science_Batch_A/
//        Question_Papers/           ← batch-wide; student has reader
//        Student_Submissions/       ← container folder (tutor sees all)
//          Ravi_Kumar/              ← personal; only Ravi has writer
//          Priya_Sharma/
//      Class_9_Maths_Batch_B/
//        ...

/**
 * Creates the full folder tree for a new batch.
 * Returns IDs needed to store in the Batch record.
 */
export async function createBatchFolders(
  batch: Pick<Batch, 'className' | 'batchName'>,
  academicYearLabel: string,
  rootFolderId: string,
  token: string,
): Promise<{ batchFolderId: string; qpFolderId: string; submissionsContainerFolderId: string }> {
  const yearName = `Academic_Year_${academicYearLabel.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const yearFolderId = await getOrCreateFolder(yearName, token, rootFolderId);

  const batchFolderName = `${batch.className.replace(/ /g, '_')}_${batch.batchName.replace(/ /g, '_')}`;
  const batchFolderId = await getOrCreateFolder(batchFolderName, token, yearFolderId);

  // Question_Papers — shared with all batch students as reader
  const qpFolderId = await getOrCreateFolder('Question_Papers', token, batchFolderId);

  // Student_Submissions — container; students do NOT get direct access here
  const submissionsContainerFolderId = await getOrCreateFolder('Student_Submissions', token, batchFolderId);

  return { batchFolderId, qpFolderId, submissionsContainerFolderId };
}

/**
 * Creates a personal submissions subfolder for one student inside the batch's
 * Student_Submissions container. The student is granted writer access only to
 * their own subfolder. Returns the new folder ID.
 *
 * Folder name: "FirstName_LastName_1234" — sanitised name plus the last 4 digits
 * of the student's phone number (falls back to a fragment of their email if no
 * usable digits exist). The suffix is required because two students in the same
 * batch can share an identical display name; getOrCreateFolder() matches folders
 * by name, so without a disambiguator the second student would silently be
 * handed the first student's existing folder (and both would get write access
 * to the same files).
 */
export async function createStudentSubmissionsFolder(
  studentName: string,
  studentEmail: string,
  studentPhone: string,
  submissionsContainerFolderId: string,
  token: string,
): Promise<string> {
  const safeName = studentName.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/ +/g, '_') || 'Student';
  const digits = studentPhone.replace(/\D/g, '');
  const suffix = digits.length >= 4
    ? digits.slice(-4)
    : (studentEmail.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || '0000');
  const folderName = `${safeName}_${suffix}`;
  const folderId = await getOrCreateFolder(folderName, token, submissionsContainerFolderId);
  // Grant the student writer access to their own folder only. Unlike grantPermission()
  // elsewhere (best-effort, non-fatal), this grant is load-bearing for the "Upload
  // Submission" feature — if it silently fails the student gets a folder with no write
  // access and a confusing "Upload failed" error later, so we throw here and let the
  // caller surface it to the tutor immediately instead.
  const res = await fetch(`${BASE}/drive/v3/files/${folderId}/permissions`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: studentEmail }),
  });
  if (!res.ok) {
    throw new Error(`Could not grant ${studentEmail} write access to their submissions folder (HTTP ${res.status})`);
  }
  return folderId;
}

// ─── File upload (question papers / submissions) ──────────────────────────────

export async function uploadFile(
  file: File,
  token: string,
  parentFolderId: string,
): Promise<string> {
  const meta = JSON.stringify({ name: file.name, parents: [parentFolderId] });
  const formData = new FormData();
  formData.append('metadata', new Blob([meta], { type: 'application/json' }));
  formData.append('file', file);

  const res = await fetch(
    `${BASE}/upload/drive/v3/files?uploadType=multipart&fields=id,parents`,
    { method: 'POST', headers: authHeader(token), body: formData },
  );
  if (!res.ok) {
    const body = await res.text();
    let reason = body;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      if (parsed.error?.message) reason = parsed.error.message;
    } catch { /* not JSON — fall back to raw response text */ }
    throw new Error(reason || `Upload failed (HTTP ${res.status})`);
  }
  const result = await res.json() as { id: string; parents?: string[] };
  // Google Drive can silently ignore an invalid/inaccessible `parents` reference
  // and fall back to creating the file in the uploader's own Drive root instead
  // of throwing an error. That would look like a successful upload while the
  // file is actually invisible to anyone else — so verify placement explicitly.
  if (!result.parents?.includes(parentFolderId)) {
    throw new Error(
      'File was uploaded to your Drive but could not be placed in the shared folder ' +
      '(check that you still have access, then try again).',
    );
  }
  return result.id;
}

// ─── List files in a folder ───────────────────────────────────────────────────

export async function listFiles(
  folderId: string,
  token: string,
): Promise<{ id: string; name: string; webViewLink: string; createdTime: string; mimeType: string }[]> {
  const q = `'${folderId}' in parents and trashed=false`;
  const url =
    `${BASE}/drive/v3/files` +
    `?q=${encodeURIComponent(q)}` +
    `&fields=files(id,name,webViewLink,createdTime,mimeType)` +
    `&orderBy=createdTime desc`;
  const data = await driveRequest<{
    files: { id: string; name: string; webViewLink: string; createdTime: string; mimeType: string }[];
  }>(url, {}, token);
  return data.files ?? [];
}

// ─── Download file content (for in-app preview, via our own OAuth token) ──────
// Unlike Drive's iframe `/preview` embed (which needs Google's own cookies inside
// the frame and silently fails when third-party cookies are blocked), this fetches
// the raw bytes using the exact same authenticated API calls the rest of the app
// already relies on — so it works whenever the Drive API itself is reachable.

export async function downloadFileBlob(fileId: string, token: string): Promise<Blob> {
  const res = await fetch(`${BASE}/drive/v3/files/${fileId}?alt=media`, {
    headers: authHeader(token),
  });
  if (!res.ok) {
    throw new Error(`Could not download file (HTTP ${res.status})`);
  }
  return res.blob();
}

// ─── Maintenance / Delete functions ───────────────────────────────────────────

/**
 * Permanently delete a file or folder (moves to trash then empties).
 * For folders, this recursively deletes all contents.
 */
export async function deleteFile(fileId: string, token: string): Promise<void> {
  const res = await fetch(`${BASE}/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: authHeader(token),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete file (HTTP ${res.status})`);
  }
}

/**
 * Delete a student's submission folder and revoke all their permissions.
 */
export async function deleteStudentData(
  student: { email: string; submissionFolderId?: string },
  dbFileId: string,
  connectFileId: string,
  batchQpFolderId: string,
  token: string,
): Promise<void> {
  // 1. Delete their personal submissions folder
  if (student.submissionFolderId) {
    await deleteFile(student.submissionFolderId, token).catch(() => {});
  }
  
  // 2. Revoke all their permissions
  await revokeStudentDbAccess(dbFileId, connectFileId, student.email, token);
  await removePermission(batchQpFolderId, student.email, token).catch(() => {});
}

/**
 * Delete all folders for a batch.
 * Returns list of students whose folders were deleted.
 */
export async function deleteBatchFolders(
  batch: {
    batchFolderId?: string;
    questionPapersFolderId?: string;
    submissionsFolderId?: string;
  },
  token: string,
): Promise<void> {
  // Deleting the batch folder recursively deletes Question_Papers and Student_Submissions
  if (batch.batchFolderId) {
    await deleteFile(batch.batchFolderId, token).catch(() => {});
  }
}

/**
 * Delete an academic year folder and all its contents.
 */
export async function deleteAcademicYearFolder(
  yearLabel: string,
  rootFolderId: string,
  token: string,
): Promise<void> {
  const yearName = `Academic_Year_${yearLabel.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const yearFolderId = await findFolder(yearName, token, rootFolderId);
  if (yearFolderId) {
    await deleteFile(yearFolderId, token);
  }
}

/**
 * Delete the entire GURUJI app data from Drive.
 * This removes the Guruji_App_Data folder and all its contents permanently.
 */
export async function deleteEntireAppData(
  rootFolderId: string,
  token: string,
): Promise<void> {
  await deleteFile(rootFolderId, token);
}
