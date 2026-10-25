"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Glyph } from "./Glyph";
import s from "./os.module.css";

/** "Add": a picture or a PDF to go with the next question. Sits beside the diamond, a size below it. */
export function Attach({ onPicture, onPdf }: { onPicture: (file: File) => void; onPdf: (file: File) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLInputElement>(null);
  const pdf = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const pick = (input: HTMLInputElement | null) => {
    setOpen(false);
    input?.click();
  };
  const took = (use: (file: File) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) use(file);
    e.target.value = "";
  };

  return (
    <div className={s.attach} ref={wrap}>
      <button type="button" className={s.side} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Glyph name="plus" size={26} />
        Add
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            className={s.attachMenu}
            initial={{ opacity: 0, transform: "translateY(6px) scale(0.97)" }}
            animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
            exit={{ opacity: 0, transform: "translateY(6px) scale(0.97)" }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
          >
            <button type="button" role="menuitem" onClick={() => pick(picture.current)}>
              <Glyph name="picture" size={24} />
              Add a picture
            </button>
            <button type="button" role="menuitem" onClick={() => pick(pdf.current)}>
              <Glyph name="pdf" size={24} />
              Add a PDF
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <input ref={picture} className={s.hidden} type="file" accept="image/*" onChange={took(onPicture)} />
      <input ref={pdf} className={s.hidden} type="file" accept="application/pdf,.pdf" onChange={took(onPdf)} />
    </div>
  );
}
