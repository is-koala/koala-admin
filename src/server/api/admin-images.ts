import "server-only";

import { koalaRequestNoData } from "./koala";

/**
 * `DELETE /admin/images/{imageId}` — `AdminController.removeImage`.
 *
 * Görseli bütün ilan ve şirket galerilerinden düşürür, medya kaydını
 * soft-delete eder. Depodaki nesneye dokunmaz. `content.moderate` ister.
 */
export function adminImagePath(imageId: string): string {
  return `/admin/images/${encodeURIComponent(imageId)}`;
}

export function removeAdminImage(accessToken: string, imageId: string): Promise<unknown> {
  return koalaRequestNoData({
    path: adminImagePath(imageId),
    method: "DELETE",
    accessToken,
    cache: "no-store",
  });
}
