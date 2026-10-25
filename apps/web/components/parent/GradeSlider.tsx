import { KID, type Grade } from "./model";
import styles from "./parent.module.css";

const GRADES = Array.from({ length: KID.grade - KID.firstGrade + 1 }, (_, i) => (KID.firstGrade + i) as Grade);

/** Time travel: the whole overview shows her as she was at the end of the chosen grade. */
export function GradeSlider({ grade, onChange }: { grade: Grade; onChange: (g: Grade) => void }) {
  return (
    <div className={styles.slider}>
      <label htmlFor="grade" className={styles.gradeFigure}>
        Grade {grade}
      </label>
      <input
        id="grade"
        type="range"
        min={KID.firstGrade}
        max={KID.grade}
        step={1}
        value={grade}
        aria-valuetext={`Grade ${grade}`}
        onChange={(e) => onChange(Number(e.target.value) as Grade)}
      />
      <div className={styles.ticks} aria-hidden>
        {GRADES.map((g) => (
          <span key={g} data-on={g === grade}>
            {g}
          </span>
        ))}
      </div>
      <p className={styles.quiet}>
        {grade === KID.grade ? "Now. " : `As of the end of grade ${grade}. `}
        Slide to see her earlier years.
      </p>
    </div>
  );
}
