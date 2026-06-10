import { redirect } from "next/navigation";

/**
 * The homepage forwards to Product Search, the default experience. The two
 * experiences live at their own routes (`/product-search`, `/outfit-creator`)
 * and share chrome via {@link import("@/components/ExperienceShell").ExperienceShell}.
 */
export default function Home() {
  redirect("/product-search");
}
