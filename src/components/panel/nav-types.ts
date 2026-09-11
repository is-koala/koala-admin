/**
 * Kenar çubuğunun bir ekranı çizmek için ihtiyaç duyduğu şey. İzin eşlemesi
 * `routes.ts`'te kalır; chrome'a uzanan, süzülmüş listedir.
 */
export interface DrawnNavEntry {
  readonly href: string;
  readonly label: string;
  readonly group: "katalog" | "operasyon" | "finans" | "yonetim";
}
