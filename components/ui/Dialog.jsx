"use client";

import * as Primitive from "@radix-ui/react-dialog";
import { useRef } from "react";

/**
 * Shared modal behavior; the feature owns its content, appearance and open state.
 * `children` is one ref-capable element (including a native form or section).
 * Pending operations can veto every dismissal without closing on submission.
 */
export default function Dialog({
  open = true,
  onClose,
  pending = false,
  overlayClassName,
  initialFocusRef,
  restoreFocusRef,
  portal = true,
  children,
  ...contentProps
}) {
  const returnFocusRef = useRef(null);

  const content = (
    <Primitive.Overlay className={overlayClassName}>
      <Primitive.Content
        asChild
        aria-describedby={undefined}
        {...contentProps}
        onOpenAutoFocus={(event) => {
          returnFocusRef.current = document.activeElement;
          if (initialFocusRef?.current) {
            event.preventDefault();
            initialFocusRef.current.focus();
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (
            restoreFocusRef?.current !== false &&
            returnFocusRef.current?.isConnected
          ) {
            returnFocusRef.current.focus();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        {children}
      </Primitive.Content>
    </Primitive.Overlay>
  );
  return (
    <Primitive.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !pending) onClose(); }}>
      {portal ? <Primitive.Portal>{content}</Primitive.Portal> : content}
    </Primitive.Root>
  );
}

export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;
