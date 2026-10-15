import { SearchView } from "@/components/views/search-view";

export default async function Page(props: PageProps<"/search">) {
  const { branch } = await props.searchParams;
  const initial = typeof branch === "string" && branch ? branch : null;
  return <SearchView key={initial ?? ""} initialBranch={initial} />;
}
