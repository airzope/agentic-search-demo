import { redirect } from "next/navigation";

/** The index page became the knowledge-base page. */
export default function Page() {
  redirect("/kb");
}
