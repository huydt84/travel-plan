"use client";
import * as Dialog from "@radix-ui/react-dialog";
import AssistantIcon from "./AssistantIcon";
import ConversationHistory from "./ConversationHistory";
import styles from "./assistant.module.css";

export default function HistorySidebar({ open, wide, container, triggerRef, onClose, onNew, onSelect, ...history }) {
  const close = () => { onClose(); triggerRef.current?.focus(); };
  const content = <>
    <div className={styles.historyTopbar}>
      <button type="button" className={styles.iconButton} onClick={close} aria-label="Đóng lịch sử" title="Đóng lịch sử"><AssistantIcon name="history" /></button>
      <button type="button" className={styles.historyNew} onClick={() => { onNew(); if (!wide) onClose(); }}><AssistantIcon name="new" />Cuộc trò chuyện mới</button>
    </div>
    <ConversationHistory {...history} onSelect={(conversation) => { onSelect(conversation); if (!wide) onClose(); }} />
  </>;
  if (wide) return <aside id="assistant-history" className={styles.historySidebar} data-state={open ? "open" : "closed"} aria-label="Hội thoại" aria-hidden={!open} inert={!open} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>{content}</aside>;
  if (!container) return null;
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <Dialog.Portal container={container}>
      <Dialog.Overlay className={styles.historyScrim}>
        <Dialog.Content id="assistant-history" className={styles.historySidebar} aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}>
          <Dialog.Title className="sr-only">Lịch sử trò chuyện</Dialog.Title>
          {content}
        </Dialog.Content>
      </Dialog.Overlay>
    </Dialog.Portal>
  </Dialog.Root>;
}
