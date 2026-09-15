import { QueueLoadFailure, type QueueFailure } from "@/components/panel/queue";
import { EMPTY_VALUE, formatDateTime } from "@/lib/format";
import type { StaffResourceType } from "@/lib/staff-notes";
import {
  getStaffFlags,
  getStaffNotes,
  type StaffFlag,
  type StaffNote,
} from "@/server/api/staff-notes";
import type { PageDto } from "@/server/api/types";
import { getKoalaAccessToken } from "@/server/auth/session";
import type { Permission } from "@/server/authz/permissions";
import { getStaffContext } from "@/server/authz/staff-context";
import {
  submitStaffFlagClear,
  submitStaffFlagSet,
  submitStaffNoteCreate,
  submitStaffNoteDelete,
  submitStaffNoteEdit,
} from "@/server/notes/actions";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { StaffFlagBadges } from "./staff-flag-badges";
import {
  StaffFlagClearForm,
  StaffFlagSetForm,
  StaffNoteComposeForm,
  StaffNoteDeleteForm,
  StaffNoteEditForm,
} from "./staff-note-forms";

/**
 * Nesne sayfasındaki notlar ve işaretler (koala-admin#109).
 *
 * Sayfanın kendi kapısı (`user.read` vb.) burada bir şey korumaz. `note.read`
 * yoksa GET çıkmaz; finans kolu notu görmez, nesne yine durur. Yazma formları
 * `note.write` / `flag.manage` ister ve asıl kapı Server Action'dadır.
 */

interface NotesLoaded {
  readonly kind: "loaded";
  readonly page: PageDto<StaffNote>;
  readonly flags: readonly StaffFlag[];
}

interface NotesDenied {
  readonly kind: "no-permission";
}

interface NotesFailed {
  readonly kind: "failed";
  readonly failure: QueueFailure;
}

type NotesResult = NotesLoaded | NotesDenied | NotesFailed;

