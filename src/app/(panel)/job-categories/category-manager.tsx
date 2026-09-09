"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  Badge,
  Dialog,
  EmptyState,
  FormField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextInput,
} from "@/components/ui";
import {
  IDLE_AUTHORIZATION_OUTCOME,
  type AuthorizationChangeAction,
  type AuthorizationChangeOutcome,
} from "@/lib/authorization-change";
import { formatInteger } from "@/lib/format";

export interface CategoryRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly requiresInsurance: boolean;
}

interface CategoryManagerProps {
  readonly categories: readonly CategoryRecord[];
  readonly createAction: AuthorizationChangeAction;
  readonly updateAction: AuthorizationChangeAction;
  readonly deleteAction: AuthorizationChangeAction;
}

type ActiveDialog =
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly category: CategoryRecord }
  | { readonly kind: "delete"; readonly category: CategoryRecord };

const BUTTON =
  "rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60";
const PRIMARY = `${BUTTON} bg-brand text-white hover:bg-brand-strong`;
const SECONDARY = `${BUTTON} border border-border-strong bg-surface text-ink hover:bg-surface-sunken`;
const DANGER = `${BUTTON} border border-danger/40 bg-danger-soft text-danger hover:bg-danger/10`;

export function CategoryManager({
  categories,
  createAction,
  updateAction,
  deleteAction,
}: CategoryManagerProps) {
  const [active, setActive] = useState<ActiveDialog | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {categories.length === 0 ? (
        <EmptyState
          title="Hiç iş kategorisi yok."
          description="Katalog boşken ilk kategoriyi buradan oluşturabilirsiniz."
          action={
            <button type="button" className={PRIMARY} onClick={() => setActive({ kind: "create" })}>
              İlk kategoriyi ekle
            </button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-muted">{formatInteger(categories.length)} kategori.</p>
            <button type="button" className={PRIMARY} onClick={() => setActive({ kind: "create" })}>
              Kategori ekle
            </button>
          </div>

          <Table caption="İş kategorileri">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Ad</TableHeaderCell>
                <TableHeaderCell>Kod</TableHeaderCell>
                <TableHeaderCell>Sigorta</TableHeaderCell>
                <TableHeaderCell>İşlemler</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {categories.map((category) => (
                <TableRow key={category.id}>
                  <TableCell>{category.name}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{category.code}</span>
                  </TableCell>
                  <TableCell>
                    {category.requiresInsurance ? (
                      <Badge tone="warning">Zorunlu</Badge>
                    ) : (
                      <Badge>Gerekmiyor</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={SECONDARY}
                        aria-label={`${category.name} kategorisini düzenle`}
                        onClick={() => setActive({ kind: "edit", category })}
                      >
                        Düzenle
                      </button>
                      <button
                        type="button"
                        className={DANGER}
                        aria-label={`${category.name} kategorisini sil`}
                        onClick={() => setActive({ kind: "delete", category })}
                      >
                        Sil
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      {active?.kind === "create" ? (
        <CategoryEditor
          key="create"
          action={createAction}
          category={null}
          onClose={() => setActive(null)}
        />
      ) : null}
      {active?.kind === "edit" ? (
        <CategoryEditor
          key={`edit-${active.category.id}`}
          action={updateAction}
          category={active.category}
          onClose={() => setActive(null)}
        />
      ) : null}
      {active?.kind === "delete" ? (
        <CategoryDeleteDialog
          key={`delete-${active.category.id}`}
          action={deleteAction}
          category={active.category}
          onClose={() => setActive(null)}
        />
      ) : null}
    </div>
  );
}

function CategoryEditor({
  action,
  category,
  onClose,
}: {
  readonly action: AuthorizationChangeAction;
  readonly category: CategoryRecord | null;
  readonly onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<AuthorizationChangeOutcome, FormData>(
    action,
    IDLE_AUTHORIZATION_OUTCOME,
  );
  const [code, setCode] = useState(category?.code ?? "");
  const [name, setName] = useState(category?.name ?? "");
  const [requiresInsurance, setRequiresInsurance] = useState(category?.requiresInsurance ?? false);
  const submitting = useRef(false);

  useEffect(() => {
    if (!pending) submitting.current = false;
  }, [pending, state]);

  const prefix = category === null ? "category-create" : `category-edit-${category.id}`;
  const insuranceErrorId = `${prefix}-requiresInsurance-error`;
  const close = () => {
    if (!pending) onClose();
  };

  return (
    <Dialog
      open
      onClose={close}
      title={category === null ? "Kategori ekle" : "Kategoriyi düzenle"}
      description="Kod, ad ve sigorta gereksinimi backend sözleşmesine eksiksiz gönderilir."
    >
      <form
        action={formAction}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          if (submitting.current) {
            event.preventDefault();
            return;
          }
          submitting.current = true;
        }}
      >
        {category === null ? null : <input type="hidden" name="categoryId" value={category.id} />}

        <FormField
          id={`${prefix}-code`}
          label="Kod"
          required
          hint={
            category === null
              ? "2-64 karakter: A-Z, 0-9 ve alt çizgi."
              : "Kod diğer sistemler için kararlı bir eşleme anahtarıdır; değiştirmek mevcut eşlemeleri etkileyebilir."
          }
          error={state.field === "code" ? state.message : null}
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              name="code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
              minLength={2}
              maxLength={64}
              pattern="[A-Z][A-Z0-9_]{1,63}"
              autoComplete="off"
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </FormField>

        <FormField
          id={`${prefix}-name`}
          label="Ad"
          required
          error={state.field === "name" ? state.message : null}
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={255}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </FormField>

        <div className="flex flex-col gap-1.5">
          <input type="hidden" name="requiresInsurance" value="false" />
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              name="requiresInsurance"
              value="true"
              checked={requiresInsurance}
              onChange={(event) => setRequiresInsurance(event.target.checked)}
              aria-invalid={state.field === "requiresInsurance"}
              aria-describedby={state.field === "requiresInsurance" ? insuranceErrorId : undefined}
            />
            Sigorta zorunlu
          </label>
          {state.field === "requiresInsurance" ? (
            <p id={insuranceErrorId} className="text-xs font-medium text-danger">
              {state.message}
            </p>
          ) : null}
        </div>

        <Outcome state={state} />

        <div className="flex justify-end gap-2">
          <button type="button" className={SECONDARY} onClick={close} disabled={pending}>
            Vazgeç
          </button>
          <button
            type="submit"
            className={PRIMARY}
            disabled={pending || state.status === "SUCCEEDED"}
          >
            {pending
              ? "Kaydediliyor…"
              : category === null
                ? "Kategori oluştur"
                : "Değişiklikleri kaydet"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function CategoryDeleteDialog({
  action,
  category,
  onClose,
}: {
  readonly action: AuthorizationChangeAction;
  readonly category: CategoryRecord;
  readonly onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<AuthorizationChangeOutcome, FormData>(
    action,
    IDLE_AUTHORIZATION_OUTCOME,
  );
  const [confirmed, setConfirmed] = useState(false);
  const submitting = useRef(false);
  const confirmationErrorId = `category-delete-${category.id}-confirmation-error`;

  useEffect(() => {
    if (!pending) submitting.current = false;
  }, [pending, state]);

  const close = () => {
    if (!pending) onClose();
  };

  return (
    <Dialog
      open
      onClose={close}
      title="Kategoriyi sil"
      description={`${category.name} (${category.code}) kalıcı olarak silinecek.`}
    >
      <form
        action={formAction}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          if (submitting.current) {
            event.preventDefault();
            return;
          }
          submitting.current = true;
        }}
      >
        <input type="hidden" name="categoryId" value={category.id} />
        {confirmed ? (
          <input type="hidden" name="deleteConfirmation" value={`DELETE:${category.id}`} />
        ) : null}

        <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-ink">
          Bu işlem geri alınamaz. Kullanımdaki bir kategori backend tarafından reddedilir; panel
          bağlı ilanları, alarmları veya şablonları kendiliğinden silmez.
        </p>

        <label className="flex items-start gap-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            aria-invalid={state.field === "deleteConfirmation"}
            aria-describedby={
              state.field === "deleteConfirmation" ? confirmationErrorId : undefined
            }
          />
          Bu kategorinin silineceğini ve işlemin geri alınamayacağını anlıyorum.
        </label>
        {state.field === "deleteConfirmation" ? (
          <p id={confirmationErrorId} className="text-xs font-medium text-danger">
            {state.message}
          </p>
        ) : null}

        <Outcome state={state} />

        <div className="flex justify-end gap-2">
          <button type="button" className={SECONDARY} onClick={close} disabled={pending} autoFocus>
            Vazgeç
          </button>
          <button
            type="submit"
            className={DANGER}
            disabled={!confirmed || pending || state.status === "SUCCEEDED"}
          >
            {pending ? "Siliniyor…" : "Kategoriyi kalıcı olarak sil"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Outcome({ state }: { readonly state: AuthorizationChangeOutcome }) {
  if (state.status === "IDLE") return null;

  return (
    <div
      role="status"
      className={
        state.status === "SUCCEEDED"
          ? "rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm text-ink"
          : "rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-ink"
      }
    >
      <p>{state.message}</p>
      {state.errorCode === null ? null : (
        <p className="mt-1 text-xs text-ink-muted">
          Hata kodu: <span className="font-mono">{state.errorCode}</span>
        </p>
      )}
      {state.requestId === null ? null : (
        <p className="text-xs text-ink-muted">
          İstek numarası: <span className="font-mono break-all">{state.requestId}</span>
        </p>
      )}
    </div>
  );
}
