/**
 * 대·소분류 이름 표시 너비 상한(한글 등 2, ASCII·숫자·일반 기호 1).
 */
export const CATEGORY_NAME_MAX_DISPLAY_WIDTH = 33;

export function categoryNameDisplayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    w += c <= 0x007f ? 1 : 2;
  }
  return w;
}

/** 입력이 상한을 넘지 않도록 끝에서 잘라 냄(붙여넣기 대비). */
export function clampCategoryName(input: string): string {
  let out = '';
  for (const ch of input) {
    const trial = out + ch;
    if (categoryNameDisplayWidth(trial) > CATEGORY_NAME_MAX_DISPLAY_WIDTH) break;
    out = trial;
  }
  return out;
}

/** 레거시 flat 문자열 `대분류 > 소분류` 각각에 동일 규칙 적용. */
export function clampCategoryFlatDisplayName(display: string): string {
  const t = display.trim();
  if (!t.includes(' > ')) return clampCategoryName(t);
  const parts = t.split(' > ');
  if (parts.length !== 2) return clampCategoryName(t);
  return `${clampCategoryName(parts[0]!.trim())} > ${clampCategoryName(parts[1]!.trim())}`;
}
