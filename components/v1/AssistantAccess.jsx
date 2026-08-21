"use client";

import Link from "next/link";
import { signIn, signOut } from "next-auth/react";
import styles from "./assistant.module.css";

export default function AssistantAccess({ viewer }) {
  const signedIn = Boolean(viewer?.email);
  return (
    <main className={styles.accessShell}>
      <section className={styles.accessBoard} aria-labelledby="v1-access-title">
        <Link className={styles.backLink} href="/">Về lịch hiện tại</Link>
        <div className={styles.accessRail} aria-hidden="true"><i /><i /><i /></div>
        <div>
          <h1 id="v1-access-title">Trợ lý hành trình</h1>
          <p>{signedIn
            ? "Bản thử nghiệm /v1 hiện chỉ mở cho chủ lịch và quản trị viên."
            : "Đăng nhập bằng tài khoản quản trị để nghiên cứu địa điểm, hỏi về lịch và chuẩn bị thay đổi an toàn."}</p>
          {signedIn ? (
            <button className={styles.secondaryButton} type="button" onClick={() => signOut({ redirectTo: "/" })}>Đăng xuất</button>
          ) : (
            <button className={styles.primaryButton} type="button" onClick={() => signIn("google", { redirectTo: "/v1" })}>Tiếp tục với Google</button>
          )}
        </div>
      </section>
    </main>
  );
}
