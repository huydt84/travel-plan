import { notFound } from "next/navigation";
import Link from "next/link";
import { getViewer } from "../../../lib/auth";
import { LOCAL_PERSONAS, LOCAL_PERSONA_TRIP_SLUG, localPersonaIdForViewer } from "../../../lib/local-personas.mjs";
import { resolveLocalPersonaSwitcher } from "../../../lib/runtime-config.mjs";
import PersonaSwitcher from "../../../components/PersonaSwitcher";
import styles from "../../../src/styles/dev-personas.module.css";

export const dynamic = "force-dynamic";

export default async function LocalPersonasPage() {
  if (!resolveLocalPersonaSwitcher()) notFound();
  const viewer = await getViewer();
  const currentId = localPersonaIdForViewer(viewer);
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>← Về lịch trình</Link>
        <span>LOCAL / PERMISSION LAB</span>
      </header>
      <section className={styles.intro}>
        <div>
          <h1>Chọn góc nhìn kiểm thử</h1>
          <p>Đổi danh tính local mà không giả lập quyền. Global role được đọc từ bảng user; Leader và Member được đọc từ membership của chuyến demo.</p>
        </div>
        <aside>
          <strong>{LOCAL_PERSONA_TRIP_SLUG}</strong>
          <span>Chuyến chuẩn để kiểm tra visibility</span>
        </aside>
      </section>
      <PersonaSwitcher personas={LOCAL_PERSONAS} currentId={currentId} />
      <footer className={styles.footer}>
        <strong>Ranh giới an toàn</strong>
        <span>Trang và cookie này chỉ hoạt động trong local admin mode. Production trả 404.</span>
      </footer>
    </main>
  );
}