export async function StaffNotesSection({
  resourceType,
  resourceId,
}: {
  resourceType: StaffResourceType;
  resourceId: string;
}) {
  const context = await getStaffContext();
  const held = new Set<Permission>(context.staff?.permissions ?? []);
  const data = await loadNotes(resourceType, resourceId, held.has("note.read"));
  const canWrite = held.has("note.write");
  const canManageFlags = held.has("flag.manage");
  const canManageStaff = held.has("staff.manage");
  const staffId = context.staff?.staffId ?? null;

  return (
    <section
      className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-4"
      aria-labelledby="staff-notes-heading"
      data-testid="staff-notes"
    >
      <div className="flex flex-col gap-1">
        <h2 id="staff-notes-heading" className="text-sm font-semibold">
          Notlar ve işaretler
        </h2>
        <p className="max-w-prose text-xs text-ink-muted">
          Personelin bu kayıt hakkındaki serbest metin notları ve risk / VIP işaretleri. Yazımlar
          denetim kaydına düşer.
        </p>
      </div>

      {data.kind === "no-permission" ? (
        <p className="text-sm text-ink-muted" data-testid="staff-notes-disabled">
          Personel notları <code className="font-mono">note.read</code> ister; istek gönderilmedi.
        </p>
      ) : null}

      {data.kind === "failed" ? (
        <QueueLoadFailure
          subject="Personel notları"
          permission="note.read"
          failure={data.failure}
        />
      ) : null}

      {data.kind === "loaded" ? (
        <>
          <FlagsBlock
            flags={data.flags}
            resourceType={resourceType}
            resourceId={resourceId}
            canManage={canManageFlags}
          />
          <NotesList
            notes={data.page.content}
            total={data.page.totalElements}
            resourceType={resourceType}
            resourceId={resourceId}
            canWrite={canWrite}
            staffId={staffId}
            canManageStaff={canManageStaff}
          />
          {canWrite ? (
            <StaffNoteComposeForm
              action={submitStaffNoteCreate}
              resourceType={resourceType}
              resourceId={resourceId}
            />
          ) : (
            <p className="text-xs text-ink-muted" data-testid="staff-notes-write-disabled">
              Not yazmak <code className="font-mono">note.write</code> ister.
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}

function FlagsBlock({
  flags,
  resourceType,
  resourceId,
  canManage,
}: {
  flags: readonly StaffFlag[];
  resourceType: string;
  resourceId: string;
  canManage: boolean;
}) {
  return (
    <div className="flex flex-col gap-2" data-testid="staff-notes-flags">
      <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">İşaretler</h3>
      {flags.length === 0 ? (
        <p className="text-sm text-ink-muted">Bu kayıtta etkin işaret yok.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {flags.map((flag) => (
            <li key={flag.id} className="flex flex-wrap items-center gap-2">
              <StaffFlagBadges flags={[flag]} testId={`staff-flag-${flag.kind}`} />
              <span className="text-xs text-ink-muted">
                {flag.setByDisplayName ?? EMPTY_VALUE} · {formatDateTime(flag.setAt)}
              </span>
              {canManage ? (
                <StaffFlagClearForm
                  action={submitStaffFlagClear}
                  resourceType={resourceType}
                  resourceId={resourceId}
                  kind={flag.kind}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <StaffFlagSetForm
          action={submitStaffFlagSet}
          resourceType={resourceType}
          resourceId={resourceId}
        />
      ) : (
        <p className="text-xs text-ink-muted" data-testid="staff-flags-manage-disabled">
          İşaret koymak <code className="font-mono">flag.manage</code> ister.
        </p>
      )}
    </div>
  );
}

function NotesList({
  notes,
  total,
  resourceType,
  resourceId,
  canWrite,
  staffId,
  canManageStaff,
}: {
  notes: readonly StaffNote[];
  total: number;
  resourceType: string;
  resourceId: string;
  canWrite: boolean;
  staffId: string | null;
  canManageStaff: boolean;
}) {
  if (notes.length === 0) {
    return (
      <p className="text-sm text-ink-muted" data-testid="staff-notes-empty">
        Bu kayıt için personel notu yok.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Notlar</h3>
      <ul className="flex flex-col gap-3">
        {notes.map((note) => {
          const canEdit =
            canWrite && staffId !== null && (note.authorStaffId === staffId || canManageStaff);
          return (
            <li
              key={note.id}
              className="flex flex-col gap-2 rounded-md border border-border-subtle px-3 py-2"
              data-testid={`staff-note-${note.id}`}
            >
              <p className="text-sm whitespace-pre-wrap">{note.body}</p>
              <p className="text-xs text-ink-muted">
                {note.authorDisplayName ?? EMPTY_VALUE} · {formatDateTime(note.createdAt)}
                {note.editedAt === null ? null : ` · düzenlendi ${formatDateTime(note.editedAt)}`}
              </p>
              {canEdit ? (
                <div className="flex flex-col gap-2">
                  <StaffNoteEditForm
                    action={submitStaffNoteEdit}
                    resourceType={resourceType}
                    resourceId={resourceId}
                    noteId={note.id}
                    initialBody={note.body}
                  />
                  <StaffNoteDeleteForm
                    action={submitStaffNoteDelete}
                    resourceType={resourceType}
                    resourceId={resourceId}
                    noteId={note.id}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {total > notes.length ? (
        <p className="text-xs text-ink-muted">
          En yeni {notes.length} not gösteriliyor; toplam {total}.
        </p>
      ) : null}
    </div>
  );
}

async function loadNotes(
  resourceType: StaffResourceType,
  resourceId: string,
  canRead: boolean,
): Promise<NotesResult> {
  if (!canRead) {
    return { kind: "no-permission" };
  }

  try {
    const accessToken = await getKoalaAccessToken();
    const [page, flags] = await Promise.all([
      getStaffNotes(accessToken, resourceType, resourceId),
      getStaffFlags(accessToken, { resourceType, resourceId }),
    ]);
    return { kind: "loaded", page, flags };
  } catch (error) {
    return { kind: "failed", failure: classifyQueueFailure(error) };
  }
}
