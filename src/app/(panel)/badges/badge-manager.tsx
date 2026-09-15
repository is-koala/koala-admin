"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  Badge,
  Dialog,
  EmptyState,
  FormField,
  SelectInput,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextInput,
  Button,
} from "@/components/ui";
import {
  IDLE_AUTHORIZATION_OUTCOME,
  type AuthorizationChangeAction,
  type AuthorizationChangeOutcome,
} from "@/lib/authorization-change";
import {
  BADGE_FAMILIES,
  BADGE_FAMILY_LABELS,
  BADGE_RULE_LABELS,
  BADGE_RULE_TYPES,
  BADGE_TIER_LABELS,
  BADGE_TIERS,
  type BadgeFamily,
  type BadgeRuleType,
  type BadgeTier,
} from "@/lib/badges";
import { formatInteger } from "@/lib/format";

export interface BadgeRecord {
  readonly id: string;
  readonly code: string;
  readonly family: BadgeFamily;
  readonly tier: BadgeTier;
  readonly name: string;
  readonly description: string | null;
  readonly iconUrl: string | null;
  readonly sortOrder: number;
  readonly ruleType: BadgeRuleType;
  readonly minCount: number | null;
  readonly minAverageRating: number | null;
  readonly minReviewCount: number | null;
  readonly active: boolean;
}

interface BadgeManagerProps {
  readonly badges: readonly BadgeRecord[];
  readonly createAction: AuthorizationChangeAction;
  readonly updateAction: AuthorizationChangeAction;
  readonly iconAction: AuthorizationChangeAction;
  readonly activationAction: AuthorizationChangeAction;
}

type ActiveDialog =
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly badge: BadgeRecord }
  | { readonly kind: "icon"; readonly badge: BadgeRecord }
  | { readonly kind: "activation"; readonly badge: BadgeRecord };

