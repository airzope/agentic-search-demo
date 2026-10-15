import { KbDetailView } from "@/components/views/kb-detail-view";

export default async function Page(props: PageProps<"/kb/[id]">) {
  const { id } = await props.params;
  let decoded = id;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    // keep the raw segment
  }
  return <KbDetailView key={decoded} id={decoded} />;
}
