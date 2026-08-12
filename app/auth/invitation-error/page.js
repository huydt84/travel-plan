"use client";

import { useEffect } from "react";

export default function InvitationAuthErrorPage() {
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
        <h1>Đang quay lại lời rủ</h1>
        <p>Nội dung bạn đã nhập vẫn được giữ.</p>
      </section>
    </main>
  );
}
