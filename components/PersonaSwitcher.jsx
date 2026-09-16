"use client";

import { useState } from "react";
import styles from "../src/styles/dev-personas.module.css";

const roleLabel = { owner: "Owner", admin: "Admin", member: "Member", anonymous: "Chưa đăng nhập" };
const membershipLabel = { leader: "Leader", member: "Member", none: "Không thuộc chuyến" };

export default function PersonaSwitcher({ personas, currentId }) {
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");

  const choose = async (personaId) => {
    setPending(personaId);
    setError("");
    try {
      const response = await fetch("/api/dev/persona", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personaId }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Không thể đổi persona");
      window.location.assign(response.url || "/");
    } catch (requestError) {
      setError(requestError.message);
      setPending("");
    }
  };

  return (
    <section className={styles.board} aria-labelledby="persona-board-title">
      <div className={styles.boardHead}>
        <h2 id="persona-board-title">Danh sách persona</h2>
        <span>Global role / Trip role / Quyền dự kiến</span>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.rows}>
        {personas.map((persona) => {
          const active = currentId === persona.id;
          return (
            <article className={`${styles.row} ${active ? styles.active : ""}`} key={persona.id}>
              <div className={styles.identity}>
                <strong>{persona.name}</strong>
                <span>{persona.email || "Không có session"}</span>
              </div>
              <dl>
                <div><dt>Global</dt><dd>{roleLabel[persona.globalRole]}</dd></div>
                <div><dt>Trip demo</dt><dd>{membershipLabel[persona.membership]}</dd></div>
              </dl>
              <p>{persona.capability}</p>
              <button type="button" disabled={active || Boolean(pending)} onClick={() => choose(persona.id)}>
                {active ? "Đang sử dụng" : pending === persona.id ? "Đang chuyển…" : `Test với ${persona.name}`}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
