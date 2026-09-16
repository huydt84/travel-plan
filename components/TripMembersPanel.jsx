"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { requestJson as api } from "../lib/request-json.mjs";
import { useLocale } from "./LocaleProvider";
import { ActionIcon } from "./Icons";
import Dialog, { DialogTitle } from "./ui/Dialog";
import styles from "../src/styles/trip-members.module.css";

export default function TripMembersPanel({ trip, access, onClose }) {
  const { t } = useLocale();
  const [members, setMembers] = useState([]);
  const [error, setError] = useState("");
  const closeRef = useRef(null);
  useEffect(() => {
    api(`/api/trips/${encodeURIComponent(trip.slug)}/members`).then((data) => setMembers(data.members)).catch(() => setError(t("visibility.membersLoadError")));
  }, [trip.slug, t]);
  return (
    <Dialog onClose={onClose} overlayClassName={styles.backdrop} initialFocusRef={closeRef}>
      <section className={styles.panel} aria-labelledby="members-panel-title">
        <header><div><DialogTitle asChild><h2 id="members-panel-title">{t("visibility.members")}</h2></DialogTitle><p>{trip.title}</p></div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t("common.close")}><ActionIcon name="close" /></button>
        </header>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.list}>
          {members.map((member, index) => <div className={styles.row} key={`${member.displayName}-${index}`}>
            <span>{String(index + 1).padStart(2, "0")}</span><i aria-hidden="true" />
            <strong>{member.displayName}</strong><small>{member.role === "leader" ? t("visibility.leader") : t("visibility.member")}</small>
          </div>)}
        </div>
        {access?.canManageMembers && <footer><Link href={`/trips/manage?trip=${encodeURIComponent(trip.slug)}`}>{t("visibility.manageMembers")}</Link></footer>}
      </section>
    </Dialog>
  );
}
