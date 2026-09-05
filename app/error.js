"use client";
import trackerStyles from "../src/styles/tracker.module.css";

export default function ErrorPage({ reset }) {
  return (
    <main className="shell">
      <section className="now-card error-card">
        <h1>Lịch tạm thời chưa tải được.</h1>
        <p>Kiểm tra kết nối mạng rồi thử tải lại lịch trình.</p>
        <button
          className={trackerStyles["jump-button"]}
          type="button"
          onClick={reset}
        >
          Thử lại
        </button>
      </section>
    </main>
  );
}
