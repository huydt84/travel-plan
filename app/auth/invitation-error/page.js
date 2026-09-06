"use client";

import { useEffect } from "react";
import { useLocale } from "../../../components/LocaleProvider";

export default function InvitationAuthErrorPage() {
  const { t } = useLocale();
  useEffect(() => {
    const storedReturn = window.sessionStorage.getItem("travel-plan:invite:return");
    const destination = new URL(storedReturn || "/", window.location.origin);
    destination.searchParams.set("invite", "1");
    destination.searchParams.set("gmail", "cancel");
    window.location.replace(destination.toString());
  }, []);

  return (
    <main className="shell">
      <section className="now-card error-card" role="status">
        <h1>{t("errors.returnToInvite")}</h1>
        <p>{t("errors.invitePreserved")}</p>
      </section>
    </main>
  );
}
