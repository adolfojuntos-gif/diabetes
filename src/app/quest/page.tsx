import { redirect } from "next/navigation";

/**
 * Life Quest used to live at /quest. It is now the front door, so this only exists to keep old
 * links, bookmarks and anything already sent to somebody working.
 */
export default function QuestMoved() {
  redirect("/");
}
