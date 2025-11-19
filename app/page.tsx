v2 update the app
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard/chat");
}

