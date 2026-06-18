import { permanentRedirect } from "next/navigation";

// Legacy /about route — preserved as a permanent redirect so existing
// inbound links, bookmarks, and search results keep working after the
// content moved to /story. Must be permanentRedirect (308), NOT redirect
// (307): a 307 tells Google the move is temporary, so it keeps /about in
// the index as "Page with redirect" and withholds link equity from /story.
// 308 consolidates ranking signal onto the canonical /story.
export default function AboutRedirect(): never {
  permanentRedirect("/story");
}
