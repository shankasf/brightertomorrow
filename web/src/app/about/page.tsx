import { redirect } from "next/navigation";

// Legacy /about route — preserved as a permanent redirect so existing
// inbound links, bookmarks, and search results keep working after the
// content moved to /story.
export default function AboutRedirect(): never {
  redirect("/story");
}
