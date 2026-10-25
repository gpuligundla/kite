import { KID, type Grade } from "./model";
import styles from "./parent.module.css";

const GRADES = Array.from({ length: KID.grade - KID.firstGrade + 1 }, (_, i) => (KID.firstGrade + i) as Grade);

/** Time travel: the whole overview shows her as she was at the end of the chosen grade. It stays in reach while you scroll. */
export function GradeSlider({ grade, onChange }: { grade: Grade; onChange: (g: Grade) => void }) {
  const now = grade === KID.grade;
  return (
    <div className={styles.timebar}>
      <label htmlFor="grade" className={styles.gradeFigure}>
        Grade {grade}
      </label>
      <div className={styles.track}>
        <input
          id="grade"
          type="range"
          min={KID.firstGrade}
          max={KID.grade}
          step={1}
          value={grade}
          aria-valuetext={`Grade ${grade}`}
          aria-describedby="grade-note"
          onChange={(e) => onChange(Number(e.target.value) as Grade)}
        />
        <div className={styles.ticks} aria-hidden>
          {GRADES.map((g) => (
            <span key={g} data-on={g === grade}>
              {g}
            </span>
          ))}
        </div>
      </div>
      <p id="grade-note" className={styles.timeNote}>
        {now ? "Now. Slide back to see her earlier years." : `As she was at the end of grade ${grade}.`}
        {!now && (
          <button className={styles.textButton} onClick={() => onChange(KID.grade)}>
            Back to now
          </button>
        )}
      </p>
    </div>
  );
}
