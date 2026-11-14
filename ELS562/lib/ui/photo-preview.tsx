"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function PhotoPreview({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    const x = window.scrollX, y = window.scrollY;
    const previous = { position: document.body.style.position, top: document.body.style.top, left: document.body.style.left, width: document.body.style.width };
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    Object.assign(document.body.style, { position: "fixed", top: `-${y}px`, left: `-${x}px`, width: "100%" });
    dialog.current?.showModal();
    return () => {
      Object.assign(document.body.style, previous);
      window.scrollTo({ left: x, top: y, behavior: "instant" });
      trigger?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, width: "min(94vw, 960px)", maxHeight: "92dvh", padding: 0, border: "1px solid #cbd5e1", borderRadius: 14, background: "#fff", color: "#102a30" }}>
      <div style={{ padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <strong>{title}</strong>
          <button type="button" className="primary" onClick={onClose} autoFocus>Close photo</button>
        </div>
        {failed ? <p role="alert">The photo could not load. Close this preview and open it again to refresh its secure link.</p> : <img src={url} alt={title} onError={() => setFailed(true)} style={{ display: "block", width: "100%", maxHeight: "72dvh", objectFit: "contain" }} />}
      </div>
    </dialog>, document.body,
  );
}
