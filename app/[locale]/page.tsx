import { redirect } from "next/navigation";

export default async function LocaleIndexPage({
  params,
}: {
  params: { locale: string };
}) {
  // Ensure we land inside the (dashboard) route group,
  // so Sidebar + Header layouts are applied.
  redirect(`/${params.locale}/productos`);
}

