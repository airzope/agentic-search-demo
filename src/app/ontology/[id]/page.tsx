import { OntologyDetailView } from "@/components/views/ontology-detail-view";

export default async function Page(props: PageProps<"/ontology/[id]">) {
  const { id } = await props.params;
  let decoded = id;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    // keep the raw segment
  }
  return <OntologyDetailView key={decoded} id={decoded} />;
}
