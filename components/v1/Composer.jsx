import { useLayoutEffect, useRef } from "react";
import styles from "./assistant.module.css";
export default function Composer({ message, setMessage, onSubmit, onStop, running, disabled }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const resize = () => { element.style.height = "auto"; element.style.height = Math.min(180, element.scrollHeight) + "px"; };
    resize();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => { if (element.clientWidth !== width) { width = element.clientWidth; resize(); } });
    observer.observe(element);
    return () => observer.disconnect();
  }, [message]);
  return <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <label htmlFor="assistant-message">Nhắn cho trợ lý</label>
    <div className={styles.composerField}>
      <textarea disabled={disabled} ref={ref} id="assistant-message" aria-label="Yêu cầu cho trợ lý" rows={1} maxLength={4000} value={message} onChange={(event) => setMessage(event.target.value)}
        placeholder="Hỏi về chuyến đi hoặc đề xuất sửa lịch…" onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (!running && !disabled && message.trim()) onSubmit(); }
        }} />
      {running ? <button type="button" className={styles.secondaryButton} onClick={onStop}>Dừng</button>
        : <button className={styles.primaryButton} disabled={disabled || !message.trim()} type="submit">{disabled ? "Đang gửi…" : "Gửi yêu cầu"}</button>}
    </div>
    <small>Enter để gửi · Shift + Enter để xuống dòng. Chỉ sửa lịch sau khi bạn áp dụng.</small>
  </form>;
}
