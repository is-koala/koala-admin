import { HttpResponse, http } from "msw";

import { apiUrl, server } from "../msw";

/**
 * `GET /admin/staff/{staffId}` için sayfa testlerinin ortak stub'ı
 * (koala-admin#112). Kimlik `STAFF_ID` ise ad döner, başka her kimlik 404:
 * böylece "dolu" ve "hata" yolları aynı stub'la denenir.
 */
export const STAFF_ID = "5f000000-0000-4000-8000-000000000055";
export const STAFF_NAME = "Zeynep Kaya";
export const STAFF_EMAIL = "zeynep@koala.local";
export const STAFF_HREF = `/staff?ara=zeynep%40koala.local#personel-${STAFF_ID}`;

export function stubStaffMember(): { readonly ids: string[] } {
  const seen: { ids: string[] } = { ids: [] };
  server.use(
    http.get(apiUrl("/admin/staff/:staffId"), ({ params }) => {
      const id = String(params.staffId);
      seen.ids.push(id);
      if (id !== STAFF_ID) {
        return HttpResponse.json(
          {
            success: false,
            message: "Personel bulunamadı.",
            httpStatus: "404 NOT_FOUND",
            errorCode: "STAFF_MEMBER_NOT_FOUND",
            errorCategory: "RESOURCE_NOT_FOUND",
            requestId: "rid-staff-404",
            path: `/admin/staff/${id}`,
            resource: "staff-member",
            resourceId: id,
            timeStamp: "2026-09-11T13:00:00.000000000Z",
          },
          { status: 404 },
        );
      }
      return HttpResponse.json({
        success: true,
        message: "Personel getirildi.",
        httpStatus: "200 OK",
        path: `/admin/staff/${id}`,
        requestId: "rid-staff",
        timeStamp: "2026-09-11T13:00:00.000000000Z",
        data: {
          id,
          email: STAFF_EMAIL,
          displayName: STAFF_NAME,
          active: true,
          mustChangePassword: false,
          lockedUntil: null,
          createdAt: "2026-09-01T08:00:00Z",
          roles: ["SUPPORT_AGENT"],
        },
      });
    }),
  );
  return seen;
}
