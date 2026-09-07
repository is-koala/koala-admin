import Link from "next/link";

import { ErrorState } from "@/components/ui";
import { permissionLabel, type Permission } from "@/server/authz/permissions";
import type { StaffContextFailure, StaffContextFailureKind } from "@/server/authz/staff-context";

/**
 * The two things the panel says when it will not show you a screen, and why
 * they are not the same sentence.
 *
 * {@link PermissionDenied} — the backend answered, and you do not hold this
 * permission. Nothing is broken; there is a person who can grant it.
 *
 * {@link StaffContextUnavailable} — the panel could not find out what you may
 * do, so it assumed nothing. Telling someone "you lack permission" here would
 * be a lie with consequences: it sends an OWNER to ask for roles they already
 * have while a backend is down or a staff record was never written.
 *
 * Presentational and synchronous on purpose: they take plain data, so a test
 * renders them without a request, a session or a network stub.
 */

export interface PermissionDeniedProps {
  permission: Permission;
  /** Roles the backend resolved, shown as evidence of what *was* found. */
  roles?: readonly string[];
}

export function PermissionDenied({ permission, roles = [] }: PermissionDeniedProps) {
  return (
    <section className="flex flex-col gap-4" data-testid="permission-denied">
      <ErrorState
        title="403 — Bu sayfa için yetkiniz yok"
        description={`Bu ekran "${permissionLabel(permission)}" iznini gerektiriyor ve hesabınızda bu izin yok. Sayfanın içeriği hiç hazırlanmadı: veri çekilmedi, yalnız gizlenmedi.`}
        errorCode={permission}
        action={
          <div className="flex flex-col gap-2 text-sm text-ink">
            <p>
              <span className="font-medium">Ne yapmalı: </span>
              Bu izne ihtiyacınız varsa rolünüzün genişletilmesini isteyin. Rol üyeliğini de rolün
              hangi izinleri içerdiğini de Koala tutar; ikisini de personel yönetimi izni olan biri
              değiştirebilir.
            </p>
            {roles.length > 0 ? (
              <p className="text-xs text-ink-muted">
                Backend&apos;in çözdüğü rolleriniz: {roles.join(", ")}
              </p>
            ) : null}
          </div>
        }
      />
    </section>
  );
}

interface Explanation {
  readonly title: string;
  readonly description: string;
  readonly nextStep: string;
}

/**
 * One entry per failure kind, because collapsing them is how a configuration
 * problem gets reported as a permission problem.
 *
 * `SESSION` gets an entry too, short on purpose: the gate redirects those four
 * codes to `/giris` or `/giris/hata`, which explain them properly, but an
 * *ungated* page has nothing to redirect and would otherwise show an empty menu
 * with no reason for it. This says the reason and points at the door.
 */
const EXPLANATIONS: Record<StaffContextFailureKind, Explanation> = {
  SESSION: {
    title: "Oturumunuz doğrulanamadı",
    description:
      "Panel izinleri sormak için geçerli bir oturum kullanamadı. Bu bir yetki sorunu değil; oturumun kendisiyle ilgili. Ayrıntısı ve ne yapılması gerektiği giriş hatası sayfasında yazılı.",
    nextStep: "Yeniden giriş yapın.",
  },
  NO_STAFF_RECORD: {
    title: "Oturumunuz açık, ama backend size bir personel kaydı vermedi",
    description:
      "Token geçerli; backend GET /admin/me'yi yine de reddetti. Bu bir yetki kaybı değil, kaydın çözülememesi: hesap devre dışı bırakılmış ya da hiçbir role bağlı olmayabilir. İzin listesi boş kabul edildi ve menü bu yüzden boş — panel emin olmadığı hiçbir kapıyı açık göstermez.",
    nextStep:
      "Personel yönetimi izni olan bir çalışandan hesabınızın etkin olduğunu ve rollerinizi doğrulamasını isteyin.",
  },
  BACKEND_UNAVAILABLE: {
    title: "İzinleriniz çözülemedi",
    description:
      "Panel, hangi işlemlere yetkiniz olduğunu her istekte Koala'ya sorar ve bu sefer cevap alamadı. İzinler token'da taşınmadığı için (ADR-0010) tahmin edilecek bir liste de yok: panel hiçbir izniniz yokmuş gibi davranır. Yetkileriniz duruyor; şu an okunamıyor.",
    nextStep: "Birkaç dakika sonra tekrar deneyin; sürerse aşağıdaki istek numarasıyla bildirin.",
  },
  UNEXPECTED: {
    title: "İzinleriniz çözülemedi",
    description:
      "İzin sorgusu beklenmedik bir şekilde başarısız oldu. Panel emin olmadığı için hiçbir şeye izin vermiyor.",
    nextStep: "Sayfayı yenileyin; sürerse sunucu günlüklerine bakın.",
  },
};

export interface StaffContextUnavailableProps {
  failure: StaffContextFailure;
}

export function StaffContextUnavailable({ failure }: StaffContextUnavailableProps) {
  const explanation = EXPLANATIONS[failure.kind];

  return (
    <ErrorState
      title={explanation.title}
      description={explanation.description}
      errorCode={failure.kind}
      requestId={failure.requestId}
      action={
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink">
            <span className="font-medium">Ne yapmalı: </span>
            {explanation.nextStep}
          </p>
          {failure.authCode === null ? null : (
            <Link
              href={
                failure.authCode === "SESSION_REQUIRED"
                  ? "/giris"
                  : `/giris/hata?kod=${encodeURIComponent(failure.authCode)}`
              }
              className="self-start text-sm font-medium text-brand hover:underline"
            >
              Giriş hatası ayrıntısı
            </Link>
          )}
        </div>
      }
    />
  );
}
