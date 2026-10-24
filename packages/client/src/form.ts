import type { components } from "./contract.d.ts";

export type DeviceKind = components["schemas"]["Body_post_turn_turns_post"]["device"];

/** 0 is K. The brain answers 422 to "K", 13 and -1, so the type refuses them first. */
export type Grade = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** A browser Blob that carries a MIME type, or React Native's FormData file object. */
export type Attachment = Blob | { uri: string; name: string; type: string };

type Utterance = { text: string; audio?: Attachment } | { text?: string; audio: Attachment };
type Lesson = { mode?: "talk"; conceptId?: string } | { mode: "teach"; conceptId: string };

/** The two 422s the brain returns for a malformed turn (no text and no audio, teach without a concept) do not type-check. */
export type SayInput = Utterance & Lesson & { image?: Attachment; asOfGrade?: Grade };

/** A field is present only when its input is not undefined. 0 is a real grade, so never test truthiness. */
export function buildTurnForm(who: { kidId: string; device: DeviceKind }, input: SayInput): FormData {
  const form = new FormData();
  form.append("kid_id", who.kidId);
  form.append("device", who.device);
  form.append("mode", input.mode ?? "talk");
  if (input.text !== undefined) form.append("text", input.text);
  if (input.conceptId !== undefined) form.append("concept_id", input.conceptId);
  if (input.asOfGrade !== undefined) form.append("as_of_grade", String(input.asOfGrade));
  attach(form, "audio", input.audio);
  attach(form, "image", input.image);
  return form;
}

function attach(form: FormData, field: "audio" | "image", file: Attachment | undefined): void {
  if (file === undefined) return;
  if (file instanceof Blob) {
    // The brain defaults audio to audio/webm and mislabels images, so a typeless Blob would fail late and quietly.
    if (file.type === "") throw new TypeError(`${field} needs a MIME type`);
    form.append(field, file, `${field}.${file.type.split("/")[1]?.split(";")[0] || "bin"}`);
  } else {
    form.append(field, file as unknown as Blob); // React Native's FormData reads {uri, name, type}
  }
}