export function BadgeManager({
  badges,
  createAction,
  updateAction,
  iconAction,
  activationAction,
}: BadgeManagerProps) {
  const [active, setActive] = useState<ActiveDialog | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {badges.length === 0 ? (
        <EmptyState
          title="Hiç rozet yok."
          description="Katalog boşken ilk rozeti buradan oluşturabilirsiniz."
          action={
            <Button size="sm" type="button" onClick={() => setActive({ kind: "create" })}>
              İlk rozeti ekle
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-muted">{formatInteger(badges.length)} rozet.</p>
            <Button size="sm" type="button" onClick={() => setActive({ kind: "create" })}>
              Rozet ekle
            </Button>
          </div>

          <Table caption="Rozet kataloğu">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Ad</TableHeaderCell>
                <TableHeaderCell>Kod</TableHeaderCell>
                <TableHeaderCell>Aile / seviye</TableHeaderCell>
                <TableHeaderCell>Kural</TableHeaderCell>
                <TableHeaderCell>Durum</TableHeaderCell>
                <TableHeaderCell>İşlemler</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {badges.map((badge) => (
                <TableRow key={badge.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {badge.iconUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={badge.iconUrl} alt="" className="h-8 w-8 rounded object-cover" />
                      ) : null}
                      <span>{badge.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{badge.code}</span>
                  </TableCell>
                  <TableCell>
                    {BADGE_FAMILY_LABELS[badge.family]} · {BADGE_TIER_LABELS[badge.tier]}
                  </TableCell>
                  <TableCell>{BADGE_RULE_LABELS[badge.ruleType]}</TableCell>
                  <TableCell>
                    {badge.active ? (
                      <Badge tone="success">Etkin</Badge>
                    ) : (
                      <Badge tone="neutral">Pasif</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"

                        aria-label={`${badge.name} rozetini düzenle`}
                        onClick={() => setActive({ kind: "edit", badge })}
                      >
                        Düzenle
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"

                        aria-label={`${badge.name} ikonunu değiştir`}
                        onClick={() => setActive({ kind: "icon", badge })}
                      >
                        İkon
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"

                        aria-label={
                          badge.active
                            ? `${badge.name} rozetini pasifleştir`
                            : `${badge.name} rozetini etkinleştir`
                        }
                        onClick={() => setActive({ kind: "activation", badge })}
                      >
                        {badge.active ? "Pasifleştir" : "Etkinleştir"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      {active?.kind === "create" ? (
        <BadgeEditor
          key="create"
          action={createAction}
          badge={null}
          onClose={() => setActive(null)}
        />
      ) : null}
      {active?.kind === "edit" ? (
        <BadgeEditor
          key={`edit-${active.badge.id}`}
          action={updateAction}
          badge={active.badge}
          onClose={() => setActive(null)}
        />
      ) : null}
      {active?.kind === "icon" ? (
        <BadgeIconDialog
          key={`icon-${active.badge.id}`}
          action={iconAction}
          badge={active.badge}
          onClose={() => setActive(null)}
        />
      ) : null}
      {active?.kind === "activation" ? (
        <BadgeActivationDialog
          key={`activation-${active.badge.id}`}
          action={activationAction}
          badge={active.badge}
          onClose={() => setActive(null)}
        />
      ) : null}
    </div>
  );
}

function BadgeEditor({
  action,
  badge,
  onClose,
}: {
  readonly action: AuthorizationChangeAction;
  readonly badge: BadgeRecord | null;
  readonly onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<AuthorizationChangeOutcome, FormData>(
    action,
    IDLE_AUTHORIZATION_OUTCOME,
  );
  const [code, setCode] = useState(badge?.code ?? "");
  const [family, setFamily] = useState<BadgeFamily>(badge?.family ?? "GEZGIN");
  const [tier, setTier] = useState<BadgeTier>(badge?.tier ?? "SILVER");
  const [name, setName] = useState(badge?.name ?? "");
  const [description, setDescription] = useState(badge?.description ?? "");
  const [sortOrder, setSortOrder] = useState(badge === null ? "0" : String(badge.sortOrder));
  const [ruleType, setRuleType] = useState<BadgeRuleType>(
    badge?.ruleType ?? "COMPLETED_ASSIGNMENTS",
  );
  const [minCount, setMinCount] = useState(
    badge?.minCount === null || badge?.minCount === undefined ? "" : String(badge.minCount),
  );
  const [minAverageRating, setMinAverageRating] = useState(
    badge?.minAverageRating === null || badge?.minAverageRating === undefined
      ? ""
      : String(badge.minAverageRating),
  );
  const [minReviewCount, setMinReviewCount] = useState(
    badge?.minReviewCount === null || badge?.minReviewCount === undefined
      ? ""
      : String(badge.minReviewCount),
  );
  const [activeFlag, setActiveFlag] = useState(badge?.active ?? true);
  const submitting = useRef(false);

  useEffect(() => {
    if (!pending) submitting.current = false;
  }, [pending, state]);

  const prefix = badge === null ? "badge-create" : `badge-edit-${badge.id}`;
  const close = () => {
    if (!pending) onClose();
  };

  const setRule = (next: BadgeRuleType) => {
    setRuleType(next);
    if (next === "COMPLETED_ASSIGNMENTS") {
      setMinAverageRating("");
      setMinReviewCount("");
    } else if (next === "AVERAGE_RATING_WITH_MINIMUM_REVIEWS") {
      setMinCount("");
    } else {
      setMinCount("");
      setMinAverageRating("");
      setMinReviewCount("");
    }
  };

  return (
    <Dialog
      open
      onClose={close}
      title={badge === null ? "Rozet ekle" : "Rozeti düzenle"}
      description="Kod, kural ve eşikler backend sözleşmesine eksiksiz gönderilir. Kod sonradan değişmez."
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
        {badge === null ? null : <input type="hidden" name="badgeId" value={badge.id} />}

        <FormField
          id={`${prefix}-code`}
          label="Kod"
          required
          hint={
            badge === null
              ? "2-64 karakter: A-Z, 0-9 ve alt çizgi."
              : "Kod oluşturulduktan sonra değiştirilemez."
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
              readOnly={badge !== null}
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

        <FormField
          id={`${prefix}-description`}
          label="Açıklama"
          error={state.field === "description" ? state.message : null}
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              name="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={512}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id={`${prefix}-family`}
            label="Aile"
            required
            error={state.field === "family" ? state.message : null}
          >
            {({ id, describedBy, invalid }) => (
              <SelectInput
                id={id}
                name="family"
                value={family}
                onChange={(event) => setFamily(event.target.value as BadgeFamily)}
                aria-describedby={describedBy}
                aria-invalid={invalid}
              >
                {BADGE_FAMILIES.map((value) => (
                  <option key={value} value={value}>
                    {BADGE_FAMILY_LABELS[value]}
                  </option>
                ))}
              </SelectInput>
            )}
          </FormField>

          <FormField
            id={`${prefix}-tier`}
            label="Seviye"
            required
            error={state.field === "tier" ? state.message : null}
          >
            {({ id, describedBy, invalid }) => (
              <SelectInput
                id={id}
                name="tier"
                value={tier}
                onChange={(event) => setTier(event.target.value as BadgeTier)}
                aria-describedby={describedBy}
                aria-invalid={invalid}
              >
                {BADGE_TIERS.map((value) => (
                  <option key={value} value={value}>
                    {BADGE_TIER_LABELS[value]}
                  </option>
                ))}
              </SelectInput>
            )}
          </FormField>
        </div>

        <FormField
          id={`${prefix}-sortOrder`}
          label="Sıra"
          required
          hint="Küçük sayı listede önce görünür."
          error={state.field === "sortOrder" ? state.message : null}
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              name="sortOrder"
              inputMode="numeric"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
              required
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </FormField>

        <FormField
          id={`${prefix}-ruleType`}
          label="Kural"
          required
          error={state.field === "ruleType" ? state.message : null}
        >
          {({ id, describedBy, invalid }) => (
            <SelectInput
              id={id}
              name="ruleType"
              value={ruleType}
              onChange={(event) => setRule(event.target.value as BadgeRuleType)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            >
              {BADGE_RULE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {BADGE_RULE_LABELS[value]}
                </option>
              ))}
            </SelectInput>
          )}
        </FormField>

        <input
          type="hidden"
          name="minCount"
          value={ruleType === "COMPLETED_ASSIGNMENTS" ? minCount : ""}
        />
        <input
          type="hidden"
          name="minAverageRating"
          value={ruleType === "AVERAGE_RATING_WITH_MINIMUM_REVIEWS" ? minAverageRating : ""}
        />
        <input
          type="hidden"
          name="minReviewCount"
          value={ruleType === "AVERAGE_RATING_WITH_MINIMUM_REVIEWS" ? minReviewCount : ""}
        />

        {ruleType === "COMPLETED_ASSIGNMENTS" ? (
          <FormField
            id={`${prefix}-minCount`}
            label="İş sayısı eşiği"
            required
            error={state.field === "minCount" ? state.message : null}
          >
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                inputMode="numeric"
                value={minCount}
                onChange={(event) => setMinCount(event.target.value)}
                required
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            )}
          </FormField>
        ) : null}

        {ruleType === "AVERAGE_RATING_WITH_MINIMUM_REVIEWS" ? (
          <>
            <FormField
              id={`${prefix}-minAverageRating`}
              label="Ortalama puan eşiği"
              required
              hint="1.00 ile 5.00 arası."
              error={state.field === "minAverageRating" ? state.message : null}
            >
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  inputMode="decimal"
                  value={minAverageRating}
                  onChange={(event) => setMinAverageRating(event.target.value)}
                  required
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                />
              )}
            </FormField>
            <FormField
              id={`${prefix}-minReviewCount`}
              label="Yorum sayısı eşiği"
              required
              error={state.field === "minReviewCount" ? state.message : null}
            >
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  inputMode="numeric"
                  value={minReviewCount}
                  onChange={(event) => setMinReviewCount(event.target.value)}
                  required
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                />
              )}
            </FormField>
          </>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <input type="hidden" name="active" value={activeFlag ? "true" : "false"} />
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={activeFlag}
              onChange={(event) => setActiveFlag(event.target.checked)}
              aria-invalid={state.field === "active"}
            />
            Katalogda etkin
          </label>
        </div>

        <Outcome state={state} />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={close} disabled={pending}>
            Vazgeç
          </Button>
          <Button
            size="sm"
            type="submit"

            disabled={pending || state.status === "SUCCEEDED"}
          >
            {pending ? "Kaydediliyor…" : badge === null ? "Rozet oluştur" : "Değişiklikleri kaydet"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function BadgeIconDialog({
  action,
  badge,
  onClose,
}: {
  readonly action: AuthorizationChangeAction;
  readonly badge: BadgeRecord;
  readonly onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<AuthorizationChangeOutcome, FormData>(
    action,
    IDLE_AUTHORIZATION_OUTCOME,
  );
  const submitting = useRef(false);
  const prefix = `badge-icon-${badge.id}`;

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
      title="Rozet ikonunu değiştir"
      description={`${badge.name} görseli depoya yazılır ve yanıtlarda iconUrl olarak döner.`}
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
        <input type="hidden" name="badgeId" value={badge.id} />
        <FormField
          id={`${prefix}-icon`}
          label="Görsel"
          required
          error={state.field === "icon" ? state.message : null}
        >
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              name="icon"
              type="file"
              accept="image/*"
              required
              aria-describedby={describedBy}
              aria-invalid={invalid}
              className="text-sm text-ink"
            />
          )}
        </FormField>

        <Outcome state={state} />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={close} disabled={pending}>
            Vazgeç
          </Button>
          <Button
            size="sm"
            type="submit"

            disabled={pending || state.status === "SUCCEEDED"}
          >
            {pending ? "Yükleniyor…" : "İkonu kaydet"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function BadgeActivationDialog({
  action,
  badge,
  onClose,
}: {
  readonly action: AuthorizationChangeAction;
  readonly badge: BadgeRecord;
  readonly onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<AuthorizationChangeOutcome, FormData>(
    action,
    IDLE_AUTHORIZATION_OUTCOME,
  );
  const submitting = useRef(false);
  const nextActive = !badge.active;

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
      title={nextActive ? "Rozeti etkinleştir" : "Rozeti pasifleştir"}
      description={
        nextActive
          ? `${badge.name} yeniden verilmeye başlar.`
          : `${badge.name} bundan sonra kimseye verilmez; mevcut sahiplerinde kalır.`
      }
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
        <input type="hidden" name="badgeId" value={badge.id} />
        <input type="hidden" name="active" value={nextActive ? "true" : "false"} />

        <Outcome state={state} />

        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={close}
            disabled={pending}
            autoFocus
          >
            Vazgeç
          </Button>
          <Button
            size="sm"
            type="submit"

            disabled={pending || state.status === "SUCCEEDED"}
          >
            {pending ? "Kaydediliyor…" : nextActive ? "Etkinleştir" : "Pasifleştir"}
          </Button>
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
